package dev.forge.nativeapp

import android.content.res.Configuration
import androidx.compose.ui.graphics.toPixelMap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ViewModelProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** Requires tests/native-core-fixture.mjs + adb reverse tcp:18765 tcp:18765. No live model. */
@RunWith(AndroidJUnit4::class)
class NativeChatTest {
    @get:Rule val ui = createAndroidComposeRule<MainActivity>()
    private val model get() = ViewModelProvider(ui.activity)[ChatViewModel::class.java]

    @Test fun realCoreChatApprovalCancelDraftRotationAndReconnect() {
        connect()
        ui.onNodeWithTag("new-chat").performClick()
        send("hello")
        await { it.run == null && !it.sending && it.messages.any { row -> row.role == "user" && row.text == "hello" } &&
            it.messages.any { row -> row.text == "Hello from the offline Forge Core fixture." } }
        assertEquals(1, model.state.value.messages.count { it.role == "user" && it.text == "hello" })
        assertEquals(1, model.state.value.messages.count { it.role == "assistant" })
        val sessionId = model.state.value.selectedId!!
        val title = model.state.value.title
        capture("native-chat-light.png")

        send("approval")
        await { it.approvals.size == 1 && !it.sending && it.messages.count { row -> row.role == "user" && row.text == "approval" } == 1 }
        ui.onNodeWithTag("transcript").performScrollToNode(hasTestTag("deny-approval"))
        ui.onNodeWithTag("deny-approval").performScrollTo().assertIsDisplayed().performClick()
        await { it.run == null && !it.busy && it.messages.any { row -> row.text.contains("审批被拒绝") } }

        send("approval")
        await { it.approvals.size == 1 && !it.sending && it.messages.count { row -> row.role == "user" && row.text == "approval" } == 2 }
        ui.onNodeWithTag("transcript").performScrollToNode(hasTestTag("allow-approval"))
        ui.onNodeWithTag("allow-approval").performScrollTo().assertIsDisplayed()
        capture("native-approval-light.png")
        ui.onNodeWithTag("allow-approval").performClick()
        await { it.run == null && !it.busy && it.messages.any { row -> row.text.contains("已完成离线审批") } }

        send("slow")
        await { it.run != null && !it.sending && it.messages.any { row -> row.isStreaming } }
        ui.onNodeWithTag("composer").performTextReplacement("下一条草稿，不要自动发送")
        ui.activityRule.scenario.recreate()
        await { it.connection == ConnectionPhase.Connected && it.run != null }
        ui.onNodeWithTag("composer").assertTextContains("下一条草稿，不要自动发送")
        ui.onNodeWithTag("new-chat").performClick()
        ui.onNodeWithContentDescription("会话列表").performClick()
        ui.onNodeWithText(title).performClick()
        await { it.selectedId == sessionId && !it.loading && it.run != null && it.messages.any { row -> row.isStreaming } }
        ui.onNodeWithTag("composer").assertTextContains("下一条草稿，不要自动发送")
        ui.onNodeWithTag("stop").assertIsDisplayed().performClick()
        await { it.run == null && !it.busy }
        assertEquals("下一条草稿，不要自动发送", model.state.value.draft)

        // A paused UI is detached, not a remote task cancellation or an automatic input replay.
        ui.activityRule.scenario.moveToState(Lifecycle.State.CREATED)
        ui.activityRule.scenario.moveToState(Lifecycle.State.RESUMED)
        await { it.connection == ConnectionPhase.Connected }
        assertEquals(sessionId, model.state.value.selectedId)
        assertEquals("下一条草稿，不要自动发送", model.state.value.draft)

        ui.onNodeWithTag("new-chat").performClick()
        ui.onNodeWithTag("composer").performTextReplacement("新会话草稿")
        ui.onNodeWithContentDescription("会话列表").performClick()
        ui.onNodeWithText(title).performClick()
        await { it.selectedId == sessionId && !it.loading && it.hasEarlier }
        assertEquals("下一条草稿，不要自动发送", model.state.value.draft)
        ui.onNodeWithTag("transcript").performScrollToNode(hasTestTag("earlier"))
        val count = model.state.value.messages.size
        ui.onNodeWithTag("earlier").performClick()
        await { !it.loadingEarlier && it.messages.size > count }
        assertEquals(model.state.value.messages.size, model.state.value.messages.map { it.key }.toSet().size)

        // Local disconnect retains drafts and disables send; reconnect reads server state.
        ui.onNodeWithTag("settings").performClick()
        ui.onNodeWithText("断开连接（不停止远端任务）").performScrollTo().performClick()
        await { it.connection == ConnectionPhase.Disconnected }
        ui.onNodeWithTag("send").assertIsNotEnabled()
        assertEquals("下一条草稿，不要自动发送", model.state.value.draft)
        connect()
        await { it.selectedId == sessionId && !it.loading }
        assertEquals("下一条草稿，不要自动发送", model.state.value.draft)

        // Render the actual dark system theme on the device, then restore its prior mode.
        val manager = ui.activity.getSystemService(android.app.UiModeManager::class.java)
        val previous = manager.nightMode
        try {
            shell("cmd uimode night yes")
            ui.waitUntil(5000) { ui.activity.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK == Configuration.UI_MODE_NIGHT_YES }
            await { it.connection == ConnectionPhase.Connected }
            ui.waitUntil(5000) {
                val pixels = ui.onRoot().captureToImage().toPixelMap()
                val background = pixels[2, pixels.height / 2]
                background.red < 0.1f && background.green < 0.1f && background.blue < 0.1f
            }
            // Wait for the platform's activity-change surface animation, not just Compose idle.
            android.os.SystemClock.sleep(500)
            capture("native-chat-dark.png")
        } finally {
            shell("cmd uimode night ${when (previous) {
                android.app.UiModeManager.MODE_NIGHT_YES -> "yes"
                android.app.UiModeManager.MODE_NIGHT_NO -> "no"
                else -> "auto"
            }}")
        }
    }

    private fun connect() {
        ui.onNodeWithTag("settings").performClick()
        ui.onNodeWithTag("connection-url").performTextReplacement("http://127.0.0.1:18765/")
        ui.onNodeWithTag("connect").performClick()
        await { it.connection == ConnectionPhase.Connected }
    }
    private fun send(text: String) {
        ui.onNodeWithTag("composer").performTextReplacement(text)
        ui.onNodeWithTag("send").assertIsEnabled().performClick()
    }
    private fun await(predicate: (ChatUiState) -> Boolean) {
        ui.waitUntil(20_000) { predicate(model.state.value) }
        ui.waitForIdle()
    }
    private fun capture(name: String) {
        ui.onRoot().assertIsDisplayed()
        // Shell-owned test artifact survives AGP uninstalling the debug app after the test.
        shell("screencap -p /sdcard/Download/$name")
    }
    private fun shell(command: String) {
        val descriptor = InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand(command)
        android.os.ParcelFileDescriptor.AutoCloseInputStream(descriptor).use { it.readBytes() }
    }
}
