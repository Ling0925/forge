package dev.forge.nativeapp

import java.net.URI
import java.util.Base64
import java.util.UUID
import org.json.JSONArray
import org.json.JSONObject

/**
 * Pure JVM projections for Core's real shared RPC schemas.
 *
 * The helpers in this file deliberately do not know about Android or UI state.
 * Effectful requests are built exactly once by the caller; these functions only
 * validate/normalize wire values so a malformed public-settings echo can never
 * be sent back to `updateSettings` or leak into a persisted state snapshot.
 */
internal object WorkbenchProtocol {
    const val MAX_IMAGE_BYTES = 2 * 1024 * 1024
    const val MAX_IMAGES = 4
    const val MAX_PROMPT_CHARS = 1_000_000

    private val IMAGE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
    private val PROVIDER_SOURCE_ID = Regex("^[a-z][a-z0-9_-]{0,31}$")
    private val MCP_ID = Regex("^[a-z0-9][a-z0-9-]{0,31}$")
    private val UUID_TEXT = Regex(
        "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$",
    )
    private val LSP_EXTENSION = Regex("^\\.[a-zA-Z0-9_-]{1,16}$")
    private val CONTROL = Regex("[\\u0000-\\u001f\\u007f]")

    private val PROVIDER_PROTOCOLS = setOf("chat-completions", "responses", "anthropic", "gemini")
    private val REASONING_EFFORTS =
        setOf("default", "none", "minimal", "low", "medium", "high", "xhigh", "max")
    private val ROUTING_STRATEGIES = setOf("order", "rotate", "usage", "smart", "pace")
    private val PERMISSIONS = setOf("readonly", "workspace", "unrestricted")
    private val MODES = setOf("build", "plan")
    private val THEMES = setOf("system", "light", "dark")

    /** ConfigureInput.settings whitelist from src/shared/schemas.ts. */
    private val SETTINGS_KEYS = linkedSetOf(
        "apiMode",
        "maxOutputTokens",
        "reasoningEffort",
        "baseUrl",
        "model",
        "theme",
        "defaultPermission",
        "maxTurns",
        "maxToolCalls",
        "maxRootToolCalls",
        "rootTimeoutMs",
        "requestTimeoutMs",
        "contextBudgetChars",
        "contextBudgetTokens",
        "modelContextWindows",
        "lspServers",
        "browserAllowedOrigins",
        "browserExecutablePath",
    )

    private val SOURCE_FIELDS = setOf(
        "id",
        "preset",
        "endpoints",
        "modelSelection",
        "modelAliases",
        "credentialRouting",
        "sticky",
        "activeCredentialId",
        "label",
        "baseUrl",
        "model",
        "apiMode",
    )

    fun isUuid(value: String): Boolean = UUID_TEXT.matches(value) && runCatching {
        UUID.fromString(value)
    }.isSuccess

    fun isProviderSourceId(value: String): Boolean = PROVIDER_SOURCE_ID.matches(value)

    fun isMcpServerId(value: String): Boolean = MCP_ID.matches(value) && "__" !in value

    fun modelsKey(sourceId: String): String = "models:$sourceId"

    fun sessionPageMetadata(page: JSONObject): JSONObject =
        sessionMetadata(page.getJSONObject("snapshot"))

