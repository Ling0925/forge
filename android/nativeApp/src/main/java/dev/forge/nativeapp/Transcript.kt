package dev.forge.nativeapp

import org.json.JSONObject

/** Absolute message indexes and generation identities prevent snapshot/stream duplication. */
internal class Transcript {
    private val durable = sortedMapOf<Int, ChatMessage>()
    private data class Live(val index: Int, val id: String, val text: String = "", val reasoning: String = "", val finished: Boolean = false)
    private val live = linkedMapOf<String, Live>()
    var offset: Int? = null
        private set
    var hasEarlier = false
        private set
    var title = "新的对话"
        private set
    var model = ""
        private set

    fun clear() { live.clear(); resetPage() }

    /** Switching into a running conversation keeps its generation stream, not its old page. */
    fun resetPage() {
        durable.clear(); offset = null; hasEarlier = false
        title = "新的对话"; model = ""
    }

    fun applyPage(result: JSONObject, prepend: Boolean = false) {
        val snapshot = result.getJSONObject("snapshot")
        val page = result.getJSONObject("page")
        val start = page.getInt("messageOffset")
        val names = mutableMapOf<String, String>()
        val messages = snapshot.getJSONArray("messages").objects()
        messages.forEach { message ->
            message.optJSONArray("tool_calls")?.objects()?.forEach { call ->
                names[call.getString("id")] = call.getJSONObject("function").getString("name")
            }
        }
        if (!prepend) durable.clear()
        messages.forEachIndexed { index, message ->
            val role = message.getString("role")
            val toolNames = message.optJSONArray("tool_calls")?.objects()?.joinToString(" · ") {
                it.getJSONObject("function").getString("name")
            }.orEmpty()
            val wireImages = message.optJSONArray("images")
            durable[start + index] = ChatMessage(
                key = "m${start + index}", role = role, text = message.string("content"),
                reasoning = message.string("reasoning"),
                toolName = if (role == "tool") names[message.string("tool_call_id")] ?: "工具结果" else toolNames,
                // Keep the wire count even when an attachment is malformed; only
                // renderable images are retained for the UI.
                imageCount = wireImages?.length() ?: 0,
                images = WorkbenchProtocol.parseImageAttachments(wireImages),
                generationId = message.string("generationId"),
            )
        }
        offset = if (prepend) minOf(offset ?: start, start) else start
        hasEarlier = offset!! > 0 && page.getBoolean("hasMore")
        title = snapshot.getString("title")
        model = snapshot.getString("model")
        // A generation is retired only once its durable counterpart has arrived.
        live.entries.removeAll { (id, value) ->
            value.finished && durable.values.any { it.generationId == id }
        }
    }

    fun event(event: JSONObject) {
        val id = event.string("generationId")
        when (event.getString("type")) {
            "run_started" -> live.entries.removeAll { it.value.finished }
            "run_finished" -> live.replaceAll { _, value -> value.copy(finished = true) }
            "generation_started" -> if (id.isNotEmpty() && id !in live) {
                live[id] = Live(event.getInt("messageIndex"), id)
            }
            "text_delta", "reasoning_delta" -> {
                val previous = live[id] ?: return
                val text = event.getString("text")
                live[id] = if (event.getString("type") == "text_delta") {
                    previous.copy(text = (previous.text + text).take(2_000_000))
                } else previous.copy(reasoning = (previous.reasoning + text).take(131072))
            }
            "retry_reset" -> {
                // Reset only this generation; reasoning must never become assistant prose.
                val affected = if (id.isNotEmpty()) listOf(id) else live.keys.toList()
                affected.forEach { key ->
                    live.remove(key)
                    durable.entries.removeAll { it.value.generationId == key }
                }
            }
            "generation_finished" -> live[id]?.let { live[id] = it.copy(finished = true) }
        }
    }

    fun messages(): List<ChatMessage> {
        val result = durable.toSortedMap()
        live.values.forEach { value ->
            val stored = result[value.index]?.takeIf { it.generationId == value.id }
            // Recovery may have a bounded tail; a longer durable body is never truncated by it.
            val text = if ((stored?.text?.length ?: 0) > value.text.length) stored!!.text else value.text
            val reasoning = if ((stored?.reasoning?.length ?: 0) > value.reasoning.length) stored!!.reasoning else value.reasoning
            result[value.index] = ChatMessage("m${value.index}", "assistant", text, reasoning,
                toolName = stored?.toolName.orEmpty(), isStreaming = !value.finished, generationId = value.id,
                imageCount = stored?.imageCount ?: 0, images = stored?.images.orEmpty())
        }
        return result.values.filter { it.role != "system" && (it.text.isNotBlank() || it.reasoning.isNotBlank() || it.toolName.isNotBlank() || it.imageCount > 0) }
    }
}
