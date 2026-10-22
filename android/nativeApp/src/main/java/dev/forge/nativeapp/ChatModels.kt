package dev.forge.nativeapp

import org.json.JSONArray
import org.json.JSONObject

enum class ConnectionPhase { Disconnected, Connecting, Connected, Reconnecting, Paused }

data class SessionSummary(
    val id: String,
    val title: String,
    val model: String,
    val status: String,
    val updatedAt: String,
)

data class ChatMessage(
    val key: String,
    val role: String,
    val text: String,
    val reasoning: String = "",
    val toolName: String = "",
    val isStreaming: Boolean = false,
    val imageCount: Int = 0,
    val generationId: String = "",
)

data class Approval(
    val id: String,
    val runId: String,
    val sessionId: String,
    val toolName: String,
    val description: String,
    val command: String = "",
)

data class ActiveRun(val id: String, val sessionId: String, val status: String)

data class ChatUiState(
    val serverUrl: String = "",
    val connection: ConnectionPhase = ConnectionPhase.Disconnected,
    val connectionDetail: String = "尚未连接 Forge Core",
    val workspace: String = "",
    val sessions: List<SessionSummary> = emptyList(),
    val selectedId: String? = null,
    val title: String = "新的对话",
    val messages: List<ChatMessage> = emptyList(),
    val draft: String = "",
    val models: List<String> = emptyList(),
    val selectedModel: String = "",
    val permission: String = "readonly",
    val run: ActiveRun? = null,
    val approvals: List<Approval> = emptyList(),
    val loading: Boolean = false,
    val loadingEarlier: Boolean = false,
    val hasEarlier: Boolean = false,
    val sending: Boolean = false,
    val busy: Boolean = false,
    val error: String? = null,
    // A transport failure after a mutation is not evidence that it wasn't accepted.
    val uncertain: Boolean = false,
)

interface ChatActions {
    fun connect(url: String, credential: String, pair: Boolean)
    fun disconnect()
    fun reconnect()
    fun selectSession(id: String)
    fun newChat()
    fun loadEarlier()
    fun updateDraft(text: String)
    fun selectModel(model: String)
    fun setPermission(permission: String)
    fun send()
    fun stop()
    fun answerApproval(id: String, approved: Boolean)
    fun refresh()
    fun dismissError()
    /** Only called after the user explicitly inspects history and chooses to unlock sending. */
    fun acknowledgeUncertain()
}

internal fun JSONArray.objects(): List<JSONObject> = (0 until length()).map { getJSONObject(it) }
internal fun JSONArray.strings(): List<String> = (0 until length()).map { getString(it) }
internal fun JSONObject.string(name: String): String = if (isNull(name)) "" else optString(name, "")

internal fun parseSession(json: JSONObject) = SessionSummary(
    json.getString("id"), json.getString("title"), json.getString("model"),
    json.getString("status"), json.getString("updatedAt"),
)

internal fun parseApproval(json: JSONObject, runId: String) = Approval(
    json.getString("id"), runId, json.getString("sessionId"), json.getString("toolName"),
    json.getString("description"), json.optJSONArray("command")?.strings()?.joinToString(" ").orEmpty(),
)
