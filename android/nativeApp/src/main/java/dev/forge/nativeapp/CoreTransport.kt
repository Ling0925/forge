package dev.forge.nativeapp

import java.io.Closeable
import java.io.IOException
import java.util.UUID
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.suspendCancellableCoroutine
import okhttp3.Call
import okhttp3.Callback
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/** Native counterpart of Core's src/web/server.ts. Never retries an effectful RPC. */
class CoreEndpoint private constructor(val url: HttpUrl) {
    val address: String get() = url.toString()
    private val authority = (if (url.host.contains(':')) "[${url.host}]" else url.host) + ":${url.port}"
    val origin = "${url.scheme}://$authority"
    val hostHeader = authority
    fun api(path: String): HttpUrl = requireNotNull(url.resolve("api/$path"))

    companion object {
        fun parse(input: String): CoreEndpoint {
            val text = input.trim()
            require(text.isNotEmpty() && text.length <= 4096 && text.none { it.isWhitespace() || it.code < 32 || it.code == 127 }) {
                "请输入有效的服务器地址（不能包含空白）"
            }
            val candidate = if (text.contains("://")) text else "http://$text"
            val url = requireNotNull(candidate.toHttpUrlOrNull()) { "仅支持 HTTP / HTTPS 地址" }
            require(url.username.isEmpty() && url.password.isEmpty() && url.query == null && url.fragment == null) {
                "地址不能包含账号、密码、查询参数或片段；设备凭据请单独填写"
            }
            return CoreEndpoint(url.newBuilder().apply {
                if (!url.encodedPath.endsWith('/')) addPathSegment("")
            }.build())
        }
    }
}

class CoreException(val status: Int, message: String) : IOException(message)
data class Handshake(
    val workspace: String,
    val restrictWorkspace: Boolean,
    val recovery: List<JSONObject>,
    val cursor: Long,
)
data class EventBatch(val cursor: Long, val events: List<JSONObject>)

