package dev.forge.nativeapp

import java.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class WorkbenchProtocolTest {
    private val pngBase64 =
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
    private val pngBytes: ByteArray = Base64.getDecoder().decode(pngBase64)
    private val pngDataUrl = "data:image/png;base64,$pngBase64"
    private val sessionId = "11111111-1111-4111-8111-111111111111"
    private val runId = "22222222-2222-4222-8222-222222222222"
    private val inputId = "33333333-3333-4333-8333-333333333333"

    @Test fun settingsPatchKeepsOnlyWritableConfigureFields() {
        val publicEcho = JSONObject()
            .put("reasoningEffort", "high")
            .put("requestTimeoutMs", 65_000)
            .put("theme", "dark")
            .put("hasApiKey", true)
            .put("isConfigured", true)
            .put("providerSources", JSONArray().put(JSONObject().put("id", "source")))
            .put("routeGroups", JSONArray())
            .put("activeSourceId", "source")
            .put("environmentOverride", false)

        val patch = WorkbenchProtocol.settingsPatch(publicEcho)

        assertEquals(3, patch.length())
        assertEquals("high", patch.getString("reasoningEffort"))
        assertEquals(65_000, patch.getInt("requestTimeoutMs"))
        assertEquals("dark", patch.getString("theme"))
        assertFalse(patch.has("hasApiKey"))
        assertFalse(patch.has("isConfigured"))
        assertFalse(patch.has("providerSources"))
        assertFalse(patch.has("routeGroups"))
        assertFalse(patch.has("activeSourceId"))
        assertFalse(patch.has("environmentOverride"))

        val wrapped = WorkbenchProtocol.settingsUpdateFields(publicEcho)
        val wire = wrapped.getJSONObject("input").getJSONObject("settings")
        assertEquals("high", wire.getString("reasoningEffort"))
        assertFalse(wire.has("hasApiKey"))
    }

    @Test fun settingsPatchRejectsInvalidValuesAndEmptyPatches() {
        assertThrows(IllegalArgumentException::class.java) {
            WorkbenchProtocol.settingsPatch(JSONObject().put("reasoningEffort", "turbo"))
        }
        assertThrows(IllegalArgumentException::class.java) {
            WorkbenchProtocol.settingsPatch(JSONObject().put("requestTimeoutMs", 999))
        }
        assertThrows(IllegalArgumentException::class.java) {
            WorkbenchProtocol.settingsPatch(
                JSONObject().put("baseUrl", "http://user:pass@example.test/v1"),
            )
        }
        assertThrows(IllegalArgumentException::class.java) {
            WorkbenchProtocol.settingsPatch(JSONObject().put("hasApiKey", true))
        }
    }

    @Test fun runInputProjectsOnlySchemaFieldsAndAllowsImageOnlyInput() {
        val image = ChatImage("pixel.png", pngDataUrl)
        val input = WorkbenchProtocol.runInput(
            sessionId = sessionId,
            prompt = "  hello  ",
            images = listOf(image),
            mode = "build",
            permission = "workspace",
            model = "fixture-model",
            providerSourceId = "source-id",
            routeGroupId = "route-id",
        )

        assertEquals("hello", input.getString("prompt"))
        assertEquals("build", input.getString("mode"))
        assertEquals("workspace", input.getString("permission"))
        assertEquals("fixture-model", input.getString("model"))
        assertEquals("source-id", input.getString("providerSourceId"))
        assertEquals("route-id", input.getString("routeGroupId"))
        assertFalse(input.has("reasoningEffort"))
        assertEquals(1, input.getJSONArray("images").length())

        val imageOnly = WorkbenchProtocol.runInput(
            sessionId = sessionId,
            prompt = "   ",
            images = listOf(image),
        )
        assertEquals("", imageOnly.getString("prompt"))
        assertTrue(imageOnly.has("images"))

        assertThrows(IllegalArgumentException::class.java) {
            WorkbenchProtocol.runInput(sessionId, "text", mode = "inspect")
        }
        assertThrows(IllegalArgumentException::class.java) {
            WorkbenchProtocol.runInput(sessionId, "   ")
        }
    }

    @Test fun enqueueAndSteerUseTheRealWireShapes() {
        val runInput = WorkbenchProtocol.runInput(sessionId, "queued", mode = "plan")
        val enqueue = WorkbenchProtocol.enqueueInputFields(inputId, runInput)
        assertEquals(inputId, enqueue.getJSONObject("input").getString("inputId"))
        val enqueuedInput = enqueue.getJSONObject("input").getJSONObject("input")
        assertEquals(sessionId, enqueuedInput.getString("sessionId"))
        assertEquals("plan", enqueuedInput.getString("mode"))

        val steer = WorkbenchProtocol.steerRunFields(
            runId,
            " steer ",
            listOf(ChatImage("pixel.png", pngDataUrl)),
        )
        assertEquals(runId, steer.getString("runId"))
        assertEquals("steer", steer.getString("prompt"))
        assertFalse(steer.has("sessionId"))
        assertEquals(1, steer.getJSONArray("images").length())
    }

    @Test fun sourceOperationsWrapConfigureInputWithoutEchoingSettings() {
        val source = JSONObject()
            .put("id", "android-source")
            .put("label", "Android Source")
            .put("baseUrl", "http://127.0.0.1:1/v1")
            .put("model", "fixture-offline")
            .put("apiMode", "chat-completions")
        val save = JSONObject()
            .put("type", "save")
            .put("expectedRevision", 2)
            .put("apiKey", "secret-in-request-only")
            .put("source", source)

        val saveWire = WorkbenchProtocol.configureSourceFields(save)
        val input = saveWire.getJSONObject("input")
        assertFalse(input.has("settings"))
        val operation = input.getJSONObject("source")
        assertEquals("save", operation.getString("type"))
        assertEquals(2, operation.getInt("expectedRevision"))
        assertEquals("secret-in-request-only", operation.getString("apiKey"))
        assertEquals("android-source", operation.getJSONObject("source").getString("id"))

        val activate = WorkbenchProtocol.sourceOperation(
            JSONObject().put("type", "activate").put("id", "android-source"),
        )
        assertEquals("activate", activate.getString("type"))
        assertEquals("android-source", activate.getString("id"))

        val remove = WorkbenchProtocol.sourceOperation(
            JSONObject()
                .put("type", "remove")
                .put("id", "android-source")
                .put("forgottenSessionIds", JSONArray().put(sessionId)),
        )
        assertEquals(1, remove.getJSONArray("forgottenSessionIds").length())

        assertThrows(IllegalArgumentException::class.java) {
            WorkbenchProtocol.sourceOperation(
                JSONObject().put("type", "save").put("source", source).put("unexpected", true),
            )
        }
        assertThrows(IllegalArgumentException::class.java) {
            WorkbenchProtocol.sourceOperation(JSONObject().put("type", "activate").put("id", "Bad ID"))
        }
    }

    @Test fun modelCatalogFieldsAndKeysArePerSource() {
        assertEquals("models:android-source", WorkbenchProtocol.modelsKey("android-source"))
        assertEquals("models:", WorkbenchProtocol.modelsKey(""))

        val scoped = WorkbenchProtocol.modelListFields("android-source", refresh = true)
        assertEquals("android-source", scoped.getString("sourceId"))
        assertTrue(scoped.getBoolean("refresh"))

        val global = WorkbenchProtocol.modelListFields("", refresh = false)
        assertFalse(global.has("sourceId"))
        assertFalse(global.has("refresh"))

        assertThrows(IllegalArgumentException::class.java) {
            WorkbenchProtocol.modelListFields("Bad ID")
        }
    }

    @Test fun sessionMetadataDropsTranscriptButKeepsWorkbenchProjections() {
        val snapshot = JSONObject()
            .put("id", sessionId)
            .put("title", "Session")
            .put("messages", JSONArray().put(JSONObject().put("role", "user")))
            .put("events", JSONArray().put(JSONObject().put("type", "run_started")))
            .put("plans", JSONArray().put(JSONObject().put("id", "plan")))
            .put("subagents", JSONArray().put(JSONObject().put("id", "child")))
            .put("changes", JSONArray().put(JSONObject().put("path", "README.md")))
            .put("contextSummary", JSONObject().put("tokens", 12))
            .put("providerSourceId", "android-source")

        val metadata = WorkbenchProtocol.sessionMetadata(snapshot)

        assertFalse(metadata.has("messages"))
        assertFalse(metadata.has("events"))
        assertEquals(sessionId, metadata.getString("id"))
        assertEquals(1, metadata.getJSONArray("plans").length())
        assertEquals(1, metadata.getJSONArray("subagents").length())
        assertEquals(1, metadata.getJSONArray("changes").length())
        assertEquals(12, metadata.getJSONObject("contextSummary").getInt("tokens"))
        assertEquals("android-source", metadata.getString("providerSourceId"))
    }

    @Test fun inspectorFactsAreBoundedAndOlderPagesCannotReplaceNewerFacts() {
        fun context(time: String, tokens: Int) = JSONObject().put("type", "context_usage")
            .put("timestamp", time).put("usage", JSONObject().put("usedTokens", tokens))
        val current = WorkbenchProtocol.sessionMetadata(JSONObject().put("id", sessionId)
            .put("events", JSONArray().put(context("2026-10-23T01:00:00Z", 100))))
        val older = JSONObject().put("id", sessionId).put("events", JSONArray()
            .put(context("2026-10-22T01:00:00Z", 20))
            .put(JSONObject().put("type", "text_delta").put("text", "not a workbench fact")))
        val merged = WorkbenchProtocol.sessionMetadata(older, current)
        assertEquals(1, merged.getJSONArray("workbenchEvents").length())
        assertEquals(100, merged.getJSONArray("workbenchEvents").getJSONObject(0).getJSONObject("usage").getInt("usedTokens"))
        val other = WorkbenchProtocol.sessionMetadata(JSONObject().put("id", "other"), current)
        assertEquals(0, other.getJSONArray("workbenchEvents").length())
        val agents = JSONArray()
        repeat(100) { agents.put(JSONObject().put("type", "agent_update").put("childSessionId", "child-$it")) }
        assertEquals(64, WorkbenchProtocol.sessionMetadata(JSONObject().put("id", sessionId).put("events", agents))
            .getJSONArray("workbenchEvents").length())
    }

    @Test fun imageValidationUsesMagicBytesAndHistoryKeepsWireCount() {
        assertEquals("image/png", WorkbenchProtocol.detectImageMime(pngBytes))
        assertTrue(WorkbenchProtocol.validImageDataUrl(pngDataUrl))
        assertFalse(
            WorkbenchProtocol.validImageDataUrl(
                "data:image/jpeg;base64,$pngBase64",
            ),
        )
        assertFalse(WorkbenchProtocol.validImageDataUrl("data:image/png;base64,AAAA"))

        val attachment = WorkbenchProtocol.imageAttachment(
            pngBytes,
            "../../private/photo.png",
            1,
        )
        assertEquals("photo.png", attachment.name)
        assertEquals(pngDataUrl, attachment.dataUrl)
        assertNull(WorkbenchProtocol.detectImageMime(ByteArray(16)))

        val invalid = JSONObject()
        val valid = JSONObject().put("name", "pixel.png").put("dataUrl", pngDataUrl)
        assertEquals(1, WorkbenchProtocol.parseImageAttachments(JSONArray().put(invalid).put(valid)).size)

        val transcript = Transcript()
        val snapshot = JSONObject()
            .put("title", "Images")
            .put("model", "fixture-model")
            .put(
                "messages",
                JSONArray().put(
                    JSONObject()
                        .put("role", "user")
                        .put("content", "")
                        .put("images", JSONArray().put(invalid).put(valid)),
                ),
            )
        transcript.applyPage(
            JSONObject()
                .put("snapshot", snapshot)
                .put(
                    "page",
                    JSONObject().put("messageOffset", 0).put("hasMore", false),
                ),
        )
        val message = transcript.messages().single()
        assertEquals(2, message.imageCount)
        assertEquals(1, message.images.size)
        assertEquals("pixel.png", message.images.single().name)
    }

    @Test fun createSessionAndHandshakeUseRealOptionalFieldRules() {
        val create = WorkbenchProtocol.createSessionInput(
            workspace = " /workspace ",
            title = " Title ",
            model = "fixture-model",
            providerSourceId = "android-source",
            routeGroupId = "route-id",
        )
        assertEquals("/workspace", create.getString("workspace"))
        assertEquals("Title", create.getString("title"))
        assertEquals("fixture-model", create.getString("model"))
        assertEquals("android-source", create.getString("providerSourceId"))
        assertEquals("route-id", create.getString("routeGroupId"))
        assertFalse(create.has("mode"))
        assertFalse(create.has("permission"))
        assertFalse(create.has("reasoningEffort"))

        assertTrue(WorkbenchProtocol.handshakeRestriction(JSONObject()))
        assertTrue(WorkbenchProtocol.handshakeRestriction(JSONObject().put("restrictWorkspace", true)))
        assertFalse(WorkbenchProtocol.handshakeRestriction(JSONObject().put("restrictWorkspace", false)))
    }
}
