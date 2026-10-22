package dev.forge.nativeapp

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class TranscriptTest {
    @Test fun snapshotAndStreamShareAnAbsoluteMessageIdentity() {
        val transcript = Transcript()
        transcript.applyPage(page(0, message("user", "hello")))
        transcript.event(event("generation_started").put("messageIndex", 1))
        transcript.event(event("text_delta").put("text", "Hello"))
        transcript.event(event("reasoning_delta").put("text", "Thinking separately"))
        transcript.applyPage(page(0, message("user", "hello"), message("assistant", "Hel").put("generationId", "g1")))
        assertEquals(2, transcript.messages().size)
        assertEquals("Hello", transcript.messages().last().text)
        assertEquals("Thinking separately", transcript.messages().last().reasoning)
        transcript.event(event("generation_finished"))
        transcript.applyPage(page(0, message("user", "hello"), message("assistant", "Hello!").put("generationId", "g1")))
        assertEquals(2, transcript.messages().size)
        assertEquals("Hello!", transcript.messages().last().text)
        assertFalse(transcript.messages().last().isStreaming)
    }

    @Test fun earlierPagePrependAndRefreshDoNotRenumberOrDuplicate() {
        val transcript = Transcript()
        transcript.applyPage(page(2, message("user", "second"), message("assistant", "reply2")))
        assertTrue(transcript.hasEarlier)
        transcript.applyPage(page(0, message("user", "first"), message("assistant", "reply1")), prepend = true)
        assertFalse(transcript.hasEarlier)
        assertEquals(listOf("m0", "m1", "m2", "m3"), transcript.messages().map { it.key })
        transcript.applyPage(page(0, message("user", "first"), message("assistant", "reply1"), message("user", "second"), message("assistant", "reply2")))
        assertEquals(4, transcript.messages().size)
    }

    @Test fun retryDoesNotKeepFailedTextOrReasoning() {
        val transcript = Transcript()
        transcript.event(event("generation_started").put("messageIndex", 0))
        transcript.event(event("text_delta").put("text", "wrong"))
        transcript.event(event("reasoning_delta").put("text", "old reasoning"))
        transcript.event(event("retry_reset"))
        transcript.event(event("generation_started").put("generationId", "g2").put("messageIndex", 0))
        transcript.event(event("text_delta").put("generationId", "g2").put("text", "correct"))
        assertEquals("correct", transcript.messages().single().text)
        assertEquals("", transcript.messages().single().reasoning)
    }

    @Test fun boundedRecoveryNeverShortensDurableText() {
        val transcript = Transcript()
        transcript.applyPage(page(0, message("assistant", "a complete durable response").put("generationId", "g1")))
        transcript.event(event("generation_started").put("messageIndex", 0))
        transcript.event(event("text_delta").put("text", "response"))
        assertEquals("a complete durable response", transcript.messages().single().text)
    }

    @Test fun systemPromptsAreNotRenderedAndImageOnlyMessagesRemainVisible() {
        val transcript = Transcript()
        transcript.applyPage(page(0, message("system", "instructions"), message("user", "").put("images", JSONArray().put(JSONObject()))))
        assertEquals(1, transcript.messages().size)
        assertEquals(1, transcript.messages().single().imageCount)
        assertEquals("m1", transcript.messages().single().key)
    }

    @Test fun switchingSessionDiscardsLiveAndDurableState() {
        val transcript = Transcript()
        transcript.applyPage(page(5, message("user", "old server")))
        transcript.event(event("generation_started").put("messageIndex", 6))
        transcript.event(event("text_delta").put("text", "old stream"))
        transcript.clear()
        assertTrue(transcript.messages().isEmpty())
        assertNull(transcript.offset)
        assertFalse(transcript.hasEarlier)
    }

    @Test fun switchingBackToRunningSessionKeepsItsLiveGeneration() {
        val transcript = Transcript()
        transcript.applyPage(page(0, message("user", "hello")))
        transcript.event(event("generation_started").put("messageIndex", 1))
        transcript.event(event("text_delta").put("text", "live"))
        transcript.resetPage()
        transcript.applyPage(page(0, message("user", "hello")))
        transcript.event(event("text_delta").put("text", " reply"))
        assertEquals("live reply", transcript.messages().last().text)
        assertTrue(transcript.messages().last().isStreaming)
    }

    @Test fun unpersistedCancelledReplyDoesNotOverwriteNextUserMessage() {
        val transcript = Transcript()
        transcript.event(event("generation_started").put("messageIndex", 1))
        transcript.event(event("text_delta").put("text", "cancelled partial"))
        transcript.event(event("run_finished"))
        transcript.event(event("run_started"))
        transcript.applyPage(page(0, message("user", "first"), message("user", "second")))
        assertEquals(listOf("first", "second"), transcript.messages().map { it.text })
    }

    private fun event(type: String) = JSONObject().put("type", type).put("generationId", "g1")
    private fun message(role: String, content: String) = JSONObject().put("role", role).put("content", content)
    private fun page(offset: Int, vararg messages: JSONObject) = JSONObject()
        .put("snapshot", JSONObject().put("title", "Test").put("model", "fixture")
            .put("messages", JSONArray(messages.toList())))
        .put("page", JSONObject().put("messageOffset", offset).put("hasMore", offset > 0))
}
