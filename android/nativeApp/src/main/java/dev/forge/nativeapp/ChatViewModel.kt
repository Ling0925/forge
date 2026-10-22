package dev.forge.nativeapp

import android.app.Application
import android.content.Context
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import java.security.MessageDigest
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.json.JSONArray
import org.json.JSONObject

class ChatViewModel(application: Application) : AndroidViewModel(application), ChatActions {
    private val preferences = application.getSharedPreferences("native-chat", Context.MODE_PRIVATE)
    private val mutable = MutableStateFlow(ChatUiState(serverUrl = preferences.getString("server", "").orEmpty()))
    val state = mutable.asStateFlow()
    private val transcripts = linkedMapOf<String, Transcript>()
    private val emptyTranscript = Transcript()
    private val transcript: Transcript get() = state.value.selectedId?.let(::transcriptFor) ?: emptyTranscript
    private fun transcriptFor(id: String): Transcript = transcripts.getOrPut(id) {
        if (transcripts.size >= 12) transcripts.keys.firstOrNull { it != state.value.selectedId }?.let(transcripts::remove)
        Transcript()
    }
    private val runs = mutableMapOf<String, ActiveRun>()
    private val approvals = mutableMapOf<String, Approval>()
    private val finishedRuns = linkedSetOf<String>()
    private val pageMutex = Mutex()
    private var transport: CoreTransport? = null
    private var eventStream: CoreTransport.EventStream? = null
    private var connectionJob: Job? = null
    private var refreshJob: Job? = null
    private var refreshRequested = false
    private var epoch = 0
    private var selection = 0
    private var lifecycleRevision = 0
    private var cursor: Long? = null
    private var foreground = true

    init {
        val remembered = preferences.getString("session-${key(null)}", null)
        change { it.copy(selectedId = remembered, draft = storedDraft(remembered), uncertain = uncertain(remembered)) }
    }

    private fun change(update: (ChatUiState) -> ChatUiState) { mutable.value = update(mutable.value) }
    private fun key(session: String? = state.value.selectedId, server: String = state.value.serverUrl): String =
        MessageDigest.getInstance("SHA-256").digest("$server\n${session ?: "new"}".toByteArray()).joinToString("") { "%02x".format(it) }
    private fun storedDraft(id: String?) = preferences.getString("draft-${key(id)}", "").orEmpty()
    private fun uncertain(id: String?) = preferences.getBoolean("uncertain-${key(id)}", false)
    private fun persistDraft() { preferences.edit().putString("draft-${key()}", state.value.draft).apply() }
    private fun markUncertain(value: Boolean, id: String? = state.value.selectedId) {
        preferences.edit().putBoolean("uncertain-${key(id)}", value).apply()
        if (id == state.value.selectedId) change { it.copy(uncertain = value) }
    }

    override fun connect(url: String, credential: String, pair: Boolean) {
        if (state.value.sending || state.value.busy) return
        val next = try { CoreTransport(CoreEndpoint.parse(url), if (pair) "" else credential) }
        catch (error: IllegalArgumentException) { change { it.copy(error = error.message) }; return }
        persistDraft()
        closeConnection()
        transport = next
        cursor = null
        transcripts.clear(); emptyTranscript.clear(); runs.clear(); approvals.clear(); finishedRuns.clear()
        val server = next.endpoint.address
        preferences.edit().putString("server", server).apply()
        val remembered = preferences.getString("session-${key(null, server)}", null)
        change { ChatUiState(serverUrl = server, selectedId = remembered, connection = ConnectionPhase.Connecting, connectionDetail = "正在连接 Core…") }
        change { it.copy(draft = storedDraft(remembered), uncertain = uncertain(remembered)) }
        val generation = epoch
        connectionJob = viewModelScope.launch {
            if (pair) {
                try { next.pair(credential.trim()) }
                catch (cancel: CancellationException) { throw cancel }
                catch (_: Exception) {
                    if (epoch == generation) change { it.copy(connection = ConnectionPhase.Disconnected,
                        error = "配对未能确认。配对码可能已被消费；请在服务器检查设备列表，再创建新配对码。不会自动重试。") }
                    return@launch
                }
            }
            connectionLoop(next, generation)
        }
    }