    /**
     * The paged snapshot also embeds transcript content. Keep every other field
     * (plans, subagents, changes, context, provenance, pending steering, ...),
     * but never retain the transcript arrays in workbench state.
     */
    fun sessionMetadata(snapshot: JSONObject, previous: JSONObject? = null): JSONObject {
        val result = JSONObject()
        val keys = snapshot.keys()
        while (keys.hasNext()) {
            val key = keys.next()
            if (key == "messages" || key == "events" || key == "workbenchEvents") continue
            result.put(key, snapshot.get(key))
        }
        // Keep only the latest known inspector facts, not transcript/tool payloads.
        // Older history pages must not replace a more recent context or run fact.
        val facts = linkedMapOf<String, JSONObject>()
        val old = previous?.takeIf { it.string("id") == snapshot.string("id") }
            ?.optJSONArray("workbenchEvents")?.objects().orEmpty()
        val incoming = snapshot.optJSONArray("events")?.objects().orEmpty()
        (old + incoming).forEach { event ->
            val type = event.string("type")
            if (type in setOf("run_started", "run_finished", "context_usage", "agent_update")) {
                val key = type + if (type == "agent_update") ":${event.string("childSessionId")}" else ""
                val current = facts[key]
                val nextTime = runCatching { java.time.Instant.parse(event.string("timestamp")) }.getOrNull()
                val oldTime = current?.let { runCatching { java.time.Instant.parse(it.string("timestamp")) }.getOrNull() }
                if (current == null || (nextTime != null && (oldTime == null || nextTime >= oldTime))) {
                    facts[key] = event
                }
            }
        }
        val retained = facts.values.filter { it.string("type") != "agent_update" } +
            facts.values.filter { it.string("type") == "agent_update" }.takeLast(64)
        result.put("workbenchEvents", JSONArray(retained))
        return result
    }

    fun settingsUpdateFields(patch: JSONObject): JSONObject =
        JSONObject().put("input", JSONObject().put("settings", settingsPatch(patch)))

    /**
     * Keep only `ConfigureInput.settings` keys. Public settings contain read-only
     * fields (hasApiKey, isConfigured, providerSources, routeGroups, activeSourceId,
     * environmentOverride); echoing those back would be rejected by Core's strict
     * schema and could persist derived values as user input.
     */
    fun settingsPatch(input: JSONObject): JSONObject {
        val result = JSONObject()
        for (key in SETTINGS_KEYS) {
            if (!input.has(key)) continue
            when (key) {
                "apiMode" -> result.put(key, enumValue(input, key, PROVIDER_PROTOCOLS))
                "reasoningEffort" -> result.put(key, enumValue(input, key, REASONING_EFFORTS))
                "theme" -> result.put(key, enumValue(input, key, THEMES))
                "defaultPermission" -> result.put(key, enumValue(input, key, PERMISSIONS))
                "maxOutputTokens" -> result.put(key, intValue(input, key, 1, 1_000_000))
                "maxTurns" -> result.put(key, intValue(input, key, 1, 1_000))
                "maxToolCalls" -> result.put(key, intValue(input, key, 1, 10_000))
                "maxRootToolCalls" -> result.put(key, intValue(input, key, 1, 1_000_000))
                "rootTimeoutMs" -> result.put(key, intValue(input, key, 1_000, 86_400_000))
                "requestTimeoutMs" -> result.put(key, intValue(input, key, 1_000, 600_000))
                "contextBudgetChars" -> result.put(key, intValue(input, key, 4_096, 2_000_000))
                "contextBudgetTokens" -> {
                    if (input.get(key) === JSONObject.NULL) {
                        result.put(key, JSONObject.NULL)
                    } else {
                        result.put(key, intValue(input, key, 4_096, 10_000_000))
                    }
                }
                "baseUrl" -> {
                    val value = stringValue(input, key, 4_096, allowEmpty = true, trim = false)
                    require(value.isEmpty() || validHttpUrl(value, allowPath = true)) {
                        "设置 baseUrl 必须是 HTTP(S) 地址，且不能包含账号、查询参数或片段"
                    }
                    result.put(key, value)
                }
                "model" -> result.put(
                    key,
                    stringValue(input, key, 256, allowEmpty = true, trim = true),
                )
                "modelContextWindows" -> result.put(key, modelContextWindows(input))
                "lspServers" -> result.put(key, lspServers(input))
                "browserAllowedOrigins" -> result.put(key, browserOrigins(input))
                "browserExecutablePath" -> {
                    val value = stringValue(input, key, 4_096, allowEmpty = true, trim = false)
                    require(!value.contains('\r') && !value.contains('\n')) {
                        "浏览器路径不能包含换行"
                    }
                    result.put(key, value)
                }
            }
        }
        require(result.length() > 0) { "没有可保存的设置字段" }
        return result
    }