class CoreTransport(
    val endpoint: CoreEndpoint,
    credential: String = "",
    private val http: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(12, TimeUnit.SECONDS)
        .readTimeout(125, TimeUnit.SECONDS)
        .callTimeout(130, TimeUnit.SECONDS)
        .retryOnConnectionFailure(false)
        .followRedirects(false)
        .followSslRedirects(false)
        .build(),
) : Closeable {
    private var bearer = credential.trim()
    private var clientId = ""
    private var stream: EventStream? = null

    init {
        require(bearer.isEmpty() || bearer.matches(Regex("[A-Za-z0-9_.-]{1,512}"))) { "设备凭据格式不正确" }
    }

    private fun request(path: String): Request.Builder = Request.Builder()
        .url(endpoint.api(path))
        .header("Origin", endpoint.origin)
        .header("Host", endpoint.hostHeader)
        .apply {
            if (bearer.isNotEmpty()) header("Authorization", "Bearer $bearer")
            if (clientId.isNotEmpty()) header("X-Forge-Client", clientId)
        }

    suspend fun pair(token: String) {
        // The exchange is one-shot: no retry, no cookie persistence, no URL credentials.
        val result = post("pair", JSONObject().put("token", token))
        bearer = result.getString("credential")
        require(bearer.matches(Regex("[A-Za-z0-9_.-]{1,512}"))) { "Core 返回了无效的设备凭据" }
    }

    suspend fun handshake(): Handshake {
        val result = post("connect", JSONObject())
        clientId = UUID.fromString(result.getString("clientId")).toString()
        return Handshake(
            result.getString("workspace"),
            WorkbenchProtocol.handshakeRestriction(result),
            result.getJSONArray("recovery").objects(),
            result.getLong("cursor"),
        )
    }

    suspend fun resumable(cursor: Long): Boolean =
        post("connection", JSONObject().put("cursor", cursor)).getBoolean("resumable")

    suspend fun rpc(method: String, fields: JSONObject = JSONObject()): Any {
        val id = UUID.randomUUID().toString()
        val input = JSONObject(fields.toString()).put("id", id).put("method", method)
        val response = post("rpc", input)
        if (response.getString("id") != id || response.getString("method") != method) {
            throw IOException("Core 响应与请求不匹配")
        }
        if (!response.getBoolean("ok")) {
            throw CoreException(0, response.getJSONObject("error").getString("message").take(512))
        }
        return response.get("result")
    }

    private suspend fun post(path: String, value: JSONObject): JSONObject {
        val call = http.newCall(request(path).post(value.toString().toRequestBody(JSON)).build())
        return suspendCancellableCoroutine { continuation ->
            continuation.invokeOnCancellation { call.cancel() }
            call.enqueue(object : Callback {
                override fun onFailure(call: Call, e: IOException) {
                    if (continuation.isActive) continuation.resumeWithException(e)
                }
                override fun onResponse(call: Call, response: Response) {
                    try {
                        val result = response.use {
                            if (!it.isSuccessful) throw CoreException(it.code, when (it.code) {
                                401 -> "需要有效的设备凭据或配对码（凭据仅保留在本次进程中）"
                                403 -> "Core 拒绝访问，请检查服务器地址、Host / Origin 及工作区限制"
                                409 -> "连接或请求状态冲突，请先刷新服务器状态，不要重复发送"
                                410 -> "连接已过期，正在重新建立连接"
                                in 300..399 -> "不跟随重定向，请填写最终的 Core 地址"
                                else -> "Core 请求失败（HTTP ${it.code}），请检查状态后再操作"
                            })
                            val source = requireNotNull(it.body).source()
                            source.request(MAX_BODY + 1)
                            if (source.buffer.size > MAX_BODY) throw IOException("Core 响应超过手机端 16 MiB 限制")
                            JSONObject(source.readUtf8())
                        }
                        if (continuation.isActive) continuation.resume(result)
                    } catch (error: Exception) {
                        if (continuation.isActive) continuation.resumeWithException(error)
                    }
                }
            })
        }
    }

    fun openEvents(cursor: Long): EventStream {
        stream?.close()
        return EventStream(cursor).also { stream = it }
    }

    inner class EventStream internal constructor(startCursor: Long) : Closeable {
        private val incoming = Channel<EventBatch>(64)
        private var expected = startCursor
        private val socket = http.newWebSocket(
            request("events").url(endpoint.api("events").newBuilder()
                .addQueryParameter("clientId", clientId)
                .addQueryParameter("cursor", startCursor.toString()).build()).build(),
            object : WebSocketListener() {
                override fun onMessage(webSocket: WebSocket, text: String) {
                    try {
                        if (text.length > MAX_BODY) throw IOException("事件批次过大")
                        val json = JSONObject(text)
                        val events = json.getJSONArray("events").objects()
                        val next = json.getLong("cursor")
                        if (next != expected + events.size) throw IOException("事件游标不连续，需要重新同步")
                        events.forEach { require(it.has("runId") && it.getJSONObject("event").has("sessionId")) }
                        expected = next
                        if (incoming.trySend(EventBatch(next, events)).isFailure) throw IOException("事件处理积压，需要重新同步")
                    } catch (error: Exception) {
                        incoming.close(error)
                        webSocket.cancel()
                    }
                }
                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                    incoming.close(IOException("实时连接中断", t))
                }
                override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                    incoming.close(IOException("实时连接已关闭"))
                }
                override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                    webSocket.close(code, null)
                    incoming.close(IOException("实时连接已关闭"))
                }
            },
        )
        suspend fun receive(): EventBatch = incoming.receive()
        fun acknowledge(cursor: Long) {
            if (!socket.send(JSONObject().put("cursor", cursor).toString())) throw IOException("无法确认事件游标")
        }
        override fun close() { socket.cancel(); incoming.cancel() }
    }

    /** Local disconnect never invokes cancelRun/cancelSession. */
    override fun close() {
        stream?.close()
        http.dispatcher.cancelAll()
        http.connectionPool.evictAll()
        http.dispatcher.executorService.shutdown()
    }

    companion object {
        private val JSON = "application/json; charset=utf-8".toMediaType()
        private const val MAX_BODY = 16L * 1024 * 1024
    }
}
