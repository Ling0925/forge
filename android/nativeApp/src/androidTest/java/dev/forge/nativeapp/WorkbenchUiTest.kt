package dev.forge.nativeapp

import android.os.ParcelFileDescriptor
import androidx.compose.ui.graphics.toPixelMap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.lifecycle.ViewModelProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** Rendered navigation checks. Run on phone and wide emulator configurations. */
@RunWith(AndroidJUnit4::class)
class WorkbenchUiTest {
    @get:Rule val ui = createAndroidComposeRule<MainActivity>()
    private val model get() = ViewModelProvider(ui.activity)[ChatViewModel::class.java]

    @Test fun originalWorkbenchNavigationSettingsAndRenderedThemes() {
        ui.runOnIdle { model.setThemeMode("light") }
        ui.onNodeWithTag("settings").performClick()
        ui.onNodeWithTag("connection-url").performTextReplacement("http://127.0.0.1:18765/")
        ui.onNodeWithTag("connect").performScrollTo().assertIsDisplayed().performClick()
        await { it.connection == ConnectionPhase.Connected }
        ui.onNodeWithTag("new-chat").performClick()
        ui.onNodeWithText("今天，想做点什么？").assertIsDisplayed()
        capture("forge-workbench-home-light.png")

        ui.onNodeWithTag("composer").performTextReplacement("workbench")
        ui.onNodeWithTag("send").assertIsEnabled().performClick()
        await { !it.sending && it.run == null && it.messages.any { row -> row.role == "assistant" } }
        hideKeyboard()
        capture("forge-workbench-chat-light.png")

        ui.onNodeWithTag("inspector-toggle").performClick()
        ui.onNodeWithTag("inspector").assertIsDisplayed()
        ui.onNodeWithTag("inspector-tab-progress").performClick()
        capture("forge-workbench-progress-light.png")
        ui.onNodeWithTag("inspector-tab-files").performClick()
        ui.onNodeWithTag("inspector-files-browser").performClick()
        await { "files" !in it.workbench.loading && it.workbench.obj("files") != null }
        ui.onNodeWithText("README.md").performScrollTo().performClick()
        await { "preview" !in it.workbench.loading && it.workbench.obj("preview") != null }
        assertNull(model.state.value.workbench.errors["preview"])
        capture("forge-workbench-files-light.png")
        // The header is shared between task and inspector; settings stays reachable.
        ui.onNodeWithTag("settings").performClick()
        ui.onNodeWithTag("settings-page").assertIsDisplayed()
        ui.onNodeWithTag("settings-category-appearance").performScrollTo().performClick()
        ui.onNodeWithText("深色").performScrollTo().performClick()
        await { it.themeMode == "dark" }
        capture("forge-workbench-settings-dark.png")
        ui.onNodeWithTag("panel-back").performClick()
        ui.runOnIdle { ui.activity.onBackPressedDispatcher.onBackPressed() }
        ui.waitForIdle()
        val pixels = ui.onRoot().captureToImage().toPixelMap()
        val background = pixels[2, pixels.height / 2]
        assertTrue("Actual dark surface must be rendered", background.red < .2f && background.green < .2f && background.blue < .2f)
        capture("forge-workbench-chat-dark.png")

        // Open the real source/model selection surface without issuing a new run.
        ui.runOnIdle { model.selectModel("fixture-offline") }
        ui.onNodeWithTag("model-picker").performClick()
        val modelBounds = ui.onNodeWithTag("model-picker-panel").getUnclippedBoundsInRoot()
        assertTrue("Model dialog must stay bounded on wide screens",
            (modelBounds.right - modelBounds.left).value <= 561f)
        ui.onNode(hasScrollToNodeAction() and hasAnyAncestor(hasTestTag("model-picker-panel")))
            .performScrollToNode(hasText("重新读取"))
        ui.onNodeWithText("重新读取").assertIsDisplayed().performClick()
        await { "models:${it.providerSourceId}" !in it.workbench.loading }
        assertEquals("Refreshing a catalog must not clear selection", "fixture-offline", model.state.value.selectedModel)
        ui.onAllNodesWithText("fixture-offline").assertAny(hasText("fixture-offline"))
        capture("forge-workbench-model-dark.png")
        ui.runOnIdle { ui.activity.onBackPressedDispatcher.onBackPressed() }
        ui.waitForIdle()
        ui.onNodeWithContentDescription("会话列表").performClick()
        capture("forge-workbench-sidebar-dark.png")
        ui.onNodeWithTag("usage").performClick()
        ui.onNodeWithTag("usage-page").assertIsDisplayed()
        await { "usage" !in it.workbench.loading && it.workbench.obj("usage") != null }
        capture("forge-workbench-usage-dark.png")
        ui.onNodeWithTag("panel-back").performClick()
        ui.runOnIdle { model.setThemeMode("system") }
    }

    private fun await(predicate: (ChatUiState) -> Boolean) {
        ui.waitUntil(20_000) { predicate(model.state.value) }
        ui.waitForIdle()
    }
    private fun hideKeyboard() {
        ui.runOnIdle {
            WindowCompat.getInsetsController(ui.activity.window, ui.activity.window.decorView)
                .hide(WindowInsetsCompat.Type.ime())
        }
        ui.waitForIdle()
    }
    private fun capture(name: String) {
        hideKeyboard()
        ui.onAllNodes(isRoot()).onFirst().assertExists()
        android.os.SystemClock.sleep(250)
        val descriptor = InstrumentationRegistry.getInstrumentation().uiAutomation
            .executeShellCommand("screencap -p /sdcard/Download/$name")
        ParcelFileDescriptor.AutoCloseInputStream(descriptor).use { it.readBytes() }
    }
}