    fun configureSourceFields(operation: JSONObject): JSONObject =
        JSONObject().put("input", JSONObject().put("source", sourceOperation(operation)))

    /**
     * Validate the public shape of ConfigureInput.source. Secret material may be
     * present here only long enough to send the request; callers must never copy
     * this object into UI state or preferences.
     */
    fun sourceOperation(operation: JSONObject): JSONObject {
        val type = stringValue(operation, "type", 16, allowEmpty = false, trim = true)
        val result = JSONObject().put("type", type)
        when (type) {
            "save" -> {
                rejectUnknown(operation, setOf("type", "source", "apiKey", "credentials", "connection", "expectedRevision"), "来源保存")
                val source = operation.optJSONObject("source")
                    ?: throw IllegalArgumentException("来源保存缺少 source")
                result.put("source", providerSource(source))
                if (operation.has("expectedRevision")) {
                    result.put("expectedRevision", intValue(operation, "expectedRevision", 0, Int.MAX_VALUE))
                }
                if (operation.has("apiKey")) {
                    result.put("apiKey", apiKey(operation, "apiKey"))
                }
                if (operation.has("credentials")) {
                    val credentials = operation.optJSONArray("credentials")
                        ?: throw IllegalArgumentException("credentials 必须是数组")
                    result.put("credentials", copyArray(credentials, 512 * 1024, "credentials"))
                }
                if (operation.has("connection")) {
                    val connection = operation.optJSONObject("connection")
                        ?: throw IllegalArgumentException("connection 必须是对象")
                    result.put("connection", copyObject(connection, 512 * 1024, "connection"))
                }
            }
            "activate" -> {
                rejectUnknown(operation, setOf("type", "id"), "来源启用")
                val id = stringValue(operation, "id", 32, allowEmpty = false, trim = true)
                require(isProviderSourceId(id)) { "来源 ID 格式不正确" }
                result.put("id", id)
            }
            "remove" -> {
                rejectUnknown(operation, setOf("type", "id", "forgottenSessionIds"), "来源删除")
                val id = stringValue(operation, "id", 32, allowEmpty = false, trim = true)
                require(isProviderSourceId(id)) { "来源 ID 格式不正确" }
                result.put("id", id)
                if (operation.has("forgottenSessionIds")) {
                    val ids = operation.optJSONArray("forgottenSessionIds")
                        ?: throw IllegalArgumentException("forgottenSessionIds 必须是数组")
                    require(ids.length() <= 100_000) { "forgottenSessionIds 过多" }
                    val copy = JSONArray()
                    for (index in 0 until ids.length()) {
                        val value = ids.opt(index)
                        require(value is String && value.isNotEmpty()) { "forgottenSessionIds 必须是字符串数组" }
                        copy.put(value)
                    }
                    result.put("forgottenSessionIds", copy)
                }
            }
            else -> throw IllegalArgumentException("不支持的来源操作：$type")
        }
        return result
    }

    fun modelListFields(sourceId: String, refresh: Boolean = false): JSONObject {
        if (sourceId.isNotEmpty()) require(isProviderSourceId(sourceId)) { "模型来源 ID 格式不正确" }
        val result = JSONObject()
        if (sourceId.isNotEmpty()) result.put("sourceId", sourceId)
        if (refresh) result.put("refresh", true)
        return result
    }

