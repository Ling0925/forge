import { describe, expect, it } from "vitest";
import {
  CODE_HIGHLIGHT_MAX_CHARS,
  SUPPORTED_CODE_LANGUAGES,
  highlightCode,
  splitHighlightTokensIntoLines,
} from "../../src/renderer/state/code-highlight";

function joinedText(tokens: readonly { readonly text: string }[]): string {
  return tokens.map((token) => token.text).join("");
}

describe("lightweight code highlighting", () => {
  it.each(SUPPORTED_CODE_LANGUAGES)(
    "preserves original text exactly for supported language %s",
    (language) => {
      const code = sampleFor(language);
      const highlighted = highlightCode(code, language);

      expect(highlighted.language).toBe(language);
      expect(highlighted.highlighted).toBe(true);
      expect(highlighted.reason).toBeUndefined();
      expect(joinedText(highlighted.tokens)).toBe(code);
    },
  );

  it("normalizes common aliases", () => {
    expect(highlightCode("const x: number = 1;", "language-ts").language).toBe(
      "typescript",
    );
    expect(highlightCode("echo ok", "sh").language).toBe("bash");
    expect(highlightCode("<p>x</p>", "xml").language).toBe("html");
  });

  it("marks recognizable token kinds without changing text", () => {
    const code = "const answer = 42; // keep\n";
    const highlighted = highlightCode(code, "ts");

    expect(joinedText(highlighted.tokens)).toBe(code);
    expect(highlighted.tokens).toEqual(
      expect.arrayContaining([
        { kind: "keyword", text: "const" },
        { kind: "number", text: "42" },
        { kind: "comment", text: "// keep" },
      ]),
    );
  });

  it("treats unknown languages as plain text", () => {
    const code = "custom <unsafe> & text";
    const highlighted = highlightCode(code, "made-up-lang");

    expect(highlighted).toEqual({
      highlighted: false,
      language: "text",
      reason: "unsupported-language",
      tokens: [{ kind: "plain", text: code }],
    });
  });

  it("falls back to plain text for explicit text blocks", () => {
    const code = "plain text only";
    const highlighted = highlightCode(code, "text");

    expect(highlighted.highlighted).toBe(false);
    expect(highlighted.reason).toBe("unsupported-language");
    expect(joinedText(highlighted.tokens)).toBe(code);
  });

  it("falls back to plain text for oversized supported blocks", () => {
    const code = "x".repeat(CODE_HIGHLIGHT_MAX_CHARS + 1);
    const highlighted = highlightCode(code, "typescript");

    expect(highlighted.highlighted).toBe(false);
    expect(highlighted.language).toBe("typescript");
    expect(highlighted.reason).toBe("too-long");
    expect(highlighted.tokens).toEqual([{ kind: "plain", text: code }]);
  });

  it("splits highlighted tokens into display lines without losing characters", () => {
    const code = "const a = 1;\n\nconst b = 2;";
    const highlighted = highlightCode(code, "typescript");
    const lines = splitHighlightTokensIntoLines(highlighted.tokens);

    expect(lines).toHaveLength(3);
    expect(lines.map((line) => joinedText(line))).toEqual([
      "const a = 1;",
      "",
      "const b = 2;",
    ]);
    expect(lines.map((line) => joinedText(line)).join("\n")).toBe(code);
  });

  it("keeps a trailing newline as a trailing empty display line", () => {
    const code = "echo ok\n";
    const highlighted = highlightCode(code, "bash");
    const lines = splitHighlightTokensIntoLines(highlighted.tokens);

    expect(lines.map((line) => joinedText(line))).toEqual(["echo ok", ""]);
  });
});

function sampleFor(
  language: (typeof SUPPORTED_CODE_LANGUAGES)[number],
): string {
  switch (language) {
    case "bash":
      return 'if [ -f package.json ]; then\n  echo "ok" # comment\nfi';
    case "css":
      return ".card {\n  color: #123;\n  display: none;\n}";
    case "diff":
      return "@@ -1 +1 @@\n-old\n+new";
    case "html":
      return '<section data-id="1"><!-- safe --><span>Hi</span></section>';
    case "javascript":
      return "export function run() {\n  return 1;\n}";
    case "json":
      return '{\n  "ok": true,\n  "count": 2\n}';
    case "python":
      return "def run():\n    return True  # yes";
    case "typescript":
      return "interface Box {\n  value: string;\n}";
  }
}

it("treats inherited object property names as unknown languages", () => {
  for (const language of ["constructor", "__proto__", "toString"]) {
    expect(highlightCode("const x = 1;", language).highlighted).toBe(false);
  }
});
