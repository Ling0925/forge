package dev.forge.nativeapp

import android.content.ContentValues
import android.graphics.Bitmap
import android.provider.MediaStore
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.assertIsDisplayed
import androidx.lifecycle.ViewModelProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** Real Activity + real Core HTTP/WS/controller, with an isolated offline service. */
@RunWith(AndroidJUnit4::class)
class WorkbenchIntegrationTest {
    @get:Rule val ui = createAndroidComposeRule<MainActivity>()
    private val model get() = ViewModelProvider(ui.activity)[ChatViewModel::class.java]

    @Test fun sessionActionsPanelsSettingsAndFilesUseCore() {
        connect()
        act { newChat(); setMode("build"); setPermission("readonly"); updateDraft("workbench"); send() }
        await { it.selectedId != null && !it.sending && it.run == null && it.messages.any { row -> row.role == "assistant" } }
        val id = model.state.value.selectedId!!
        assertEquals("build", model.state.value.mode)
        assertEquals("readonly", model.state.value.permission)

        act { renameSession(id, "Android 工作台迁移验收") }
        await { !it.busy && it.title == "Android 工作台迁移验收" }
        act { archiveSession(id, true) }
        await { !it.busy && it.sessions.any { row -> row.id == id && row.archived } }
        act { archiveSession(id, false) }
        await { !it.busy && it.sessions.any { row -> row.id == id && !row.archived } }

        load("settings")
        act { saveSettings(JSONObject().put("reasoningEffort", "high")) }
        await { !it.busy && it.workbench.obj("settings")?.optString("reasoningEffort") == "high" }
        act { saveSettings(JSONObject().put("requestTimeoutMs", 65000)) }
        await { !it.busy && it.workbench.obj("settings")?.optInt("requestTimeoutMs") == 65000 }
        load("usage")
        assertTrue(model.state.value.workbench.obj("usage")!!.getInt("totalSessions") > 0)
        load("diagnostics")
        assertTrue(model.state.value.workbench.obj("diagnostics")!!.getInt("messageCount") > 0)
        load("context")
        assertEquals(model.state.value.workspace, model.state.value.workbench.obj("context")!!.getString("workspace"))
        load("checkpoints")
        load("mcp")

        act { browseFiles(".") }
        await { "files" !in it.workbench.loading && it.workbench.obj("files") != null }
        assertNull(model.state.value.workbench.errors["files"])
        val entries = model.state.value.workbench.obj("files")!!.getJSONArray("entries").objects()
        val readme = entries.first { it.getString("name") == "README.md" }
        act { previewFile(readme.getString("path")) }
        await { "preview" !in it.workbench.loading && it.workbench.obj("preview") != null }
        assertNull(model.state.value.workbench.errors["preview"])
        assertTrue(model.state.value.workbench.obj("preview")!!.getString("content").isNotEmpty())

        // A fork must select the new session and must not inherit the old session's panel data.
        act { forkSession(id) }
        await { !it.busy && !it.loading && it.selectedId != null && it.selectedId != id }
        assertTrue(model.state.value.messages.isNotEmpty())
        assertNull(model.state.value.workbench.obj("preview"))
        act { setThemeMode("dark") }
        assertEquals("dark", model.state.value.themeMode)
        ui.activityRule.scenario.recreate()
        await { it.connection == ConnectionPhase.Connected }
        assertEquals("dark", model.state.value.themeMode)
        act { setThemeMode("system") }
    }