    fun createSessionInput(
        workspace: String,
        title: String = "",
        model: String = "",
        providerSourceId: String = "",
        routeGroupId: String = "",
    ): JSONObject {
        val cleanWorkspace = workspace.trim()
        require(cleanWorkspace.isNotEmpty() && cleanWorkspace.length <= 4_096) { "工作区路径不能为空" }
        require(!CONTROL.containsMatchIn(cleanWorkspace)) { "工作区路径包含非法字符" }
        val result = JSONObject().put("workspace", cleanWorkspace)
        val cleanTitle = title.trim()
        if (cleanTitle.isNotEmpty()) {
            require(cleanTitle.length <= 256) { "会话标题过长" }
            result.put("title", cleanTitle)
        }
        val cleanModel = model.trim()
        if (cleanModel.isNotEmpty()) {
            require(cleanModel.length <= 256) { "模型名称过长" }
            result.put("model", cleanModel)
        }
        if (providerSourceId.isNotEmpty()) {
            require(isProviderSourceId(providerSourceId)) { "模型来源 ID 格式不正确" }
            result.put("providerSourceId", providerSourceId)
        }
        if (routeGroupId.isNotEmpty()) {
            require(routeGroupId.length <= 4_096) { "路由组 ID 过长" }
            result.put("routeGroupId", routeGroupId)
        }
        return result
    }

    fun runInput(
        sessionId: String,
        prompt: String,
        images: List<ChatImage> = emptyList(),
        mode: String = "",
        permission: String = "",
        model: String = "",
        providerSourceId: String = "",
        routeGroupId: String = "",
    ): JSONObject {
        require(isUuid(sessionId)) { "会话 ID 格式不正确" }
        val cleanPrompt = prompt.trim()
        require(cleanPrompt.length <= MAX_PROMPT_CHARS) { "消息过长" }
        val imageArray = imagesJson(images)
        require(cleanPrompt.isNotEmpty() || imageArray.length() > 0) { "请输入消息或添加图片。" }
        val result = JSONObject()
            .put("sessionId", sessionId)
            .put("prompt", cleanPrompt)
        if (imageArray.length() > 0) result.put("images", imageArray)
        if (mode.isNotEmpty()) {
            require(mode in MODES) { "运行模式必须是 plan 或 build" }
            result.put("mode", mode)
        }
        if (permission.isNotEmpty()) {
            require(permission in PERMISSIONS) { "权限级别不正确" }
            result.put("permission", permission)
        }
        val cleanModel = model.trim()
        if (cleanModel.isNotEmpty()) {
            require(cleanModel.length <= 256) { "模型名称过长" }
            result.put("model", cleanModel)
        }
        if (providerSourceId.isNotEmpty()) {
            require(isProviderSourceId(providerSourceId)) { "模型来源 ID 格式不正确" }
            result.put("providerSourceId", providerSourceId)
        }
        if (routeGroupId.isNotEmpty()) {
            require(routeGroupId.length <= 4_096) { "路由组 ID 过长" }
            result.put("routeGroupId", routeGroupId)
        }
        // RunInput has no reasoningEffort field; effort is a global settings value.
        return result
    }

    /** enqueueInput { input: { inputId: UUID, input: RunInput } } */
    fun enqueueInputFields(inputId: String, input: JSONObject): JSONObject {
        require(isUuid(inputId)) { "队列输入 ID 格式不正确" }
        require(input.optString("sessionId").isNotEmpty()) { "队列输入缺少会话" }
        return JSONObject().put(
            "input",
            JSONObject()
                .put("inputId", inputId)
                .put("input", JSONObject(input.toString())),
        )
    }

    /** steerRun { runId, prompt, images? } (no sessionId on the wire). */
    fun steerRunFields(runId: String, prompt: String, images: List<ChatImage> = emptyList()): JSONObject {
        require(isUuid(runId)) { "运行 ID 格式不正确" }
        val cleanPrompt = prompt.trim()
        require(cleanPrompt.length <= MAX_PROMPT_CHARS) { "插话内容过长" }
        val imageArray = imagesJson(images)
        require(cleanPrompt.isNotEmpty() || imageArray.length() > 0) { "请输入插话或添加图片。" }
        val result = JSONObject().put("runId", runId).put("prompt", cleanPrompt)
        if (imageArray.length() > 0) result.put("images", imageArray)
        return result
    }

