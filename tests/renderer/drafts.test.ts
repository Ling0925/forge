import { describe, expect, it } from "vitest";
import { parseDrafts } from "../../src/renderer/state/drafts";
describe("untrusted prompt draft storage", () => {
  it("accepts session prompt strings", () => {
    expect(parseDrafts('{"session":"keep this","new":"task"}')).toEqual({
      session: "keep this",
      new: "task",
    });
  });
  it.each([
    "null",
    "[]",
    "42",
    "true",
    '"text"',
    '{"session":false}',
    '{"session":{"apiKey":"secret"}}',
    "{broken",
  ])("rejects invalid unknown: %s", (value) => {
    expect(parseDrafts(value)).toEqual({});
  });
  it("rejects oversized prompts", () => {
    expect(
      parseDrafts(JSON.stringify({ session: "x".repeat(1000001) })),
    ).toEqual({});
  });
});