    @Test fun modelSourceCatalogAndExplicitQueueActions() {
        connect()
        load("settings")
        val sourceId = "android-${System.nanoTime().toString(36)}"
        val source = JSONObject().put("id", sourceId).put("label", "Android 测试来源")
            .put("baseUrl", "http://127.0.0.1:1/v1").put("model", "fixture-offline")
            .put("apiMode", "chat-completions")
        act { configureModelSource(JSONObject().put("type", "save").put("source", source)) }
        await { !it.busy && it.workbench.obj("settings")?.optJSONArray("providerSources")?.objects()?.any { row -> row.string("id") == sourceId } == true }
        act { loadModelCatalog(sourceId, true) }
        await { "models:$sourceId" !in it.workbench.loading && "models:$sourceId" in it.workbench.values }
        assertNull(model.state.value.workbench.errors["models:$sourceId"])
        act { setModelSource(sourceId) }
        await { it.providerSourceId == sourceId && it.models.isNotEmpty() }
        act { newChat(); updateDraft("slow"); send() }
        await { !it.sending && it.run != null && it.messages.any { row -> row.isStreaming } }
        act { pauseQueue(true) }
        await { !it.busy && it.workbench.obj("queue")?.optBoolean("paused") == true }
        act { updateDraft("排队消息由用户明确取消"); enqueueDraft() }
        await { !it.busy && !it.sending && it.draft.isEmpty() && it.workbench.obj("queue")?.optJSONArray("items")?.length()?.let { count -> count > 0 } == true }
        val queued = model.state.value.workbench.obj("queue")!!.getJSONArray("items").objects()
            .first { it.string("state") == "queued" }
        act { cancelQueuedInput(queued.getString("inputId")) }
        await { !it.busy && it.workbench.obj("queue")?.optJSONArray("items")?.objects()?.none { row -> row.string("inputId") == queued.getString("inputId") && row.string("state") == "queued" } == true }
        act { stop() }
        await { !it.busy && it.run == null }
        assertFalse(model.state.value.messages.any { it.role == "user" && it.text == "排队消息由用户明确取消" })
        act { setModelSource("") }
    }

    @Test fun imageOnlyDraftSurvivesSessionSwitchAndIsSentOnce() {
        connect()
        act { newChat(); updateDraft("image-owner"); send() }
        await { !it.sending && it.run == null && it.messages.any { row -> row.role == "assistant" } }
        val id = model.state.value.selectedId!!
        val resolver = ui.activity.contentResolver
        val metadata = ContentValues().apply {
            put(MediaStore.Images.Media.DISPLAY_NAME, "forge-native-test.png")
            put(MediaStore.Images.Media.MIME_TYPE, "image/png")
            put(MediaStore.Images.Media.RELATIVE_PATH, "Pictures/ForgeNativeTest")
        }
        val uri = requireNotNull(resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, metadata))
        try {
            val bitmap = Bitmap.createBitmap(2, 2, Bitmap.Config.ARGB_8888)
            resolver.openOutputStream(uri)!!.use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
            bitmap.recycle()
            act { addImages(listOf(uri.toString())) }
            await { it.draftImages.size == 1 }
            ui.waitUntil(5_000) {
                ui.onAllNodesWithContentDescription("forge-native-test.png").fetchSemanticsNodes().isNotEmpty()
            }
            ui.onAllNodesWithContentDescription("forge-native-test.png")[0].assertIsDisplayed()
            act { newChat() }
            assertTrue(model.state.value.draftImages.isEmpty())
            act { selectSession(id) }
            await { !it.loading && it.selectedId == id && it.draftImages.size == 1 }
            act { updateDraft(""); send() }
            await { !it.sending && it.run == null && it.draftImages.isEmpty() && it.messages.any { row -> row.role == "user" && row.images.size == 1 } }
            assertEquals(1, model.state.value.messages.count { it.role == "user" && it.images.size == 1 })
        } finally {
            resolver.delete(uri, null, null)
        }
    }

    private fun connect() {
        act { connect("http://127.0.0.1:18765/", "", false) }
        await { it.connection == ConnectionPhase.Connected }
    }
    private fun load(section: String) {
        act { loadPanel(section) }
        await { section !in it.workbench.loading && (section in it.workbench.values || section in it.workbench.errors) }
        assertNull("$section: ${model.state.value.workbench.errors[section]}", model.state.value.workbench.errors[section])
    }
    private fun act(block: ChatViewModel.() -> Unit) { ui.runOnIdle { model.block() } }
    private fun await(predicate: (ChatUiState) -> Boolean) {
        ui.waitUntil(20_000) { predicate(model.state.value) }
        ui.waitForIdle()
    }
}