    fun mcpRegisterFields(input: JSONObject): JSONObject {
        val copy = JSONObject(input.toString())
        val id = stringValue(copy, "id", 32, allowEmpty = false, trim = true)
        require(isMcpServerId(id)) { "MCP 服务器 ID 格式不正确" }
        stringValue(copy, "label", 64, allowEmpty = false, trim = true)
        val transport = if (copy.has("transport")) {
            stringValue(copy, "transport", 8, allowEmpty = false, trim = true)
        } else {
            "stdio"
        }
        when (transport) {
            "stdio" -> {
                stringValue(copy, "command", 4_096, allowEmpty = false, trim = false)
                if (copy.has("args")) {
                    val args = copy.optJSONArray("args") ?: throw IllegalArgumentException("args 必须是数组")
                    require(args.length() <= 64) { "MCP 参数过多" }
                    for (index in 0 until args.length()) {
                        val value = args.opt(index)
                        require(value is String && value.length <= 8_192 && '\u0000' !in value) {
                            "MCP 参数无效"
                        }
                    }
                }
            }
            "http", "sse" -> {
                val url = stringValue(copy, "url", 4_096, allowEmpty = false, trim = false)
                require(validHttpUrl(url, allowPath = true)) { "MCP 地址必须是 HTTP(S) URL" }
            }
            else -> throw IllegalArgumentException("不支持的 MCP 传输：$transport")
        }
        require(copy.toString().length <= 512 * 1024) { "MCP 注册信息过大" }
        return JSONObject().put("input", copy)
    }

    fun imageAttachment(bytes: ByteArray, rawName: String?, index: Int): ChatImage {
        require(bytes.size in 12..MAX_IMAGE_BYTES) { "图片大小必须在 2 MiB 以内" }
        val mime = detectImageMime(bytes) ?: throw IllegalArgumentException("仅支持 PNG、JPEG、WebP、GIF 图片")
        val encoded = Base64.getEncoder().encodeToString(bytes)
        return ChatImage(safeImageName(rawName, index, mime), "data:$mime;base64,$encoded")
    }

    fun safeImageName(raw: String?, index: Int, mime: String): String {
        val extension = when (mime) {
            "image/png" -> "png"
            "image/jpeg" -> "jpg"
            "image/webp" -> "webp"
            else -> "gif"
        }
        val candidate = raw.orEmpty()
            .substringAfterLast('/')
            .substringAfterLast('\\')
            .filter { it.code >= 32 && it.code != 127 }
            .trim()
            .take(255)
        return candidate.ifEmpty { "image-${index.coerceAtLeast(1)}.$extension" }
    }

    fun detectImageMime(bytes: ByteArray): String? {
        fun at(index: Int): Int = bytes[index].toInt() and 0xff
        fun matches(offset: Int, vararg values: Int): Boolean =
            bytes.size >= offset + values.size && values.indices.all { at(offset + it) == values[it] }

        return when {
            matches(0, 137, 80, 78, 71, 13, 10, 26, 10) -> "image/png"
            matches(0, 255, 216, 255) -> "image/jpeg"
            bytes.size >= 6 && at(0) == 'G'.code && at(1) == 'I'.code && at(2) == 'F'.code &&
                at(3) == '8'.code && (at(4) == '7'.code || at(4) == '9'.code) && at(5) == 'a'.code ->
                "image/gif"
            bytes.size >= 12 && at(0) == 'R'.code && at(1) == 'I'.code &&
                at(2) == 'F'.code && at(3) == 'F'.code && at(8) == 'W'.code &&
                at(9) == 'E'.code && at(10) == 'B'.code && at(11) == 'P'.code -> "image/webp"
            else -> null
        }
    }

    fun imagesJson(images: List<ChatImage>): JSONArray {
        require(images.size <= MAX_IMAGES) { "最多添加 4 张图片" }
        val result = JSONArray()
        images.forEach { image ->
            require(image.name.isNotEmpty() && image.name.length <= 255) { "图片名称无效" }
            require(validImageDataUrl(image.dataUrl)) { "图片格式无效，支持 PNG、JPEG、WebP、GIF，单张不超过 2 MiB" }
            result.put(JSONObject().put("name", image.name).put("dataUrl", image.dataUrl))
        }
        return result
    }