    private suspend fun connectionLoop(api: CoreTransport, generation: Int) {
        var failures = 0
        while (foreground && generation == epoch) {
            try {
                var recovery = emptyList<JSONObject>()
                if (cursor != null) {
                    try { if (!api.resumable(cursor!!)) cursor = null }
                    catch (error: CoreException) { if (error.status == 410) cursor = null else throw error }
                }
                if (cursor == null) {
                    val handshake = api.handshake()
                    if (generation != epoch) return
                    cursor = handshake.cursor
                    recovery = handshake.recovery
                    transcripts.clear(); emptyTranscript.clear()
                    runs.clear(); approvals.clear()
                    change { it.copy(workspace = handshake.workspace) }
                }
                val stream = api.openEvents(cursor!!)
                eventStream = stream
                val first = withTimeout(15_000) { stream.receive() }
                if (generation != epoch) return
                syncCatalog(api, generation)
                syncHost(api, generation)
                loadPage(api, generation)
                if (generation != epoch) return
                recovery.forEach(::receiveEvent)
                consume(stream, first)
                change { it.copy(connection = ConnectionPhase.Connected, connectionDetail = "已连接 · 任务在远端运行", error = null) }
                failures = 0
                while (foreground && generation == epoch) consume(stream, stream.receive())
            } catch (cancel: CancellationException) { throw cancel }
            catch (error: Exception) {
                eventStream?.close(); eventStream = null
                if (generation != epoch) return
                if (error is IllegalArgumentException || (error is CoreException && error.status in setOf(0, 400, 401, 403, 404, 405, 426))) {
                    change { it.copy(connection = ConnectionPhase.Disconnected, connectionDetail = "连接需要处理", error = error.message, loading = false) }
                    return
                }
                change { it.copy(connection = ConnectionPhase.Reconnecting,
                    connectionDetail = "连接中断，正在重连 · 不会重发消息", loading = false) }
                delay(minOf(10_000L, 500L * (1L shl minOf(failures++, 5))))
            }
        }
    }

    private fun consume(stream: CoreTransport.EventStream, batch: EventBatch) {
        batch.events.forEach(::receiveEvent)
        stream.acknowledge(batch.cursor)
        cursor = batch.cursor
    }

    private fun receiveEvent(envelope: JSONObject) {
        val runId = envelope.getString("runId")
        val event = envelope.getJSONObject("event")
        val sessionId = event.getString("sessionId")
        val type = event.getString("type")
        when (type) {
            "run_started", "state_changed" -> {
                lifecycleRevision++
                if (runId !in finishedRuns) runs[sessionId] = ActiveRun(runId, sessionId, event.string("status").ifEmpty { "running" })
            }
            "run_finished" -> {
                lifecycleRevision++
                if (runs[sessionId]?.id == runId) runs.remove(sessionId)
                approvals.entries.removeAll { it.value.runId == runId }
                finishedRuns.add(runId)
                if (finishedRuns.size > 128) finishedRuns.remove(finishedRuns.first())
            }
            "approval_requested" -> {
                lifecycleRevision++
                val approval = parseApproval(event.getJSONObject("request"), runId)
                approvals[approval.id] = approval
            }
            "approval_resolved" -> { lifecycleRevision++; approvals.remove(event.getString("approvalId")) }
            "title_changed" -> if (state.value.selectedId == sessionId) change { it.copy(title = event.getString("title")) }
            "error" -> if (state.value.selectedId == sessionId) change {
                it.copy(error = event.optJSONObject("error")?.string("message")?.take(512) ?: "远端运行出错，请刷新查看历史")
            }
        }
        if (sessionId == state.value.selectedId || state.value.sessions.any { it.id == sessionId }) {
            transcriptFor(sessionId).event(event)
            if (sessionId == state.value.selectedId) change { it.copy(messages = transcript.messages()) }
        }
        projectRun()
        if (type in setOf("run_started", "run_finished", "generation_finished", "tool_started", "tool_finished", "approval_resolved", "title_changed")) scheduleRefresh()
    }

    private fun projectRun() {
        val run = runs[state.value.selectedId]
        change { it.copy(run = run, approvals = approvals.values.filter { approval -> approval.runId == run?.id }) }
    }

    private suspend fun syncCatalog(api: CoreTransport, generation: Int) {
        val sessions = (api.rpc("listSessions") as JSONArray).objects()
            .filter { it.string("parentSessionId").isEmpty() && !it.optBoolean("archived") }
            .map(::parseSession).sortedByDescending { it.updatedAt }
        if (generation != epoch) return
        change { it.copy(sessions = sessions) }
        if (state.value.selectedId != null && sessions.none { it.id == state.value.selectedId }) {
            selectLocal(null)
        }
        if (state.value.models.isEmpty()) {
            // Catalog failure must not disable conversations using the server's configured model.
            try {
                val models = (api.rpc("listModels") as JSONArray).strings()
                if (generation == epoch) change { it.copy(models = models) }
            } catch (cancel: CancellationException) { throw cancel }
            catch (_: Exception) { /* Server default remains available. */ }
        }
    }

