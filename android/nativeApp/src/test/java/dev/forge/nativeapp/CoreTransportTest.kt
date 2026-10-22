package dev.forge.nativeapp

import java.io.IOException
import java.util.UUID
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okhttp3.Response
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import okhttp3.mockwebserver.SocketPolicy
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class CoreTransportTest {
    @Test fun endpointValidationAndProxyPrefix() {
        assertEquals("http://192.168.1.10:5173/", CoreEndpoint.parse("192.168.1.10:5173").address)
        assertEquals("https://forge.example/mobile/api/rpc", CoreEndpoint.parse("https://forge.example/mobile").api("rpc").toString())
        assertEquals("http://[::1]:5173", CoreEndpoint.parse("http://[::1]:5173").origin)
        listOf("", "javascript:alert(1)", "file:///tmp/file", "ftp://host", "http://user:pass@host", "http://host/#token", "http://host/?token=x", "http://host:99999", "http://bad host").forEach { invalid ->
            assertThrows(IllegalArgumentException::class.java) { CoreEndpoint.parse(invalid) }
        }
    }

    @Test fun handshakeRpcAndWebSocketCarrySameIdentityAndAck() = runBlocking {
        val server = MockWebServer()
        val acknowledgements = LinkedBlockingQueue<String>()
        val id = UUID.randomUUID().toString()
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                assertEquals("http://localhost:${server.port}", request.getHeader("Origin"))
                assertEquals("localhost:${server.port}", request.getHeader("Host"))
                assertEquals("Bearer example-device-credential", request.getHeader("Authorization"))
                return when (request.requestUrl!!.encodedPath) {
                    "/api/connect" -> json("""{"workspace":"/demo","clientId":"$id","cursor":4,"recovery":[]}""")
                    "/api/rpc" -> {
                        assertEquals(id, request.getHeader("X-Forge-Client"))
                        val rpc = JSONObject(request.body.readUtf8())
                        json(JSONObject().put("id", rpc.getString("id")).put("method", rpc.getString("method")).put("ok", true).put("result", "ok").toString())
                    }
                    "/api/events" -> {
                        assertEquals(id, request.requestUrl!!.queryParameter("clientId"))
                        assertEquals("4", request.requestUrl!!.queryParameter("cursor"))
                        MockResponse().withWebSocketUpgrade(object : WebSocketListener() {
                            override fun onOpen(webSocket: WebSocket, response: Response) { webSocket.send("""{"cursor":4,"events":[]}""") }
                            override fun onMessage(webSocket: WebSocket, text: String) { acknowledgements.add(text) }
                        })
                    }
                    else -> MockResponse().setResponseCode(404)
                }
            }
        }
        server.start()
        val core = CoreTransport(CoreEndpoint.parse(server.url("/").toString()), "example-device-credential")
        try {
            assertEquals("/demo", core.handshake().workspace)
            assertEquals("ok", core.rpc("listSessions"))
            val stream = core.openEvents(4)
            val batch = withTimeout(3000) { stream.receive() }
            assertEquals(4L, batch.cursor)
            stream.acknowledge(batch.cursor)
            assertEquals(4L, JSONObject(acknowledgements.poll(3, TimeUnit.SECONDS)!!).getLong("cursor"))
            stream.close()
        } finally { core.close(); server.shutdown() }
    }

    @Test fun mutationIsNeverAutomaticallyReplayedAfterTransportLoss() = runBlocking {
        val server = MockWebServer()
        server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.DISCONNECT_AFTER_REQUEST))
        server.start()
        val core = CoreTransport(CoreEndpoint.parse(server.url("/").toString()))
        try {
            try { core.rpc("startRun", JSONObject().put("input", JSONObject())); fail("expected transport loss") }
            catch (_: IOException) { }
            assertEquals(1, server.requestCount)
        } finally { core.close(); server.shutdown() }
    }

    @Test fun redirectIsNotFollowedAndCredentialIsNotForwarded() = runBlocking {
        val server = MockWebServer()
        val other = MockWebServer()
        other.start()
        server.enqueue(MockResponse().setResponseCode(302).setHeader("Location", other.url("/api/connect")))
        server.start()
        val core = CoreTransport(CoreEndpoint.parse(server.url("/").toString()), "private-device")
        try {
            try { core.handshake(); fail("redirect must fail") }
            catch (error: CoreException) { assertEquals(302, error.status) }
            assertEquals(0, other.requestCount)
        } finally { core.close(); server.shutdown(); other.shutdown() }
    }

    @Test fun cursorGapFailsInsteadOfDuplicatingText() = runBlocking {
        val server = MockWebServer()
        server.enqueue(MockResponse().withWebSocketUpgrade(object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                webSocket.send("""{"cursor":3,"events":[{"runId":"run","event":{"sessionId":"session","type":"text_delta","text":"duplicate"}}]}""")
            }
        }))
        server.start()
        val core = CoreTransport(CoreEndpoint.parse(server.url("/").toString()))
        try {
            val stream = core.openEvents(1)
            try { withTimeout(3000) { stream.receive() }; fail("gap must fail") }
            catch (_: IOException) { }
        } finally { core.close(); server.shutdown() }
    }

    @Test fun unauthorizedPairingIsNotRetried() = runBlocking {
        val server = MockWebServer()
        server.enqueue(MockResponse().setResponseCode(401))
        server.start()
        val core = CoreTransport(CoreEndpoint.parse(server.url("/").toString()))
        try {
            try { core.pair("expired"); fail("pairing must fail") }
            catch (error: CoreException) { assertEquals(401, error.status) }
            assertEquals(1, server.requestCount)
        } finally { core.close(); server.shutdown() }
    }

    @Test fun rpcChecksRequestIdentity() = runBlocking {
        val server = MockWebServer()
        server.enqueue(json("""{"id":"other","method":"listSessions","ok":true,"result":[]}"""))
        server.start()
        val core = CoreTransport(CoreEndpoint.parse(server.url("/").toString()))
        try {
            try { core.rpc("listSessions"); fail("mismatched request must fail") }
            catch (_: IOException) { }
        } finally { core.close(); server.shutdown() }
    }

    private fun json(body: String) = MockResponse().setHeader("Content-Type", "application/json").setBody(body)
}