    /**
     * History parsing is intentionally lossy for display: malformed attachments
     * are skipped, while Transcript keeps the wire image count unchanged.
     */
    fun parseImageAttachments(array: JSONArray?): List<ChatImage> {
        if (array == null) return emptyList()
        val result = ArrayList<ChatImage>(minOf(array.length(), MAX_IMAGES))
        for (index in 0 until array.length()) {
            val item = array.optJSONObject(index) ?: continue
            val name = item.optString("name", "")
            val dataUrl = item.optString("dataUrl", "")
            if (name.isEmpty() || name.length > 255) continue
            if (!validImageDataUrl(dataUrl)) continue
            result.add(ChatImage(name, dataUrl))
        }
        return result
    }

    fun validImageDataUrl(value: String): Boolean {
        if (value.length > Math.ceil(MAX_IMAGE_BYTES / 3.0).toInt() * 4 + 32) return false
        val comma = value.indexOf(',')
        if (comma < 0) return false
        val mime = value.substring(0, comma)
        val expected = when (mime) {
            "data:image/png;base64" -> "image/png"
            "data:image/jpeg;base64" -> "image/jpeg"
            "data:image/webp;base64" -> "image/webp"
            "data:image/gif;base64" -> "image/gif"
            else -> return false
        }
        val encoded = value.substring(comma + 1)
        if (encoded.isEmpty() || encoded.length % 4 != 0) return false
        var padding = 0
        for (index in encoded.indices) {
            val character = encoded[index]
            if (character == '=') {
                if (index < encoded.length - 2) return false
                padding += 1
                continue
            }
            if (IMAGE_ALPHABET.indexOf(character) < 0) return false
        }
        if (padding > 2) return false
        if (padding > 0) {
            val tailStart = encoded.length - padding
            if (tailStart < 0) return false
        }
        val size = encoded.length / 4 * 3 - padding
        if (size < 12 || size > MAX_IMAGE_BYTES) return false
        val last = IMAGE_ALPHABET.indexOf(encoded[encoded.length - padding - 1])
        if (last < 0) return false
        if ((padding == 2 && (last and 15) != 0) || (padding == 1 && (last and 3) != 0)) return false
        val header = runCatching {
            Base64.getDecoder().decode(encoded.substring(0, 16))
        }.getOrNull() ?: return false
        return detectImageMime(header) == expected
    }

    fun handshakeRestriction(handshake: JSONObject): Boolean =
        handshake.optBoolean("restrictWorkspace", true)

