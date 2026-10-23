package dev.forge.nativeapp

import org.json.JSONArray
import org.json.JSONObject

/** Immutable wire snapshots: JSON is parsed on demand, never mutated in UI state. */
data class WorkbenchData(
    val values: Map<String, String> = emptyMap(),
    val loading: Set<String> = emptySet(),
    val errors: Map<String, String> = emptyMap(),
    val notice: String? = null,
) {
    fun obj(section: String): JSONObject? = values[section]?.let { runCatching { JSONObject(it) }.getOrNull() }
    fun array(section: String): List<JSONObject> = values[section]?.let {
        runCatching { JSONArray(it).objects() }.getOrDefault(emptyList())
    }.orEmpty()
}

/** Images are kept in memory only; never placed in preferences or saved-instance state. */
data class ChatImage(val name: String, val dataUrl: String)

/** Panel names: settings, usage, diagnostics, context, checkpoints, mcp, files, preview, queue.
 * `session` comes from the paged session snapshot; `diff` contains plain text, not JSON.
 * Every mutation must retain the same no-replay/uncertain-outcome protection as sending.
 */
interface WorkbenchActions {
    fun setMode(mode: String)
    fun setThemeMode(mode: String)
    fun setWorkspace(workspace: String)
    fun setModelSource(sourceId: String)
    fun setRouteGroup(routeId: String)
    fun loadPanel(section: String)
    fun dismissPanelNotice()
    /** Patch only explicit settings fields; do not echo public settings wholesale. */
    fun saveSettings(settings: JSONObject)
    /** Core ConfigureInput.source; secret input is never persisted or echoed into state. */
    fun configureModelSource(operation: JSONObject)
    /** Independent source catalog stored as JSON string array under `models:<sourceId>`. */
    fun loadModelCatalog(sourceId: String, refresh: Boolean = false)
    fun renameSession(id: String, title: String)
    fun archiveSession(id: String, archived: Boolean)
    fun forkSession(id: String)
    fun compactSession()
    fun browseFiles(path: String = ".")
    fun previewFile(path: String)
    fun inspectCheckpoint(id: String)
    fun restoreCheckpoint(id: String)
    fun setMcpEnabled(id: String, enabled: Boolean)
    fun removeMcpServer(id: String)
    fun registerMcpServer(input: JSONObject)
    fun enqueueDraft()
    fun steerDraft()
    fun cancelQueuedInput(id: String)
    fun pauseQueue(paused: Boolean)
    fun addImages(uris: List<String>)
    fun removeImage(index: Int)
}
