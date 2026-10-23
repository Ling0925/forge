package dev.forge.nativeapp

import android.app.Application
import android.content.ContentResolver
import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.security.MessageDigest
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import org.json.JSONArray
import org.json.JSONObject

class ChatViewModel(application: Application) : AndroidViewModel(application), ChatActions {
    private val preferences = application.getSharedPreferences("native-chat", Context.MODE_PRIVATE)
    private val mutable = MutableStateFlow(
        ChatUiState(
            serverUrl = preferences.getString("server", "").orEmpty(),
            themeMode = storedTheme(),
        ),
    )
    val state = mutable.asStateFlow()

    private val transcripts = linkedMapOf<String, Transcript>()
    private val emptyTranscript = Transcript()
    private val transcript: Transcript get() = state.value.selectedId?.let(::transcriptFor) ?: emptyTranscript
    private fun transcriptFor(id: String): Transcript = transcripts.getOrPut(id) {
        if (transcripts.size >= 12) transcripts.keys.firstOrNull { it != state.value.selectedId }?.let(transcripts::remove)
        Transcript()
    }

    /** All host runs, not only the selected session. Keyed by run id. */
    private val runs = linkedMapOf<String, ActiveRun>()
    /** All pending approvals across sessions. */
    private val approvals = linkedMapOf<String, Approval>()
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

    /** The selection whose initial page projection has already been applied. */
    private var projectedSelection = -1
    private var initialModelsGeneration = -1

    /**
     * Mutations in flight. Each token carries the preference key it would need
     * to lock if the transport outcome becomes unknown. A successful or clearly
     * rejected sibling never clears another operation's persisted uncertainty.
     */
    private val pendingMutations = mutableMapOf<String, Mutation>()
    private var persistedUncertain = false
    private data class Mutation(val token: String, val sessionKey: String, val sessionId: String?)

    private val panelVersions = mutableMapOf<String, Int>()
    private val sourceVersions = mutableMapOf<String, Int>()

    /** Images stay in memory only and are isolated by server + session key. */
    private val draftImagesByKey = mutableMapOf<String, List<ChatImage>>()
    private var currentFilesPath = "."
    private var currentPreviewPath = ""
    private var currentCheckpointId = ""

    init {
        val remembered = preferences.getString("session-${key(null)}", null)
        persistedUncertain = uncertain(remembered)
        change {
            it.copy(
                themeMode = storedTheme(),
                selectedId = remembered,
                draft = storedDraft(remembered),
                uncertain = persistedUncertain,
            )
        }
    }

    private fun change(update: (ChatUiState) -> ChatUiState) { mutable.value = update(mutable.value) }

    private fun key(
        session: String? = state.value.selectedId,
        server: String = state.value.serverUrl,
    ): String = MessageDigest.getInstance("SHA-256")
        .digest("$server\n${session ?: "new"}".toByteArray())
        .joinToString("") { "%02x".format(it) }

    private fun storedTheme(): String =
        preferences.getString("theme-mode", "system")?.takeIf { it in THEMES } ?: "system"

    private fun storedDraft(id: String?) = preferences.getString("draft-${key(id)}", "").orEmpty()

    private fun uncertain(id: String?) = preferences.getBoolean("uncertain-${key(id)}", false)

    private fun persistDraft() {
        preferences.edit().putString("draft-${key()}", state.value.draft).apply()
    }

    private fun currentUncertain(): Boolean =
        persistedUncertain || pendingMutations.isNotEmpty()

    private fun refreshUncertainState() {
        val value = currentUncertain()
        if (state.value.uncertain != value) change { it.copy(uncertain = value) }
    }

    private fun beginMutation(): Mutation {
        val mutation = Mutation(UUID.randomUUID().toString(), key(), state.value.selectedId)
        pendingMutations[mutation.token] = mutation
        // Persist before the request: a process death during an effectful call is
        // itself an unknown outcome and must keep the UI locked after restart.
        preferences.edit().putBoolean("uncertain-${mutation.sessionKey}", true).apply()
        if (mutation.sessionId == state.value.selectedId) persistedUncertain = true
        refreshUncertainState()
        return mutation
    }

    private fun rekeyMutation(
        mutation: Mutation,
        sessionKey: String,
        sessionId: String?,
    ): Mutation {
        if (mutation.sessionKey == sessionKey) return mutation.copy(sessionId = sessionId)
        pendingMutations.remove(mutation.token)
        val next = mutation.copy(sessionKey = sessionKey, sessionId = sessionId)
        pendingMutations[next.token] = next
        preferences.edit()
            .putBoolean("uncertain-${mutation.sessionKey}", false)
            .putBoolean("uncertain-$sessionKey", true)
            .apply()
        if (sessionId == state.value.selectedId) persistedUncertain = true
        refreshUncertainState()
        return next
    }

    private fun settleMutation(mutation: Mutation, keepUncertain: Boolean) {
        pendingMutations.remove(mutation.token)
        val sameSessionPending = pendingMutations.values.any { it.sessionId == mutation.sessionId }
        if (mutation.sessionId == state.value.selectedId) {
            if (!keepUncertain && !sameSessionPending) {
                preferences.edit().putBoolean("uncertain-${mutation.sessionKey}", false).apply()
                persistedUncertain = false
            } else {
                persistedUncertain = preferences.getBoolean("uncertain-${mutation.sessionKey}", true)
            }
        } else if (!keepUncertain && !sameSessionPending) {
            preferences.edit().putBoolean("uncertain-${mutation.sessionKey}", false).apply()
        }
        refreshUncertainState()
    }

    private fun isDefiniteRejection(error: Exception): Boolean {
        if (error is IllegalArgumentException) return true
        if (error !is CoreException) return false
        // RPC ok:false (status 0) proves only that Core returned an error. A
        // service may already have produced side effects before throwing, and
        // the transport does not carry error.code evidence. Only HTTP responses
        // produced by the pre-handler guards are safe to treat as a rejection.
        return error.status in setOf(400, 401, 403, 404, 405, 410, 413, 414, 422, 426)
    }