    private fun providerSource(input: JSONObject): JSONObject {
        rejectUnknown(input, SOURCE_FIELDS, "模型来源")
        val id = stringValue(input, "id", 32, allowEmpty = false, trim = true)
        require(isProviderSourceId(id)) { "来源 ID 格式不正确" }
        val label = stringValue(input, "label", 80, allowEmpty = false, trim = true)
        val baseUrl = stringValue(input, "baseUrl", 4_096, allowEmpty = false, trim = false)
        require(validHttpUrl(baseUrl, allowPath = true)) { "来源地址必须是 HTTP(S) 地址" }
        val model = stringValue(input, "model", 256, allowEmpty = true, trim = true)
        val result = JSONObject()
            .put("id", id)
            .put("label", label)
            .put("baseUrl", baseUrl)
            .put("model", model)
        if (input.has("apiMode")) {
            result.put("apiMode", enumValue(input, "apiMode", PROVIDER_PROTOCOLS))
        }
        if (input.has("preset")) {
            result.put("preset", stringValue(input, "preset", 256, allowEmpty = false, trim = false))
        }
        if (input.has("endpoints")) {
            val endpoints = input.optJSONObject("endpoints")
                ?: throw IllegalArgumentException("endpoints 必须是对象")
            val copy = JSONObject()
            val keys = endpoints.keys()
            while (keys.hasNext()) {
                val key = keys.next()
                require(key in PROVIDER_PROTOCOLS) { "不支持的端点协议：$key" }
                val value = endpoints.opt(key)
                require(value is String && validHttpUrl(value, allowPath = true)) {
                    "端点地址必须是 HTTP(S) URL"
                }
                copy.put(key, value)
            }
            result.put("endpoints", copy)
        }
        if (input.has("modelSelection")) {
            val selection = input.optJSONObject("modelSelection")
                ?: throw IllegalArgumentException("modelSelection 必须是对象")
            result.put("modelSelection", copyObject(selection, 256 * 1024, "modelSelection"))
        }
        if (input.has("modelAliases")) {
            val aliases = input.optJSONObject("modelAliases")
                ?: throw IllegalArgumentException("modelAliases 必须是对象")
            val copy = JSONObject()
            val keys = aliases.keys()
            while (keys.hasNext()) {
                val key = keys.next()
                require(key.isNotEmpty()) { "模型别名为空" }
                val value = aliases.opt(key)
                require(value is String && value.isNotEmpty()) { "模型别名必须是字符串" }
                copy.put(key, value)
            }
            result.put("modelAliases", copy)
        }
        if (input.has("credentialRouting")) {
            result.put("credentialRouting", enumValue(input, "credentialRouting", ROUTING_STRATEGIES))
        }
        if (input.has("sticky")) {
            val value = input.opt("sticky")
            require(value is Boolean) { "sticky 必须是布尔值" }
            result.put("sticky", value)
        }
        if (input.has("activeCredentialId")) {
            result.put("activeCredentialId", stringValue(input, "activeCredentialId", 256, allowEmpty = false, trim = false))
        }
        return result
    }

    private fun apiKey(input: JSONObject, key: String): String {
        val value = stringValue(input, key, 16_384, allowEmpty = true, trim = false)
        require(!value.contains('\r') && !value.contains('\n')) { "API 密钥不能包含换行" }
        return value
    }

    private fun modelContextWindows(input: JSONObject): JSONObject {
        val windows = input.optJSONObject("modelContextWindows")
            ?: throw IllegalArgumentException("modelContextWindows 必须是对象")
        val result = JSONObject()
        val keys = windows.keys()
        while (keys.hasNext()) {
            val key = keys.next()
            require(key.isNotEmpty() && key.length <= 256) { "模型窗口名称无效" }
            val value = windows.opt(key)
            if (value === JSONObject.NULL) {
                result.put(key, JSONObject.NULL)
            } else {
                result.put(key, integerValue(value, "modelContextWindows.$key", 1, 10_000_000))
            }
        }
        return result
    }

    private fun lspServers(input: JSONObject): JSONArray {
        val servers = input.optJSONArray("lspServers")
            ?: throw IllegalArgumentException("lspServers 必须是数组")
        require(servers.length() <= 8) { "最多配置 8 个 LSP 服务器" }
        val result = JSONArray()
        for (index in 0 until servers.length()) {
            val server = servers.optJSONObject(index)
                ?: throw IllegalArgumentException("LSP 服务器必须是对象")
            rejectUnknown(server, setOf("id", "command", "args", "extensions"), "LSP 服务器")
            val id = stringValue(server, "id", 32, allowEmpty = false, trim = true)
            require(isProviderSourceId(id)) { "LSP 服务器 ID 格式不正确" }
            val command = stringValue(server, "command", 4_096, allowEmpty = false, trim = false)
            require(!CONTROL.containsMatchIn(command)) { "LSP 命令包含控制字符" }
            val args = server.optJSONArray("args")
                ?: throw IllegalArgumentException("LSP args 必须是数组")
            require(args.length() <= 32) { "LSP 参数过多" }
            val argsCopy = JSONArray()
            for (argIndex in 0 until args.length()) {
                val value = args.opt(argIndex)
                require(value is String && value.length <= 1_024 && '\u0000' !in value) {
                    "LSP 参数无效"
                }
                argsCopy.put(value)
            }
            val extensions = server.optJSONArray("extensions")
                ?: throw IllegalArgumentException("LSP extensions 必须是数组")
            require(extensions.length() in 1..32) { "LSP 扩展名数量不正确" }
            val extensionsCopy = JSONArray()
            for (extensionIndex in 0 until extensions.length()) {
                val value = extensions.opt(extensionIndex)
                require(value is String && LSP_EXTENSION.matches(value)) { "LSP 扩展名无效" }
                extensionsCopy.put(value)
            }
            result.put(
                JSONObject()
                    .put("id", id)
                    .put("command", command)
                    .put("args", argsCopy)
                    .put("extensions", extensionsCopy),
            )
        }
        return result
    }