    private suspend fun syncHost(api: CoreTransport, generation: Int) {
        val revision = lifecycleRevision
        val result = api.rpc("getHostState") as JSONObject
        require(result.getInt("protocolVersion") == 1) { "不支持的 Core host 协议" }
        if (generation != epoch) return
        if (revision != lifecycleRevision) { scheduleRefresh(); return }
        runs.clear(); approvals.clear()
        result.getJSONArray("runs").objects().forEach { run ->
            val id = run.getString("runId")
            val sessionId = run.getString("sessionId")
            runs[sessionId] = ActiveRun(id, sessionId, run.getString("status"))
            run.getJSONArray("pendingApprovals").objects().forEach { item ->
                val approval = parseApproval(item, id)
                approvals[approval.id] = approval
            }
        }
        projectRun()
    }

    private suspend fun loadPage(api: CoreTransport, generation: Int, earlier: Boolean = false) {
        val id = state.value.selectedId ?: return
        val selected = selection
        pageMutex.withLock {
            if (generation != epoch || selected != selection) return
            val fields = JSONObject().put("sessionId", id)
            val offset = transcript.offset
            if (earlier && (offset == null || offset == 0)) return
            if (offset != null) fields.put("page", JSONObject().put(if (earlier) "before" else "from", offset))
            val result = api.rpc("getSessionPage", fields) as JSONObject
            if (generation != epoch || selected != selection) return
            transcript.applyPage(result, prepend = earlier)
            change { it.copy(messages = transcript.messages(), title = transcript.title,
                hasEarlier = transcript.hasEarlier, loading = false) }
        }
    }

    private fun scheduleRefresh() {
        refreshRequested = true
        if (refreshJob?.isActive == true) return
        val api = transport ?: return
        val generation = epoch
        refreshJob = viewModelScope.launch {
            do {
                refreshRequested = false
                delay(180)
                try {
                    syncCatalog(api, generation)
                    syncHost(api, generation)
                    loadPage(api, generation)
                } catch (cancel: CancellationException) { throw cancel }
                catch (error: Exception) { if (generation == epoch) showError(error) }
                // A terminal event arriving during a read must cause another read, not be lost.
            } while (refreshRequested && generation == epoch)
        }
    }

    override fun refresh() {
        if (state.value.connection != ConnectionPhase.Connected) { reconnect(); return }
        scheduleRefresh()
    }

    private fun selectLocal(id: String?) {
        persistDraft()
        selection++
        if (id == null) emptyTranscript.clear() else transcriptFor(id).resetPage()
        change { it.copy(selectedId = id, title = it.sessions.find { row -> row.id == id }?.title ?: "新的对话",
            messages = emptyList(), selectedModel = "", draft = storedDraft(id), uncertain = uncertain(id),
            hasEarlier = false, loadingEarlier = false, loading = id != null, error = null) }
        preferences.edit().putString("session-${key(null)}", id).apply()
        projectRun()
    }

    override fun selectSession(id: String) {
        if (state.value.sending || state.value.busy || id == state.value.selectedId) return
        selectLocal(id)
        val api = transport ?: return
        val generation = epoch
        val selected = selection
        viewModelScope.launch {
            try { loadPage(api, generation) }
            catch (cancel: CancellationException) { throw cancel }
            catch (error: Exception) { if (generation == epoch && selected == selection) showError(error) }
            finally { if (generation == epoch && selected == selection) change { it.copy(loading = false) } }
        }
    }

    override fun newChat() {
        if (!state.value.sending && !state.value.busy) selectLocal(null)
    }

    override fun loadEarlier() {
        val api = transport ?: return
        if (state.value.loadingEarlier || state.value.connection != ConnectionPhase.Connected) return
        val generation = epoch
        val selected = selection
        change { it.copy(loadingEarlier = true) }
        viewModelScope.launch {
            try { loadPage(api, generation, true) }
            catch (cancel: CancellationException) { throw cancel }
            catch (error: Exception) { if (generation == epoch && selected == selection) showError(error) }
            finally { if (generation == epoch && selected == selection) change { it.copy(loadingEarlier = false) } }
        }
    }

    override fun updateDraft(text: String) {
        change { it.copy(draft = text.take(100_000)) }
        persistDraft()
    }
    override fun selectModel(model: String) {
        if (model.isEmpty() || model in state.value.models) change { it.copy(selectedModel = model) }
    }
    override fun setPermission(permission: String) {
        if (permission in setOf("readonly", "workspace")) change { it.copy(permission = permission) }
    }