    override fun connect(url: String, credential: String, pair: Boolean) {
        if (state.value.sending || state.value.busy) return
        val next = try {
            CoreTransport(CoreEndpoint.parse(url), if (pair) "" else credential)
        } catch (error: IllegalArgumentException) {
            change { it.copy(error = error.message) }
            return
        }
        persistDraft()
        closeConnection()
        transport = next
        cursor = null
        transcripts.clear()
        emptyTranscript.clear()
        runs.clear()
        approvals.clear()
        finishedRuns.clear()
        draftImagesByKey.clear()
        pendingMutations.clear()
        panelVersions.clear()
        sourceVersions.clear()
        projectedSelection = -1
        initialModelsGeneration = -1
        currentFilesPath = "."
        currentPreviewPath = ""
        currentCheckpointId = ""

        val server = next.endpoint.address
        preferences.edit().putString("server", server).apply()
        val remembered = preferences.getString("session-${key(null, server)}", null)
        val theme = storedTheme()
        persistedUncertain = uncertain(remembered)
        change {
            ChatUiState(
                serverUrl = server,
                connection = ConnectionPhase.Connecting,
                connectionDetail = "正在连接 Core…",
                selectedId = remembered,
                themeMode = theme,
                draft = storedDraft(remembered),
                uncertain = persistedUncertain,
            )
        }
        val generation = epoch
        connectionJob = viewModelScope.launch {
            if (pair) {
                try {
                    next.pair(credential.trim())
                } catch (cancel: CancellationException) {
                    throw cancel
                } catch (_: Exception) {
                    if (epoch == generation) change {
                        it.copy(
                            connection = ConnectionPhase.Disconnected,
                            error = "配对未能确认。配对码可能已被消费；请在服务器检查设备列表，再创建新配对码。不会自动重试。",
                        )
                    }
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
                    try {
                        if (!api.resumable(cursor!!)) cursor = null
                    } catch (error: CoreException) {
                        if (error.status == 410) cursor = null else throw error
                    }
                }
                if (cursor == null) {
                    val handshake = api.handshake()
                    if (generation != epoch) return
                    cursor = handshake.cursor
                    recovery = handshake.recovery
                    transcripts.clear()
                    emptyTranscript.clear()
                    runs.clear()
                    approvals.clear()
                    initialModelsGeneration = -1
                    change {
                        it.copy(
                            workspace = handshake.workspace,
                            restrictWorkspace = handshake.restrictWorkspace,
                            selectedWorkspace = when {
                                handshake.restrictWorkspace -> handshake.workspace
                                it.selectedWorkspace.isBlank() -> handshake.workspace
                                else -> it.selectedWorkspace
                            },
                        )
                    }
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
                change {
                    it.copy(
                        connection = ConnectionPhase.Connected,
                        connectionDetail = "已连接 · 任务在远端运行",
                        error = null,
                    )
                }
                ensureSelectedModels(generation)
                failures = 0
                while (foreground && generation == epoch) consume(stream, stream.receive())
            } catch (cancel: CancellationException) {
                throw cancel
            } catch (error: Exception) {
                eventStream?.close()
                eventStream = null
                if (generation != epoch) return
                if (error is IllegalArgumentException ||
                    (error is CoreException && error.status in setOf(0, 400, 401, 403, 404, 405, 426))
                ) {
                    change {
                        it.copy(
                            connection = ConnectionPhase.Disconnected,
                            connectionDetail = "连接需要处理",
                            error = error.message,
                            loading = false,
                        )
                    }
                    return
                }
                change {
                    it.copy(
                        connection = ConnectionPhase.Reconnecting,
                        connectionDetail = "连接中断，正在重连 · 不会重发消息",
                        loading = false,
                    )
                }
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
                if (runId !in finishedRuns) {
                    runs[runId] = ActiveRun(runId, sessionId, event.string("status").ifEmpty { "running" })
                }
            }
            "run_finished" -> {
                lifecycleRevision++
                runs.remove(runId)
                approvals.entries.removeAll { it.value.runId == runId }
                finishedRuns.add(runId)
                if (finishedRuns.size > 256) finishedRuns.remove(finishedRuns.first())
            }
            "approval_requested" -> {
                lifecycleRevision++
                val approval = parseApproval(event.getJSONObject("request"), runId)
                approvals[approval.id] = approval
            }
            "approval_resolved" -> {
                lifecycleRevision++
                approvals.remove(event.getString("approvalId"))
            }
            "permission_changed" -> if (state.value.selectedId == sessionId) {
                change { it.copy(permission = event.string("permission").ifEmpty { it.permission }) }
            }
            "title_changed" -> {
                val title = event.getString("title")
                change { current ->
                    current.copy(
                        title = if (current.selectedId == sessionId) title else current.title,
                        sessions = current.sessions.map { row ->
                            if (row.id == sessionId) row.copy(title = title) else row
                        },
                    )
                }
            }
            "error" -> if (state.value.selectedId == sessionId) change {
                it.copy(error = event.optJSONObject("error")?.string("message")?.take(512)
                    ?: "远端运行出错，请刷新查看历史")
            }
        }
        if (sessionId == state.value.selectedId || state.value.sessions.any { it.id == sessionId }) {
            transcriptFor(sessionId).event(event)
            if (sessionId == state.value.selectedId) change { it.copy(messages = transcript.messages()) }
        }
        projectRun()
        if (type in REFRESH_EVENTS) scheduleRefresh()
        if (type == "run_started" || type == "run_finished") refreshQueueIfLoaded()
    }

    private fun projectRun() {
        val allRuns = runs.values.toList()
        val allApprovals = approvals.values.toList()
        val selected = state.value.selectedId
        val run = allRuns.lastOrNull { it.sessionId == selected }
        change {
            it.copy(
                allRuns = allRuns,
                allApprovals = allApprovals,
                run = run,
                approvals = if (run == null) emptyList() else allApprovals.filter { row -> row.runId == run.id },
            )
        }
    }

    private suspend fun syncCatalog(api: CoreTransport, generation: Int) {
        // Archive/parent filtering belongs to the UI. The native client must know
        // about child sessions to render subagents and to resolve background runs.
        val sessions = (api.rpc("listSessions") as JSONArray).objects()
            .map(::parseSession)
            .sortedByDescending { it.updatedAt }
        if (generation != epoch) return
        change { it.copy(sessions = sessions) }
        if (state.value.selectedId != null && sessions.none { it.id == state.value.selectedId }) {
            selectLocal(null)
        }
        ensureInitialModels(api, generation)
    }

    private suspend fun ensureInitialModels(api: CoreTransport, generation: Int) {
        if (initialModelsGeneration == generation) return
        initialModelsGeneration = generation
        val sourceId = state.value.providerSourceId
        try {
            val models = api.rpc("listModels", WorkbenchProtocol.modelListFields(sourceId)) as JSONArray
            if (generation != epoch || sourceId != state.value.providerSourceId) return
            applyCatalog(sourceId, models, updateComposer = true)
        } catch (cancel: CancellationException) {
            throw cancel
        } catch (_: Exception) {
            // A catalog failure never disables conversations using the server default.
        }
    }

    private suspend fun syncHost(api: CoreTransport, generation: Int) {
        val revision = lifecycleRevision
        val result = api.rpc("getHostState") as JSONObject
        require(result.getInt("protocolVersion") == 1) { "不支持的 Core host 协议" }
        if (generation != epoch) return
        if (revision != lifecycleRevision) {
            scheduleRefresh()
            return
        }
        runs.clear()
        approvals.clear()
        result.getJSONArray("runs").objects().forEach { run ->
            val id = run.getString("runId")
            val sessionId = run.getString("sessionId")
            runs[id] = ActiveRun(id, sessionId, run.getString("status"))
            run.getJSONArray("pendingApprovals").objects().forEach { item ->
                val approval = parseApproval(item, id)
                approvals[approval.id] = approval
            }
        }
        projectRun()
    }

    private suspend fun loadPage(
        api: CoreTransport,
        generation: Int,
        earlier: Boolean = false,
    ): Boolean = pageMutex.withLock {
        val id = state.value.selectedId ?: return@withLock false
        val selected = selection
        if (generation != epoch || selected != selection) return@withLock false
        val fields = JSONObject().put("sessionId", id)
        val offset = transcript.offset
        if (earlier && (offset == null || offset == 0)) return@withLock false
        if (offset != null) fields.put("page", JSONObject().put(if (earlier) "before" else "from", offset))
        val result = api.rpc("getSessionPage", fields) as JSONObject
        if (generation != epoch || selected != selection) return@withLock false
        transcript.applyPage(result, prepend = earlier)
        val snapshot = result.getJSONObject("snapshot")
        val initial = projectedSelection != selected
        if (initial) projectedSelection = selected
        val source = if (initial) snapshot.string("providerSourceId") else state.value.providerSourceId
        val route = if (initial) snapshot.string("routeGroupId") else state.value.routeGroupId
        val model = if (initial) snapshot.string("model") else state.value.selectedModel
        val nextModels = when {
            !initial -> state.value.models
            route.isNotEmpty() -> emptyList()
            else -> cachedModels(source)
        }
        val metadata = WorkbenchProtocol.sessionMetadata(snapshot, state.value.workbench.obj("session")).toString()
        val workspace = snapshot.string("workspace").ifBlank { state.value.selectedWorkspace }
        change {
            it.copy(
                messages = transcript.messages(),
                title = transcript.title,
                hasEarlier = transcript.hasEarlier,
                loading = false,
                selectedWorkspace = workspace,
                providerSourceId = source,
                routeGroupId = route,
                selectedModel = model,
                models = nextModels,
                workbench = it.workbench.copy(
                    values = it.workbench.values + ("session" to metadata),
                ),
            )
        }
        if (state.value.connection == ConnectionPhase.Connected) ensureSelectedModels(generation)
        true
    }

    /**
     * Selecting a session can pin a provider source whose catalog has not been
     * fetched in this process yet. Load it once; failures stay isolated under
     * `models:<source>` and can be retried explicitly from settings.
     */
    private fun ensureSelectedModels(generation: Int) {
        if (generation != epoch || state.value.connection != ConnectionPhase.Connected) return
        val sourceId = state.value.providerSourceId
        if (sourceId.isEmpty()) return
        val key = WorkbenchProtocol.modelsKey(sourceId)
        if (key in state.value.workbench.values) return
        if (state.value.models.isNotEmpty()) return
        if (key in state.value.workbench.loading || key in state.value.workbench.errors) return
        loadModelCatalog(sourceId, refresh = false)
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
                } catch (cancel: CancellationException) {
                    throw cancel
                } catch (error: Exception) {
                    if (generation == epoch) showError(error)
                }
            } while (refreshRequested && generation == epoch)
        }
    }

    override fun refresh() {
        if (state.value.connection != ConnectionPhase.Connected) {
            reconnect()
            return
        }
        scheduleRefresh()
    }

    private fun selectLocal(id: String?) {
        persistDraft()
        selection++
        projectedSelection = -1
        clearSessionPanels()
        if (id == null) emptyTranscript.clear() else transcriptFor(id).resetPage()
        val current = state.value
        val keepComposerSelection = id == null
        persistedUncertain = uncertain(id)
        change {
            it.copy(
                selectedId = id,
                title = it.sessions.find { row -> row.id == id }?.title ?: "新的对话",
                messages = emptyList(),
                selectedModel = if (keepComposerSelection) current.selectedModel else "",
                models = if (keepComposerSelection) current.models else emptyList(),
                providerSourceId = if (keepComposerSelection) current.providerSourceId else "",
                routeGroupId = if (keepComposerSelection) current.routeGroupId else "",
                selectedWorkspace = when {
                    id == null && current.restrictWorkspace -> current.workspace
                    id == null -> current.selectedWorkspace.ifBlank { current.workspace }
                    else -> it.sessions.find { row -> row.id == id }?.workspace
                        ?.ifBlank { current.selectedWorkspace }
                        ?: current.selectedWorkspace
                },
                draft = storedDraft(id),
                draftImages = imagesFor(id),
                uncertain = persistedUncertain || pendingMutations.isNotEmpty(),
                hasEarlier = false,
                loadingEarlier = false,
                loading = id != null,
                error = null,
            )
        }
        preferences.edit().putString("session-${key(null)}", id).apply()
        projectRun()
    }

    override fun selectSession(id: String) {
        if (state.value.sending || state.value.busy || id == state.value.selectedId) return
        selectLocal(id)
        val api = transport
        if (api == null) {
            change { it.copy(loading = false) }
            return
        }
        val generation = epoch
        val selected = selection
        viewModelScope.launch {
            try {
                loadPage(api, generation)
            } catch (cancel: CancellationException) {
                throw cancel
            } catch (error: Exception) {
                if (generation == epoch && selected == selection) showError(error)
            } finally {
                if (generation == epoch && selected == selection) change { it.copy(loading = false) }
            }
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
            try {
                loadPage(api, generation, true)
            } catch (cancel: CancellationException) {
                throw cancel
            } catch (error: Exception) {
                if (generation == epoch && selected == selection) showError(error)
            } finally {
                if (generation == epoch && selected == selection) change { it.copy(loadingEarlier = false) }
            }
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
        if (permission !in PERMISSIONS) return
        val run = state.value.run
        if (run != null) {
            mutate("setRunPermission", JSONObject().put("runId", run.id).put("permission", permission)) { result ->
                if (result is String && result in PERMISSIONS) change { it.copy(permission = result) }
            }
            return
        }
        if (state.value.sending || state.value.busy) return
        // unrestricted is accepted only when the UI explicitly sends it after confirmation.
        change { it.copy(permission = permission) }
    }

    override fun send() {
        val api = transport ?: return
        val before = state.value
        val text = before.draft.trim()
        val images = before.draftImages.toList()
        if (!canMutate() || before.loading || before.run != null) return
        if (text.isEmpty() && images.isEmpty()) return
        val generation = epoch
        val originalId = before.selectedId
        val originalKey = key(originalId)
        var mutation = beginMutation()
        change { it.copy(sending = true, error = null) }
        viewModelScope.launch {
            var id = originalId
            var createAccepted = false
            var startAttempted = false
            try {
                if (id == null) {
                    val workspace = before.selectedWorkspace.ifBlank { before.workspace }
                    val source = validSourceForRequest(before.providerSourceId)
                    val route = validRouteForRequest(before.routeGroupId)
                    val input = WorkbenchProtocol.createSessionInput(
                        workspace = workspace,
                        model = validModelForRequest(before.selectedModel, source),
                        providerSourceId = source,
                        routeGroupId = route,
                    )
                    val sessionResult = api.rpc("createSession", JSONObject().put("input", input))
                    createAccepted = true
                    if (generation != epoch) return@launch
                    val session = sessionResult as? JSONObject
                        ?: throw IOException("createSession 返回了非对象响应")
                    val newId = session.getString("id")
                    id = newId
                    val createdKey = key(newId)
                    draftImagesByKey[createdKey] = images
                    draftImagesByKey.remove(originalKey)
                    transcripts.getOrPut(newId) { Transcript() }.clear()
                    selection++
                    projectedSelection = -1
                    clearSessionPanels()
                    upsertSession(session)
                    change {
                        it.copy(
                            selectedId = newId,
                            title = session.optString("title", "新的对话"),
                            messages = emptyList(),
                            selectedWorkspace = session.string("workspace").ifBlank { workspace },
                            selectedModel = session.string("model").ifBlank { before.selectedModel },
                            providerSourceId = session.string("providerSourceId"),
                            routeGroupId = session.string("routeGroupId"),
                            draft = before.draft,
                            draftImages = images,
                            loading = false,
                        )
                    }
                    preferences.edit().putString("session-${key(null)}", newId).apply()
                    persistDraft()
                    mutation = rekeyMutation(mutation, createdKey, newId)
                    storeSessionMetadata(session)
                }
                val sessionId = id ?: return@launch
                val source = validSourceForRequest(before.providerSourceId)
                val route = validRouteForRequest(before.routeGroupId)
                val input = WorkbenchProtocol.runInput(
                    sessionId = sessionId,
                    prompt = text,
                    images = images,
                    mode = before.mode,
                    permission = before.permission,
                    model = validModelForRequest(before.selectedModel, source),
                    providerSourceId = source,
                    routeGroupId = route,
                )
                startAttempted = true
                val startResult = api.rpc("startRun", JSONObject().put("input", input))
                if (generation != epoch) return@launch
                // ok:true means the run was accepted. Mapping failures below are
                // local display/sync failures; they must not become "unknown".
                settleMutation(mutation, keepUncertain = false)
                var mappingError: Exception? = null
                try {
                    val result = startResult as? JSONObject
                        ?: throw IOException("startRun 返回了非对象响应")
                    val runId = result.getString("runId")
                    if (runId !in finishedRuns) runs[runId] = ActiveRun(runId, sessionId, "running")
                    clearDraftAfterAccepted(sessionId, before, images, originalKey)
                    projectRun()
                } catch (error: Exception) {
                    mappingError = error
                }
                if (mappingError != null) {
                    runCatching { clearDraftAfterAccepted(sessionId, before, images, originalKey) }
                    showMappingError(mappingError)
                }
                scheduleRefresh()
            } catch (cancel: CancellationException) {
                throw cancel
            } catch (error: Exception) {
                if (generation == epoch) {
                    when {
                        startAttempted -> {
                            // startRun itself failed. RPC ok:false (status 0) may
                            // include partial service side effects, so it stays locked.
                            settleMutation(mutation, keepUncertain = !isDefiniteRejection(error))
                            showMutationError(error)
                        }
                        createAccepted -> {
                            // createSession was accepted, but its response could not
                            // be projected and no message was sent. Keep the lock so
                            // the user cannot accidentally create a duplicate.
                            settleMutation(mutation, keepUncertain = true)
                            showCreateMappingError(error)
                        }
                        else -> {
                            settleMutation(mutation, keepUncertain = !isDefiniteRejection(error))
                            showMutationError(error)
                        }
                    }
                    scheduleRefresh()
                }
            } finally {
                if (generation == epoch) change { it.copy(sending = false) }
            }
        }
    }

    private fun clearDraftAfterAccepted(
        sessionId: String,
        before: ChatUiState,
        images: List<ChatImage>,
        originalKey: String,
    ) {
        val current = state.value
        if (current.selectedId == sessionId &&
            current.draft == before.draft &&
            current.draftImages == images
        ) {
            draftImagesByKey.remove(key(sessionId))
            change { it.copy(draft = "", draftImages = emptyList()) }
        }
        if (originalKey != key(sessionId)) {
            preferences.edit().remove("draft-$originalKey").apply()
        }
        if (state.value.selectedId == sessionId) persistDraft()
    }

    private fun showCreateMappingError(error: Exception) {
        val detail = error.message?.take(256).orEmpty().ifBlank { "响应结构不符合预期" }
        change {
            it.copy(
                error = "Core 已确认创建会话，但本地无法完成后续发送：$detail。" +
                    "请刷新会话列表并核对后再手动继续，不要直接重发。",
                loading = false,
            )
        }
    }

    private fun canMutate(): Boolean =
        state.value.connection == ConnectionPhase.Connected &&
            !state.value.sending && !state.value.busy && !state.value.uncertain

    override fun stop() {
        val run = state.value.run ?: return
        mutate("cancelRun", JSONObject().put("runId", run.id))
    }

    override fun answerApproval(id: String, approved: Boolean) {
        val approval = state.value.allApprovals.find { it.id == id }
            ?: state.value.approvals.find { it.id == id }
            ?: return
        mutate(
            "answerApproval",
            JSONObject()
                .put("runId", approval.runId)
                .put("approvalId", id)
                .put("approved", approved),
        ) {
            approvals.remove(id)
            projectRun()
        }
    }

    private fun mutate(
        method: String,
        fields: JSONObject,
        section: String? = null,
        refresh: Boolean = true,
        onSuccess: (Any?) -> Unit = {},
    ) {
        val api = transport ?: return
        if (!canMutate()) return
        val generation = epoch
        val mutation = beginMutation()
        change { it.copy(busy = true, error = null) }
        viewModelScope.launch {
            try {
                val result = api.rpc(method, fields)
                if (generation != epoch) return@launch
                // Core confirmed success. Any later mapping error is a local
                // display/sync failure, not an unknown mutation outcome.
                settleMutation(mutation, keepUncertain = false)
                if (section != null) clearPanelError(section)
                var mappingError: Exception? = null
                try {
                    onSuccess(result)
                } catch (error: Exception) {
                    mappingError = error
                }
                if (mappingError != null) {
                    showMappingError(mappingError)
                    if (section != null) loadPanel(section)
                    scheduleRefresh()
                } else if (refresh) {
                    scheduleRefresh()
                }
            } catch (cancel: CancellationException) {
                throw cancel
            } catch (error: Exception) {
                if (generation == epoch) {
                    settleMutation(mutation, keepUncertain = !isDefiniteRejection(error))
                    showMutationError(error)
                    if (section != null) panelFailure(section, errorText(error))
                    if (refresh) scheduleRefresh()
                }
            } finally {
                if (generation == epoch) change { it.copy(busy = false) }
            }
        }
    }

    private fun errorText(error: Exception): String =
        if (error is CoreException || error is IllegalArgumentException) {
            error.message?.take(512) ?: "请求失败"
        } else {
            "网络或协议请求失败，请检查连接后刷新"
        }

    private fun showMutationError(error: Exception) {
        val suffix = when {
            error is IllegalArgumentException ->
                "。请求未发送（本地校验失败）；草稿和输入已保留。"
            isDefiniteRejection(error) ->
                "。服务器在进入业务处理前拒绝了请求，不会自动重试；草稿和输入已保留。"
            else ->
                "。结果未确认，可能已部分执行；草稿和输入已保留，请先检查历史与队列，不要直接重发。"
        }
        change { it.copy(error = errorText(error) + suffix, loading = false) }
    }

    private fun showMappingError(error: Exception) {
        val detail = error.message?.take(256).orEmpty().ifBlank { "响应结构不符合预期" }
        change {
            it.copy(
                error = "Core 已确认操作成功，但本地状态更新失败：$detail。正在刷新服务器状态，请勿重复提交。",
                loading = false,
            )
        }
    }

    private fun showError(error: Exception, mutation: Boolean = false) {
        val detail = if (error is CoreException || error is IllegalArgumentException) {
            error.message
        } else {
            "网络或协议请求失败，请检查连接后刷新"
        }
        change {
            it.copy(
                error = detail + if (mutation) {
                    "。结果未确认；草稿已保留，请先检查历史和任务状态，不要直接重发。"
                } else "",
                loading = false,
            )
        }
    }

    override fun dismissError() { change { it.copy(error = null) } }

    override fun acknowledgeUncertain() {
        if (state.value.connection == ConnectionPhase.Connected &&
            !state.value.sending && !state.value.busy
        ) {
            val sessionId = state.value.selectedId
            pendingMutations.values.removeAll { it.sessionId == sessionId }
            preferences.edit().putBoolean("uncertain-${key()}", false).apply()
            persistedUncertain = false
            refreshUncertainState()
        }
    }

    override fun reconnect() {
        val api = transport ?: return
        if (!foreground || state.value.sending || state.value.busy) return
        connectionJob?.cancel()
        eventStream?.close()
        change { it.copy(connection = ConnectionPhase.Reconnecting, connectionDetail = "正在恢复远端状态…") }
        val generation = epoch
        connectionJob = viewModelScope.launch { connectionLoop(api, generation) }
    }

    override fun disconnect() {
        if (state.value.sending || state.value.busy) return
        persistDraft()
        closeConnection()
        runs.clear()
        approvals.clear()
        finishedRuns.clear()
        initialModelsGeneration = -1
        clearAllPanels()
        change {
            it.copy(
                connection = ConnectionPhase.Disconnected,
                connectionDetail = "已断开 · 不会停止远端任务",
                run = null,
                approvals = emptyList(),
                allRuns = emptyList(),
                allApprovals = emptyList(),
                loading = false,
            )
        }
    }

    fun foreground(active: Boolean) {
        if (foreground == active) return
        foreground = active
        if (active) {
            if (transport != null) reconnect()
        } else {
            persistDraft()
            connectionJob?.cancel()
            eventStream?.close()
            eventStream = null
            if (transport != null) {
                change {
                    it.copy(
                        connection = ConnectionPhase.Paused,
                        connectionDetail = "已暂停实时连接 · 远端任务继续",
                    )
                }
            }
        }
    }

    private fun closeConnection() {
        epoch++
        connectionJob?.cancel()
        refreshJob?.cancel()
        eventStream?.close()
        transport?.close()
        transport = null
        eventStream = null
        cursor = null
    }

    override fun onCleared() { closeConnection() }

    // ---------------------------------------------------------------------
    // Workbench actions
    // ---------------------------------------------------------------------

    override fun setMode(mode: String) {
        if (mode in MODES) change { it.copy(mode = mode) }
    }

    override fun setThemeMode(mode: String) {
        if (mode !in THEMES) return
        preferences.edit().putString("theme-mode", mode).apply()
        change { it.copy(themeMode = mode) }
    }

    override fun setWorkspace(workspace: String) {
        if (state.value.selectedId != null) {
            panelNotice("工作区只能在新建会话时选择")
            return
        }
        val clean = workspace.trim()
        if (clean.isEmpty() || clean.length > 4_096 || clean.any { it.code < 32 || it.code == 127 }) {
            panelNotice("工作区路径无效")
            return
        }
        if (state.value.restrictWorkspace && clean != state.value.workspace) {
            panelNotice("Core 将此连接限制在启动工作区，不能改用其他目录")
            return
        }
        change { it.copy(selectedWorkspace = clean) }
    }

    override fun setModelSource(sourceId: String) {
        val clean = sourceId.trim()
        if (clean.isNotEmpty() && !WorkbenchProtocol.isProviderSourceId(clean)) {
            panelNotice("模型来源 ID 格式不正确")
            return
        }
        val sources = settingsSources()
        if (clean.isNotEmpty() && sources != null && sources.none { it.string("id") == clean }) {
            panelNotice("所选模型来源已不存在，请重新加载设置")
            return
        }
        val cached = cachedModels(clean)
        change {
            it.copy(
                providerSourceId = clean,
                routeGroupId = "",
                selectedModel = "",
                models = cached,
            )
        }
        if (transport != null && state.value.connection == ConnectionPhase.Connected) {
            loadModelCatalog(clean, refresh = false)
        }
    }

    override fun setRouteGroup(routeId: String) {
        val clean = routeId.trim()
        if (clean.length > 4_096) {
            panelNotice("路由组 ID 过长")
            return
        }
        val groups = settingsRouteGroups()
        if (clean.isNotEmpty() && groups != null && groups.none { it.string("id") == clean }) {
            panelNotice("所选路由组已不存在，请重新加载设置")
            return
        }
        change {
            if (clean.isEmpty()) {
                it.copy(routeGroupId = "")
            } else {
                // Route groups choose their own member source/model; a stale direct
                // pick must not be sent alongside the route.
                it.copy(routeGroupId = clean, providerSourceId = "", selectedModel = "", models = emptyList())
            }
        }
    }

    override fun loadPanel(section: String) {
        val api = transport
        if (api == null) {
            panelFailure(section, "尚未连接 Core")
            return
        }
        if (state.value.connection != ConnectionPhase.Connected) {
            panelFailure(section, "连接尚未就绪，请稍后重试")
            return
        }
        when (section) {
            "settings" -> loadGlobalPanel(section) { api.rpc("getSettings") }
            "usage" -> loadGlobalPanel(section) { api.rpc("getUsageStats") }
            "mcp" -> loadGlobalPanel(section) { api.rpc("listMcpServers") }
            "session" -> loadSessionPanel(api)
            "diagnostics" -> withSelected(section) { id ->
                loadScopedPanel(section, id) {
                    api.rpc("getDiagnostics", JSONObject().put("sessionId", id))
                }
            }
            "context" -> withSelected(section) { id ->
                loadScopedPanel(section, id) {
                    api.rpc("getProjectContext", JSONObject().put("sessionId", id))
                }
            }
            "checkpoints" -> withSelected(section) { id ->
                loadScopedPanel(section, id) {
                    api.rpc("listCheckpoints", JSONObject().put("sessionId", id))
                }
            }
            "files" -> withSelected(section) { id ->
                loadScopedPanel(section, id) {
                    api.rpc(
                        "listWorkspaceEntries",
                        JSONObject().put("sessionId", id).put("path", currentFilesPath),
                    )
                }
            }
            "preview" -> withSelected(section) { id ->
                if (currentPreviewPath.isEmpty()) {
                    panelFailure(section, "请选择要预览的文件")
                } else {
                    loadScopedPanel(section, id) {
                        api.rpc(
                            "readWorkspaceFile",
                            JSONObject().put("sessionId", id).put("path", currentPreviewPath),
                        )
                    }
                }
            }
            "queue" -> withSelected(section) { id ->
                loadScopedPanel(section, id) {
                    api.rpc("listInputs", JSONObject().put("sessionId", id))
                }
            }
            "diff" -> withSelected(section) { id ->
                if (currentCheckpointId.isEmpty()) {
                    panelFailure(section, "请选择检查点")
                } else {
                    loadScopedPanel(section, id) {
                        api.rpc(
                            "getCheckpointDiff",
                            JSONObject().put("sessionId", id).put("checkpointId", currentCheckpointId),
                        )
                    }
                }
            }
            else -> panelFailure(section, "未知面板")
        }
    }

    override fun dismissPanelNotice() { change { it.copy(workbench = it.workbench.copy(notice = null)) } }

    override fun saveSettings(settings: JSONObject) {
        val patch = try {
            WorkbenchProtocol.settingsPatch(settings)
        } catch (error: IllegalArgumentException) {
            panelFailure("settings", error.message ?: "设置内容无效")
            change { it.copy(error = error.message) }
            return
        }
        val fields = JSONObject().put("input", JSONObject().put("settings", patch))
        val theme = patch.optString("theme", "")
        mutate("updateSettings", fields, section = "settings", refresh = false) { result ->
            if (result !is JSONObject) throw IOException("Core 返回了无效的设置")
            applySettingsResult(result)
            if (theme in THEMES) setThemeMode(theme)
        }
    }

    override fun configureModelSource(operation: JSONObject) {
        val type = operation.optString("type", "")
        val removedId = if (type == "remove") operation.optString("id", "") else ""
        val savedId = if (type == "save") operation.optJSONObject("source")?.optString("id", "").orEmpty() else ""
        val fields = try {
            WorkbenchProtocol.configureSourceFields(operation)
        } catch (error: IllegalArgumentException) {
            panelFailure("settings", error.message ?: "模型来源内容无效")
            change { it.copy(error = error.message) }
            return
        }
        mutate("updateSettings", fields, section = "settings", refresh = false) { result ->
            if (result !is JSONObject) throw IOException("Core 返回了无效的设置")
            applySettingsResult(result)
            if (type == "remove" && removedId.isNotEmpty()) {
                sourceVersions[removedId] = (sourceVersions[removedId] ?: 0) + 1
                removeCatalog(removedId)
                if (state.value.providerSourceId == removedId) {
                    change { it.copy(providerSourceId = "", selectedModel = "", models = emptyList()) }
                }
            }
            if (type == "save" && savedId.isNotEmpty()) {
                // The endpoint or model list may have changed. Drop the old cache
                // but do not touch the current model/source selection.
                sourceVersions[savedId] = (sourceVersions[savedId] ?: 0) + 1
                removeCatalog(savedId)
            }
            panelNotice("模型来源设置已更新")
        }
    }

    override fun loadModelCatalog(sourceId: String, refresh: Boolean) {
        val key = WorkbenchProtocol.modelsKey(sourceId)
        if (sourceId.isNotEmpty() && !WorkbenchProtocol.isProviderSourceId(sourceId)) {
            panelFailure(key, "模型来源 ID 格式不正确")
            return
        }
        val api = transport
        if (api == null || state.value.connection != ConnectionPhase.Connected) {
            panelFailure(key, "连接尚未就绪，无法读取模型目录")
            return
        }
        val generation = epoch
        val version = nextSourceVersion(sourceId)
        panelLoading(key, loading = true)
        viewModelScope.launch {
            try {
                val result = api.rpc(
                    "listModels",
                    WorkbenchProtocol.modelListFields(sourceId, refresh),
                ) as? JSONArray ?: throw IOException("Core 返回了无效的模型目录")
                if (generation != epoch || version != sourceVersion(sourceId)) return@launch
                applyCatalog(sourceId, result, updateComposer = true)
            } catch (cancel: CancellationException) {
                throw cancel
            } catch (error: Exception) {
                if (generation == epoch && version == sourceVersion(sourceId)) {
                    panelFailure(key, errorText(error))
                }
            }
        }
    }

    override fun renameSession(id: String, title: String) {
        if (!WorkbenchProtocol.isUuid(id)) return
        val clean = title.trim()
        if (clean.isEmpty() || clean.length > 256) {
            change { it.copy(error = "会话标题必须为 1–256 个字符") }
            return
        }
        mutate("renameSession", JSONObject().put("sessionId", id).put("title", clean)) { result ->
            if (result is JSONObject) {
                upsertSession(result)
                if (state.value.selectedId == id) {
                    change { it.copy(title = result.string("title").ifBlank { clean }) }
                    storeSessionMetadata(result)
                }
            }
        }
    }

    override fun archiveSession(id: String, archived: Boolean) {
        if (!WorkbenchProtocol.isUuid(id)) return
        if (runs.values.any { it.sessionId == id }) {
            panelNotice("运行结束后才能归档该会话")
            return
        }
        mutate("archiveSession", JSONObject().put("sessionId", id).put("archived", archived)) { result ->
            if (result is JSONObject) {
                upsertSession(result)
                if (state.value.selectedId == id) storeSessionMetadata(result)
            }
        }
    }

    override fun forkSession(id: String) {
        if (!WorkbenchProtocol.isUuid(id)) return
        if (runs.values.any { it.sessionId == id }) {
            panelNotice("运行结束后才能创建分支")
            return
        }
        mutate("forkSession", JSONObject().put("sessionId", id)) { result ->
            if (result is JSONObject) {
                val newId = result.optString("id", "")
                if (WorkbenchProtocol.isUuid(newId)) {
                    upsertSession(result)
                    // A fork is accepted as a new conversation: switch explicitly
                    // rather than leaving the user with a hidden duplicate session.
                    persistDraft()
                    selection++
                    projectedSelection = -1
                    clearSessionPanels()
                    transcriptFor(newId).clear()
                    persistedUncertain = preferences.getBoolean("uncertain-${key(newId)}", false)
                    change {
                        it.copy(
                            selectedId = newId,
                            title = result.optString("title", "新的对话"),
                            messages = emptyList(),
                            selectedModel = "",
                            models = emptyList(),
                            providerSourceId = "",
                            routeGroupId = "",
                            selectedWorkspace = result.string("workspace").ifBlank { it.selectedWorkspace },
                            draft = storedDraft(newId),
                            draftImages = imagesFor(newId),
                            uncertain = persistedUncertain || pendingMutations.isNotEmpty(),
                            hasEarlier = false,
                            loadingEarlier = false,
                            loading = true,
                            error = null,
                        )
                    }
                    preferences.edit().putString("session-${key(null)}", newId).apply()
                    projectRun()
                    storeSessionMetadata(result)
                    scheduleRefresh()
                }
            }
        }
    }

    override fun compactSession() {
        val id = selectedIdOrFail("session") ?: return
        if (state.value.run != null) {
            panelNotice("运行结束后才能压缩会话")
            return
        }
        mutate("compactSession", JSONObject().put("sessionId", id), section = "session") { result ->
            if (result is JSONObject) {
                upsertSession(result)
                if (state.value.selectedId == id) {
                    transcriptFor(id).clear()
                    projectedSelection = -1
                    change { it.copy(messages = emptyList(), loading = true) }
                    storeSessionMetadata(result)
                    scheduleRefresh()
                }
            }
        }
    }

    override fun browseFiles(path: String) {
        val clean = normalizePanelPath(path)
        if (clean == null) {
            panelFailure("files", "文件路径无效")
            return
        }
        currentFilesPath = clean
        loadPanel("files")
    }

    override fun previewFile(path: String) {
        val clean = normalizePanelPath(path)
        if (clean == null) {
            panelFailure("preview", "文件路径无效")
            return
        }
        currentPreviewPath = clean
        loadPanel("preview")
    }

    override fun inspectCheckpoint(id: String) {
        if (!WorkbenchProtocol.isUuid(id)) {
            panelFailure("diff", "检查点 ID 格式不正确")
            return
        }
        currentCheckpointId = id
        loadPanel("diff")
    }

    override fun restoreCheckpoint(id: String) {
        val sessionId = selectedIdOrFail("diff") ?: return
        if (!WorkbenchProtocol.isUuid(id)) {
            panelFailure("diff", "检查点 ID 格式不正确")
            return
        }
        if (state.value.run != null) {
            panelNotice("运行结束后才能恢复检查点")
            return
        }
        mutate(
            "restoreCheckpoint",
            JSONObject().put("sessionId", sessionId).put("checkpointId", id),
            section = "diff",
            refresh = false,
        ) { result ->
            if (result is JSONObject) {
                upsertSession(result)
                if (state.value.selectedId == sessionId) {
                    transcriptFor(sessionId).clear()
                    projectedSelection = -1
                    change { it.copy(messages = emptyList(), loading = true) }
                    storeSessionMetadata(result)
                    scheduleRefresh()
                }
                panelNotice("检查点已恢复")
            }
        }
    }

    override fun setMcpEnabled(id: String, enabled: Boolean) {
        if (!WorkbenchProtocol.isMcpServerId(id)) {
            panelFailure("mcp", "MCP 服务器 ID 格式不正确")
            return
        }
        mutate(
            "setMcpEnabled",
            JSONObject().put("serverId", id).put("enabled", enabled),
            section = "mcp",
            refresh = false,
        ) {
            loadPanel("mcp")
            panelNotice(if (enabled) "MCP 服务器已启用" else "MCP 服务器已停用")
        }
    }

    override fun removeMcpServer(id: String) {
        if (!WorkbenchProtocol.isMcpServerId(id)) {
            panelFailure("mcp", "MCP 服务器 ID 格式不正确")
            return
        }
        mutate(
            "removeMcpServer",
            JSONObject().put("serverId", id),
            section = "mcp",
            refresh = false,
        ) {
            loadPanel("mcp")
            panelNotice("MCP 服务器已移除")
        }
    }

    override fun registerMcpServer(input: JSONObject) {
        val fields = try {
            WorkbenchProtocol.mcpRegisterFields(input)
        } catch (error: IllegalArgumentException) {
            panelFailure("mcp", error.message ?: "MCP 注册信息无效")
            return
        }
        mutate("registerMcpServer", fields, section = "mcp", refresh = false) {
            loadPanel("mcp")
            panelNotice("MCP 服务器已注册")
        }
    }

    override fun enqueueDraft() {
        val api = transport ?: return
        val before = state.value
        val id = selectedIdOrFail("queue") ?: return
        if (!canMutate()) return
        val text = before.draft.trim()
        val images = before.draftImages.toList()
        if (text.isEmpty() && images.isEmpty()) return
        val source = validSourceForRequest(before.providerSourceId)
        val route = validRouteForRequest(before.routeGroupId)
        val input = try {
            WorkbenchProtocol.runInput(
                sessionId = id,
                prompt = text,
                images = images,
                mode = before.mode,
                permission = before.permission,
                model = validModelForRequest(before.selectedModel, source),
                providerSourceId = source,
                routeGroupId = route,
            )
        } catch (error: IllegalArgumentException) {
            panelFailure("queue", error.message ?: "输入无效")
            return
        }
        // One generated UUID per explicit action. If the transport outcome is
        // unknown this request is never replayed with a fresh id.
        val inputId = UUID.randomUUID().toString()
        val fields = WorkbenchProtocol.enqueueInputFields(inputId, input)
        val generation = epoch
        val mutation = beginMutation()
        change { it.copy(busy = true, error = null) }
        viewModelScope.launch {
            try {
                api.rpc("enqueueInput", fields)
                if (generation != epoch) return@launch
                settleMutation(mutation, keepUncertain = false)
                val current = state.value
                if (current.selectedId == id && current.draft == before.draft && current.draftImages == images) {
                    draftImagesByKey.remove(key(id))
                    change { it.copy(draft = "", draftImages = emptyList()) }
                    persistDraft()
                }
                panelNotice("已加入 Core 输入队列")
                loadPanel("queue")
            } catch (cancel: CancellationException) {
                throw cancel
            } catch (error: Exception) {
                if (generation == epoch) {
                    settleMutation(mutation, keepUncertain = !isDefiniteRejection(error))
                    showMutationError(error)
                    panelFailure("queue", errorText(error))
                }
            } finally {
                if (generation == epoch) change { it.copy(busy = false) }
            }
        }
    }

    override fun steerDraft() {
        val api = transport ?: return
        val before = state.value
        val run = before.run ?: run {
            panelNotice("当前没有可插话的运行")
            return
        }
        if (!canMutate()) return
        val text = before.draft.trim()
        val images = before.draftImages.toList()
        if (text.isEmpty() && images.isEmpty()) return
        val fields = try {
            WorkbenchProtocol.steerRunFields(run.id, text, images)
        } catch (error: IllegalArgumentException) {
            panelNotice(error.message ?: "插话内容无效")
            return
        }
        val generation = epoch
        val mutation = beginMutation()
        change { it.copy(busy = true, error = null) }
        viewModelScope.launch {
            try {
                api.rpc("steerRun", fields)
                if (generation != epoch) return@launch
                settleMutation(mutation, keepUncertain = false)
                val current = state.value
                if (current.selectedId == run.sessionId &&
                    current.draft == before.draft &&
                    current.draftImages == images
                ) {
                    draftImagesByKey.remove(key(run.sessionId))
                    change { it.copy(draft = "", draftImages = emptyList()) }
                    persistDraft()
                }
                panelNotice("插话已发送给当前运行")
                scheduleRefresh()
            } catch (cancel: CancellationException) {
                throw cancel
            } catch (error: Exception) {
                if (generation == epoch) {
                    settleMutation(mutation, keepUncertain = !isDefiniteRejection(error))
                    showMutationError(error)
                }
            } finally {
                if (generation == epoch) change { it.copy(busy = false) }
            }
        }
    }

    override fun cancelQueuedInput(id: String) {
        val sessionId = selectedIdOrFail("queue") ?: return
        if (!WorkbenchProtocol.isUuid(id)) {
            panelFailure("queue", "队列输入 ID 格式不正确")
            return
        }
        mutate(
            "cancelInput",
            JSONObject().put("sessionId", sessionId).put("inputId", id),
            section = "queue",
            refresh = false,
        ) { result ->
            if (result == false) panelNotice("该队列项已不处于可取消状态")
            loadPanel("queue")
        }
    }

    override fun pauseQueue(paused: Boolean) {
        val sessionId = selectedIdOrFail("queue") ?: return
        val method = if (paused) "pauseInputs" else "resumeInputs"
        mutate(
            method,
            JSONObject().put("sessionId", sessionId),
            section = "queue",
            refresh = false,
        ) { result ->
            if (result is JSONObject) {
                putPanelValue("queue", result.toString())
            } else {
                loadPanel("queue")
            }
            panelNotice(if (paused) "输入队列已暂停" else "输入队列已继续")
        }
    }

    override fun addImages(uris: List<String>) {
        if (uris.isEmpty()) return
        val before = state.value
        if (before.draftImages.size >= WorkbenchProtocol.MAX_IMAGES) {
            change { it.copy(error = "最多添加 4 张图片") }
            return
        }
        val generation = epoch
        val selected = selection
        val sessionKey = key()
        val remaining = WorkbenchProtocol.MAX_IMAGES - before.draftImages.size
        val resolver = getApplication<Application>().contentResolver
        viewModelScope.launch {
            val loaded = withContext(Dispatchers.IO) {
                val result = mutableListOf<ChatImage>()
                var failed = false
                var limitHit = false
                for ((uriIndex, raw) in uris.withIndex()) {
                    if (result.size >= remaining) {
                        limitHit = true
                        break
                    }
                    val uri = runCatching { Uri.parse(raw) }.getOrNull()
                    if (uri == null || uri.scheme != ContentResolver.SCHEME_CONTENT) {
                        failed = true
                        continue
                    }
                    val bytes = readBoundedImage(resolver, uri)
                    if (bytes == null) {
                        failed = true
                        continue
                    }
                    val name = imageDisplayName(resolver, uri)
                    val image = runCatching {
                        WorkbenchProtocol.imageAttachment(bytes, name, before.draftImages.size + uriIndex + 1)
                    }.getOrNull()
                    if (image == null) failed = true else result.add(image)
                }
                Triple(result, failed, limitHit)
            }
            val images = loaded.first
            if (generation != epoch || selected != selection || key() != sessionKey) return@launch
            if (images.isNotEmpty()) {
                val current = state.value.draftImages
                val merged = (current + images).take(WorkbenchProtocol.MAX_IMAGES)
                draftImagesByKey[sessionKey] = merged
                change { it.copy(draftImages = merged) }
            }
            if (loaded.third) {
                change { it.copy(error = "最多添加 4 张图片") }
            } else if (loaded.second) {
                change {
                    it.copy(error = "部分图片无法读取或格式不受支持（PNG/JPEG/WebP/GIF，单张不超过 2 MiB）")
                }
            }
        }
    }

    override fun removeImage(index: Int) {
        val current = state.value.draftImages
        if (index !in current.indices) return
        val next = current.toMutableList().also { it.removeAt(index) }
        val sessionKey = key()
        if (next.isEmpty()) draftImagesByKey.remove(sessionKey) else draftImagesByKey[sessionKey] = next
        change { it.copy(draftImages = next) }
    }

    // ---------------------------------------------------------------------
    // Panel/request versioning and projections
    // ---------------------------------------------------------------------

    private fun selectedIdOrFail(section: String): String? {
        val id = state.value.selectedId
        if (id == null) panelFailure(section, "请先选择会话")
        return id
    }

    private fun withSelected(section: String, action: (String) -> Unit) {
        val id = selectedIdOrFail(section) ?: return
        action(id)
    }

    private fun loadSessionPanel(api: CoreTransport) {
        val id = state.value.selectedId
        if (id == null) {
            panelFailure("session", "请先选择会话")
            return
        }
        val generation = epoch
        val selected = selection
        val version = nextPanelVersion("session")
        panelLoading("session", loading = true)
        viewModelScope.launch {
            try {
                val applied = loadPage(api, generation)
                if (generation != epoch ||
                    version != panelVersion("session") ||
                    selected != selection ||
                    state.value.selectedId != id
                ) return@launch
                if (applied) {
                    panelSuccessNoValue("session")
                } else {
                    panelFailure("session", "会话记录未能更新，请重试")
                }
            } catch (cancel: CancellationException) {
                throw cancel
            } catch (error: Exception) {
                if (generation == epoch &&
                    version == panelVersion("session") &&
                    selected == selection &&
                    state.value.selectedId == id
                ) {
                    panelFailure("session", errorText(error))
                }
            }
        }
    }

    private fun loadGlobalPanel(section: String, request: suspend () -> Any?) {
        val generation = epoch
        val version = nextPanelVersion(section)
        panelLoading(section, loading = true)
        viewModelScope.launch {
            try {
                val result = request()
                if (generation != epoch || version != panelVersion(section)) return@launch
                panelSuccess(section, panelText(result))
                if (section == "settings" && result is JSONObject) {
                    reconcileSettingsSelection(result)
                }
            } catch (cancel: CancellationException) {
                throw cancel
            } catch (error: Exception) {
                if (generation == epoch && version == panelVersion(section)) {
                    panelFailure(section, errorText(error))
                }
            }
        }
    }

    private fun loadScopedPanel(section: String, id: String, request: suspend () -> Any?) {
        val generation = epoch
        val selected = selection
        val version = nextPanelVersion(section)
        panelLoading(section, loading = true)
        viewModelScope.launch {
            try {
                val result = request()
                if (generation != epoch ||
                    version != panelVersion(section) ||
                    selected != selection ||
                    state.value.selectedId != id
                ) return@launch
                panelSuccess(section, panelText(result))
            } catch (cancel: CancellationException) {
                throw cancel
            } catch (error: Exception) {
                if (generation == epoch &&
                    version == panelVersion(section) &&
                    selected == selection &&
                    state.value.selectedId == id
                ) {
                    panelFailure(section, errorText(error))
                }
            }
        }
    }

    private fun panelText(result: Any?): String = when (result) {
        is String -> result
        is JSONObject -> result.toString()
        is JSONArray -> result.toString()
        null, JSONObject.NULL -> "null"
        else -> result.toString()
    }

    private fun nextPanelVersion(section: String): Int {
        val version = (panelVersions[section] ?: 0) + 1
        panelVersions[section] = version
        return version
    }

    private fun panelVersion(section: String): Int = panelVersions[section] ?: 0

    private fun panelLoading(section: String, loading: Boolean) {
        change {
            val workbench = it.workbench
            it.copy(
                workbench = workbench.copy(
                    loading = if (loading) workbench.loading + section else workbench.loading - section,
                ),
            )
        }
    }

    private fun panelSuccess(section: String, value: String) {
        change {
            val workbench = it.workbench
            it.copy(
                workbench = workbench.copy(
                    values = workbench.values + (section to value),
                    loading = workbench.loading - section,
                    errors = workbench.errors - section,
                ),
            )
        }
    }

    private fun panelSuccessNoValue(section: String) {
        change {
            val workbench = it.workbench
            it.copy(
                workbench = workbench.copy(
                    loading = workbench.loading - section,
                    errors = workbench.errors - section,
                ),
            )
        }
    }

    private fun panelFailure(section: String, message: String) {
        change {
            val workbench = it.workbench
            it.copy(
                workbench = workbench.copy(
                    loading = workbench.loading - section,
                    errors = workbench.errors + (section to message),
                ),
            )
        }
    }

    private fun clearPanelError(section: String) {
        change {
            val workbench = it.workbench
            if (section !in workbench.errors) it else it.copy(
                workbench = workbench.copy(errors = workbench.errors - section),
            )
        }
    }

    private fun panelNotice(message: String) {
        change { it.copy(workbench = it.workbench.copy(notice = message)) }
    }

    /** Server-authoritative queue snapshot wins over an older in-flight list. */
    private fun putPanelValue(section: String, value: String) {
        nextPanelVersion(section)
        change {
            val workbench = it.workbench
            it.copy(
                workbench = workbench.copy(
                    values = workbench.values + (section to value),
                    loading = workbench.loading - section,
                    errors = workbench.errors - section,
                ),
            )
        }
    }

    private fun nextSourceVersion(sourceId: String): Int {
        val version = (sourceVersions[sourceId] ?: 0) + 1
        sourceVersions[sourceId] = version
        return version
    }

    private fun sourceVersion(sourceId: String): Int = sourceVersions[sourceId] ?: 0

    private fun applyCatalog(
        sourceId: String,
        models: JSONArray,
        updateComposer: Boolean,
    ) {
        val names = models.strings()
        val key = WorkbenchProtocol.modelsKey(sourceId)
        val update = updateComposer && sourceId == state.value.providerSourceId
        change {
            val workbench = it.workbench
            it.copy(
                models = if (update) names else it.models,
                workbench = workbench.copy(
                    values = workbench.values + (key to models.toString()),
                    loading = workbench.loading - key,
                    errors = workbench.errors - key,
                ),
            )
        }
    }

    private fun removeCatalog(sourceId: String) {
        val key = WorkbenchProtocol.modelsKey(sourceId)
        change {
            val workbench = it.workbench
            it.copy(
                workbench = workbench.copy(
                    values = workbench.values - key,
                    loading = workbench.loading - key,
                    errors = workbench.errors - key,
                ),
            )
        }
    }

    private fun cachedModels(sourceId: String): List<String> {
        val raw = state.value.workbench.values[WorkbenchProtocol.modelsKey(sourceId)] ?: return emptyList()
        return runCatching { JSONArray(raw).strings() }.getOrDefault(emptyList())
    }

    private fun applySettingsResult(result: JSONObject) {
        nextPanelVersion("settings")
        change {
            val workbench = it.workbench
            it.copy(
                workbench = workbench.copy(
                    values = workbench.values + ("settings" to result.toString()),
                    loading = workbench.loading - "settings",
                    errors = workbench.errors - "settings",
                ),
            )
        }
        reconcileSettingsSelection(result)
    }

    /**
     * A settings refresh/update must not leave a removed source or route selected.
     * It never silently upgrades permissions or changes the local theme preference.
     */
    private fun reconcileSettingsSelection(settings: JSONObject) {
        val sources = settings.optJSONArray("providerSources")
        val sourceIds = sources?.objects()?.map { it.string("id") }?.toSet()
        val routeIds = settings.optJSONArray("routeGroups")?.objects()?.map { it.string("id") }?.toSet()
        val source = state.value.providerSourceId
        val route = state.value.routeGroupId
        if (source.isNotEmpty() && sourceIds != null && source !in sourceIds) {
            change { it.copy(providerSourceId = "", selectedModel = "", models = emptyList()) }
        }
        if (route.isNotEmpty() && routeIds != null && route !in routeIds) {
            change { it.copy(routeGroupId = "") }
        }
    }

    private fun settingsSources(): List<JSONObject>? =
        state.value.workbench.obj("settings")?.optJSONArray("providerSources")?.objects()

    private fun settingsRouteGroups(): List<JSONObject>? =
        state.value.workbench.obj("settings")?.optJSONArray("routeGroups")?.objects()

    private fun validSourceForRequest(sourceId: String): String {
        if (sourceId.isEmpty() || !WorkbenchProtocol.isProviderSourceId(sourceId)) return ""
        val sources = settingsSources() ?: return sourceId
        return sourceId.takeIf { id -> sources.any { it.string("id") == id } }.orEmpty()
    }

    private fun validRouteForRequest(routeId: String): String {
        if (routeId.isEmpty() || routeId.length > 4_096) return ""
        val routes = settingsRouteGroups() ?: return routeId
        return routeId.takeIf { id -> routes.any { it.string("id") == id } }.orEmpty()
    }

    private fun validModelForRequest(model: String, sourceId: String): String {
        val clean = model.trim()
        if (clean.isEmpty() || clean.length > 256) return ""
        val catalog = cachedModels(sourceId)
        if (catalog.isNotEmpty()) return clean.takeIf { it in catalog }.orEmpty()
        val current = state.value.models
        if (sourceId == state.value.providerSourceId && current.isNotEmpty()) {
            return clean.takeIf { it in current }.orEmpty()
        }
        return clean
    }

    private fun storeSessionMetadata(snapshot: JSONObject) {
        val metadata = WorkbenchProtocol.sessionMetadata(snapshot, state.value.workbench.obj("session")).toString()
        if (state.value.workbench.values["session"] == metadata) return
        change {
            it.copy(
                workbench = it.workbench.copy(
                    values = it.workbench.values + ("session" to metadata),
                ),
            )
        }
    }

    private fun upsertSession(snapshot: JSONObject) {
        val summary = runCatching { parseSession(snapshot) }.getOrNull() ?: return
        val sessions = state.value.sessions.toMutableList()
        val index = sessions.indexOfFirst { it.id == summary.id }
        if (index >= 0) sessions[index] = summary else sessions.add(summary)
        sessions.sortByDescending { it.updatedAt }
        change { it.copy(sessions = sessions) }
    }

    private fun normalizePanelPath(path: String): String? {
        val clean = path.trim().ifEmpty { "." }
        if (clean.length > 4_096 || clean.any { it.code < 32 || it.code == 127 }) return null
        return clean
    }

    private fun imagesFor(id: String?): List<ChatImage> = draftImagesByKey[key(id)].orEmpty()

    private fun refreshQueueIfLoaded() {
        val state = state.value
        if (state.selectedId == null || state.connection != ConnectionPhase.Connected) return
        if ("queue" in state.workbench.values || "queue" in state.workbench.errors) {
            loadPanel("queue")
        }
    }

    private fun clearSessionPanels() {
        for (section in SESSION_PANELS) nextPanelVersion(section)
        currentFilesPath = "."
        currentPreviewPath = ""
        currentCheckpointId = ""
        change {
            val workbench = it.workbench
            it.copy(
                workbench = workbench.copy(
                    values = workbench.values - SESSION_PANELS,
                    loading = workbench.loading - SESSION_PANELS,
                    errors = workbench.errors - SESSION_PANELS,
                    notice = null,
                ),
            )
        }
    }

    private fun clearAllPanels() {
        for (section in ALL_PANELS) nextPanelVersion(section)
        sourceVersions.clear()
        change { it.copy(workbench = WorkbenchData()) }
    }

    private fun imageDisplayName(resolver: ContentResolver, uri: Uri): String? = runCatching {
        resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) cursor.getString(0) else null
        }
    }.getOrNull()

    /**
     * Read at most 2 MiB + one buffer. Oversize images are rejected without
     * decoding the rest, and only content:// URIs chosen by the user are opened.
     */
    private fun readBoundedImage(resolver: ContentResolver, uri: Uri): ByteArray? = runCatching {
        resolver.openInputStream(uri)?.use { input ->
            val output = ByteArrayOutputStream()
            val buffer = ByteArray(32 * 1024)
            var total = 0
            while (true) {
                val read = input.read(buffer)
                if (read < 0) break
                total += read
                if (total > WorkbenchProtocol.MAX_IMAGE_BYTES) return@use null
                output.write(buffer, 0, read)
            }
            if (total < 12) null else output.toByteArray()
        }
    }.getOrNull()

    companion object {
        private val MODES = setOf("plan", "build")
        private val THEMES = setOf("system", "light", "dark")
        private val PERMISSIONS = setOf("readonly", "workspace", "unrestricted")
        private val REFRESH_EVENTS = setOf(
            "run_started",
            "run_finished",
            "generation_finished",
            "tool_finished",
            "approval_resolved",
            "title_changed",
            "plan_updated",
            "agent_update",
            "context_compacted",
            "permission_changed",
        )
        private val SESSION_PANELS = setOf(
            "session",
            "diagnostics",
            "context",
            "checkpoints",
            "files",
            "preview",
            "diff",
            "queue",
        )
        private val ALL_PANELS = SESSION_PANELS + setOf("settings", "usage", "mcp")
    }
}
