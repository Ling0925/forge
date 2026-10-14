import { describe, expect, it } from "vitest";
import {
  TranscriptScrollState,
  isNearTranscriptTail,
} from "../../src/renderer/state/transcript-scroll";

const tail = { scrollTop: 700, scrollHeight: 1000, clientHeight: 300 };
const history = { ...tail, scrollTop: 100 };

describe("transcript scroll following", () => {
  it("follows arriving tokens at the tail and tolerates small rounding distances", () => {
    const state = new TranscriptScrollState();
    state.readPosition({ ...tail, scrollTop: 650 });
    expect(state.contentArrived()).toBe(true);
    expect(state.hasNewContent).toBe(false);
    expect(isNearTranscriptTail({ ...tail, scrollTop: 600 })).toBe(false);
  });
  it("never pulls the reader down, and retains the new-content indication across tokens", () => {
    const state = new TranscriptScrollState();
    state.readPosition(history);
    expect(state.contentArrived()).toBe(false);
    expect(state.contentArrived()).toBe(false);
    expect(state.hasNewContent).toBe(true);
    state.readPosition({ ...history, scrollTop: 200 });
    expect(state.hasNewContent).toBe(true);
  });
  it("explicit jump and session reset resume following without leaking unread state", () => {
    const state = new TranscriptScrollState();
    state.readPosition(history);
    state.contentArrived();
    state.reset();
    expect(state.following).toBe(true);
    expect(state.hasNewContent).toBe(false);
    expect(state.contentArrived()).toBe(true);
  });
  it("manually returning to the tail resumes following", () => {
    const state = new TranscriptScrollState();
    state.readPosition(history);
    state.contentArrived();
    state.readPosition(tail);
    expect(state.hasNewContent).toBe(false);
    expect(state.contentArrived()).toBe(true);
  });
  it("disclosure inspection preserves reading position and does not fabricate new content", () => {
    const state = new TranscriptScrollState();
    state.inspectDisclosure();
    expect(state.following).toBe(false);
    expect(state.hasNewContent).toBe(false);
    expect(state.contentArrived()).toBe(false);
    expect(state.hasNewContent).toBe(true);
  });
});