    override fun send() {
        val api = transport ?: return
        val before = state.value
        if (!canMutate() || before.loading || before.run != null || before.draft.isBlank()) return
        val generation = epoch
        val originalId = before.selectedId
        val originalKey = key(originalId)
        change { it.copy(sending = true, error = null) }
        markUncertain(true)
        viewModelScope.launch {
            try {
                var id = originalId
                if (id == null) {
                    val input = JSONObject().put("workspace", before.workspace)
                    if (before.selectedModel.isNotEmpty()) input.put("model", before.selectedModel)
                    val session = api.rpc("createSession", JSONObject().put("input", input)) as JSONObject
                    if (generation != epoch) return@launch
                    id = session.getString("id")
                    transcript.clear(); selection++
                    change { it.copy(selectedId = id, title = session.getString("title"), messages = emptyList()) }
                    preferences.edit().putString("session-${key(null)}", id).apply()
                    persistDraft()
                    markUncertain(true)
                }
                val input = JSONObject().put("sessionId", id).put("prompt", before.draft.trim())
                    .put("permission", before.permission).put("mode", if (before.permission == "readonly") "plan" else "build")
                if (before.selectedModel.isNotEmpty()) input.put("model", before.selectedModel)
                val result = api.rpc("startRun", JSONObject().put("input", input)) as JSONObject
                if (generation != epoch) return@launch
                val runId = result.getString("runId")
                if (runId !in finishedRuns) runs[id] = ActiveRun(runId, id, "running")
                if (state.value.draft == before.draft) change { it.copy(draft = "") }
                persistDraft()
                preferences.edit().remove("draft-$originalKey").putBoolean("uncertain-$originalKey", false).apply()
                // When no session was created, originalKey is also the current draft key.
                persistDraft()
                markUncertain(false)
                projectRun()
                scheduleRefresh()
            } catch (cancel: CancellationException) { throw cancel }
            catch (error: Exception) {
                if (generation == epoch) {
                    showError(error, mutation = true)
                    scheduleRefresh()
                }
            } finally { if (generation == epoch) change { it.copy(sending = false) } }
        }
    }

    private fun canMutate() = state.value.connection == ConnectionPhase.Connected &&
        !state.value.sending && !state.value.busy && !state.value.uncertain

    override fun stop() {
        val run = state.value.run ?: return
        mutate("cancelRun", JSONObject().put("runId", run.id))
    }
    override fun answerApproval(id: String, approved: Boolean) {
        val approval = state.value.approvals.find { it.id == id } ?: return
        mutate("answerApproval", JSONObject().put("runId", approval.runId).put("approvalId", id).put("approved", approved))
    }
    private fun mutate(method: String, fields: JSONObject) {
        val api = transport ?: return
        if (!canMutate()) return
        val generation = epoch
        change { it.copy(busy = true, error = null) }
        markUncertain(true)
        viewModelScope.launch {
            try {
                api.rpc(method, fields)
                if (generation == epoch) { markUncertain(false); scheduleRefresh() }
            } catch (cancel: CancellationException) { throw cancel }
            catch (error: Exception) { if (generation == epoch) { showError(error, true); scheduleRefresh() } }
            finally { if (generation == epoch) change { it.copy(busy = false) } }
        }
    }

    private fun showError(error: Exception, mutation: Boolean = false) {
        val detail = if (error is CoreException || error is IllegalArgumentException) error.message else "网络或协议请求失败，请检查连接后刷新"
        change { it.copy(error = detail + if (mutation) "。结果未确认；草稿已保留，请先检查历史和任务状态，不要直接重发。" else "", loading = false) }
    }
    override fun dismissError() { change { it.copy(error = null) } }
    override fun acknowledgeUncertain() {
        if (state.value.connection == ConnectionPhase.Connected && !state.value.sending && !state.value.busy) markUncertain(false)
    }

    override fun reconnect() {
        val api = transport ?: return
        if (!foreground) return
        connectionJob?.cancel(); eventStream?.close()
        change { it.copy(connection = ConnectionPhase.Reconnecting, connectionDetail = "正在恢复远端状态…") }
        val generation = epoch
        connectionJob = viewModelScope.launch { connectionLoop(api, generation) }
    }
    override fun disconnect() {
        if (state.value.sending || state.value.busy) return
        persistDraft()
        closeConnection()
        change { it.copy(connection = ConnectionPhase.Disconnected, connectionDetail = "已断开 · 不会停止远端任务", run = null, approvals = emptyList()) }
    }
    fun foreground(active: Boolean) {
        if (foreground == active) return
        foreground = active
        if (active) { if (transport != null) reconnect() }
        else {
            persistDraft()
            connectionJob?.cancel(); eventStream?.close(); eventStream = null
            if (transport != null) change { it.copy(connection = ConnectionPhase.Paused, connectionDetail = "已暂停实时连接 · 远端任务继续") }
        }
    }
    private fun closeConnection() {
        epoch++
        connectionJob?.cancel(); refreshJob?.cancel(); eventStream?.close()
        transport?.close(); transport = null; eventStream = null; cursor = null
    }
    override fun onCleared() { closeConnection() }
}