    private fun browserOrigins(input: JSONObject): JSONArray {
        val origins = input.optJSONArray("browserAllowedOrigins")
            ?: throw IllegalArgumentException("browserAllowedOrigins 必须是数组")
        require(origins.length() <= 32) { "最多配置 32 个浏览器来源" }
        val result = JSONArray()
        for (index in 0 until origins.length()) {
            val value = origins.opt(index)
            require(value is String && value.length in 1..256 && validHttpUrl(value, allowPath = false)) {
                "浏览器来源必须是精确的 HTTP(S) origin"
            }
            require('*' !in value) { "浏览器来源不能包含通配符" }
            result.put(value)
        }
        return result
    }

    private fun enumValue(input: JSONObject, key: String, allowed: Set<String>): String {
        val value = stringValue(input, key, 64, allowEmpty = false, trim = true)
        require(value in allowed) { "$key 的值不受支持" }
        return value
    }

    private fun stringValue(
        input: JSONObject,
        key: String,
        max: Int,
        allowEmpty: Boolean,
        trim: Boolean,
    ): String {
        val raw = input.opt(key)
        require(raw is String) { "$key 必须是字符串" }
        val value = if (trim) raw.trim() else raw
        require(value.length <= max) { "$key 过长" }
        require(allowEmpty || value.isNotEmpty()) { "$key 不能为空" }
        return value
    }

    private fun intValue(input: JSONObject, key: String, min: Int, max: Int): Int =
        integerValue(input.opt(key), key, min, max)

    private fun integerValue(raw: Any?, key: String, min: Int, max: Int): Int {
        val number = raw as? Number ?: throw IllegalArgumentException("$key 必须是整数")
        val double = number.toDouble()
        require(double.isFinite() && double % 1.0 == 0.0) { "$key 必须是整数" }
        require(double >= min.toDouble() && double <= max.toDouble()) { "$key 超出范围" }
        return double.toInt()
    }

    private fun rejectUnknown(input: JSONObject, allowed: Set<String>, what: String) {
        val keys = input.keys()
        while (keys.hasNext()) {
            val key = keys.next()
            require(key in allowed) { "$what 包含不支持的字段：$key" }
        }
    }

    private fun copyObject(value: JSONObject, maxChars: Int, what: String): JSONObject {
        val copy = JSONObject(value.toString())
        require(copy.toString().length <= maxChars) { "$what 过大" }
        return copy
    }

    private fun copyArray(value: JSONArray, maxChars: Int, what: String): JSONArray {
        val copy = JSONArray(value.toString())
        require(copy.toString().length <= maxChars) { "$what 过大" }
        return copy
    }

    private fun validHttpUrl(value: String, allowPath: Boolean): Boolean {
        if (value.isEmpty() || value.length > 4_096 || CONTROL.containsMatchIn(value)) return false
        return runCatching {
            val uri = URI(value)
            val scheme = uri.scheme?.lowercase()
            scheme in setOf("http", "https") &&
                !uri.host.isNullOrEmpty() &&
                uri.rawUserInfo == null &&
                uri.rawQuery == null &&
                uri.rawFragment == null &&
                (allowPath || uri.rawPath.isNullOrEmpty()) &&
                uri.host?.contains('*') != true
        }.getOrDefault(false)
    }
}
