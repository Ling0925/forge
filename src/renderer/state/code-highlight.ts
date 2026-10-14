export type CodeTokenKind =
  | "plain"
  | "comment"
  | "keyword"
  | "string"
  | "number"
  | "operator"
  | "punctuation"
  | "property"
  | "tag"
  | "attribute"
  | "meta"
  | "inserted"
  | "deleted";

export interface CodeHighlightToken {
  readonly kind: CodeTokenKind;
  readonly text: string;
}

export type SupportedCodeLanguage =
  | "bash"
  | "css"
  | "diff"
  | "html"
  | "javascript"
  | "json"
  | "python"
  | "typescript";

export type CodeHighlightReason =
  | "too-long"
  | "too-many-tokens"
  | "unsupported-language";

export interface HighlightedCode {
  readonly language: SupportedCodeLanguage | "text";
  readonly highlighted: boolean;
  readonly tokens: readonly CodeHighlightToken[];
  readonly reason?: CodeHighlightReason;
}

export const CODE_HIGHLIGHT_MAX_CHARS = 60_000;
export const CODE_HIGHLIGHT_MAX_TOKENS = 8_000;

export const SUPPORTED_CODE_LANGUAGES: readonly SupportedCodeLanguage[] = [
  "bash",
  "css",
  "diff",
  "html",
  "javascript",
  "json",
  "python",
  "typescript",
];

const LANGUAGE_ALIASES: Readonly<
  Record<string, SupportedCodeLanguage | "text">
> = {
  bash: "bash",
  cjs: "javascript",
  css: "css",
  diff: "diff",
  htm: "html",
  html: "html",
  javascript: "javascript",
  js: "javascript",
  json: "json",
  jsx: "javascript",
  mjs: "javascript",
  plain: "text",
  plaintext: "text",
  py: "python",
  python: "python",
  sh: "bash",
  shell: "bash",
  text: "text",
  ts: "typescript",
  tsx: "typescript",
  typescript: "typescript",
  xml: "html",
  zsh: "bash",
};

const JAVASCRIPT_KEYWORDS = new Set([
  "as",
  "async",
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "export",
  "extends",
  "finally",
  "for",
  "from",
  "function",
  "get",
  "if",
  "import",
  "in",
  "instanceof",
  "let",
  "new",
  "of",
  "return",
  "set",
  "static",
  "super",
  "switch",
  "this",
  "throw",
  "try",
  "typeof",
  "undefined",
  "var",
  "void",
  "while",
  "with",
  "yield",
]);

const TYPESCRIPT_KEYWORDS = new Set([
  ...JAVASCRIPT_KEYWORDS,
  "abstract",
  "any",
  "boolean",
  "declare",
  "enum",
  "implements",
  "interface",
  "keyof",
  "module",
  "namespace",
  "never",
  "number",
  "private",
  "protected",
  "public",
  "readonly",
  "string",
  "type",
  "unknown",
]);

const JSON_KEYWORDS = new Set(["false", "null", "true"]);

const PYTHON_KEYWORDS = new Set([
  "and",
  "as",
  "assert",
  "async",
  "await",
  "break",
  "class",
  "continue",
  "def",
  "del",
  "elif",
  "else",
  "except",
  "False",
  "finally",
  "for",
  "from",
  "global",
  "if",
  "import",
  "in",
  "is",
  "lambda",
  "None",
  "nonlocal",
  "not",
  "or",
  "pass",
  "raise",
  "return",
  "True",
  "try",
  "while",
  "with",
  "yield",
]);

const BASH_KEYWORDS = new Set([
  "case",
  "do",
  "done",
  "elif",
  "else",
  "esac",
  "fi",
  "for",
  "function",
  "if",
  "in",
  "select",
  "then",
  "time",
  "until",
  "while",
]);

const CSS_KEYWORDS = new Set([
  "important",
  "inherit",
  "initial",
  "none",
  "revert",
  "transparent",
  "unset",
]);

export function normalizeCodeLanguage(
  language: string | undefined,
): SupportedCodeLanguage | "text" | undefined {
  const normalized = (language ?? "")
    .trim()
    .toLowerCase()
    .replace(/^language-/, "")
    .split(/[^a-z0-9#+-]+/, 1)[0];
  if (!normalized) {
    return "text";
  }
  return Object.hasOwn(LANGUAGE_ALIASES, normalized)
    ? LANGUAGE_ALIASES[normalized]
    : undefined;
}

export function highlightCode(
  code: string,
  language: string | undefined,
): HighlightedCode {
  const normalized = normalizeCodeLanguage(language);
  if (normalized === undefined) {
    return plainResult(code, "text", "unsupported-language");
  }
  if (normalized === "text") {
    return plainResult(code, "text", "unsupported-language");
  }
  if (code.length > CODE_HIGHLIGHT_MAX_CHARS) {
    return plainResult(code, normalized, "too-long");
  }

  const tokens = tokenizeByLanguage(code, normalized);
  if (tokens.length > CODE_HIGHLIGHT_MAX_TOKENS) {
    return plainResult(code, normalized, "too-many-tokens");
  }
  return {
    highlighted: tokens.length > 0,
    language: normalized,
    tokens,
  };
}

export function splitHighlightTokensIntoLines(
  tokens: readonly CodeHighlightToken[],
): readonly (readonly CodeHighlightToken[])[] {
  const lines: CodeHighlightToken[][] = [[]];
  for (const token of tokens) {
    let remaining = token.text;
    while (remaining.length > 0) {
      const newline = remaining.indexOf("\n");
      if (newline === -1) {
        appendToken(lines[lines.length - 1] ?? [], token.kind, remaining);
        remaining = "";
      } else {
        const beforeNewline = remaining.slice(0, newline);
        if (beforeNewline) {
          appendToken(lines[lines.length - 1] ?? [], token.kind, beforeNewline);
        }
        lines.push([]);
        remaining = remaining.slice(newline + 1);
      }
    }
  }
  return lines;
}

function tokenizeByLanguage(
  code: string,
  language: SupportedCodeLanguage,
): CodeHighlightToken[] {
  switch (language) {
    case "bash":
      return tokenizeHashCommentLanguage(code, BASH_KEYWORDS);
    case "css":
      return tokenizeCss(code);
    case "diff":
      return tokenizeDiff(code);
    case "html":
      return tokenizeHtml(code);
    case "javascript":
      return tokenizeSlashCommentLanguage(code, JAVASCRIPT_KEYWORDS);
    case "json":
      return tokenizeJson(code);
    case "python":
      return tokenizeHashCommentLanguage(code, PYTHON_KEYWORDS);
    case "typescript":
      return tokenizeSlashCommentLanguage(code, TYPESCRIPT_KEYWORDS);
  }
}

function plainResult(
  code: string,
  language: SupportedCodeLanguage | "text",
  reason: CodeHighlightReason,
): HighlightedCode {
  return {
    highlighted: false,
    language,
    reason,
    tokens: code ? [{ kind: "plain", text: code }] : [],
  };
}

function push(
  tokens: CodeHighlightToken[],
  kind: CodeTokenKind,
  text: string,
): void {
  if (!text) {
    return;
  }
  const previous = tokens[tokens.length - 1];
  if (previous?.kind === kind) {
    tokens[tokens.length - 1] = { kind, text: `${previous.text}${text}` };
    return;
  }
  tokens.push({ kind, text });
}

function appendToken(
  tokens: CodeHighlightToken[],
  kind: CodeTokenKind,
  text: string,
): void {
  if (!text) {
    return;
  }
  const previous = tokens[tokens.length - 1];
  if (previous?.kind === kind) {
    tokens[tokens.length - 1] = { kind, text: `${previous.text}${text}` };
    return;
  }
  tokens.push({ kind, text });
}

function tokenizeSlashCommentLanguage(
  code: string,
  keywords: ReadonlySet<string>,
): CodeHighlightToken[] {
  const tokens: CodeHighlightToken[] = [];
  let index = 0;

  while (index < code.length) {
    const char = code.charAt(index);
    const next = code.charAt(index + 1);

    if (isWhitespace(char)) {
      const end = readWhile(code, index + 1, isWhitespace);
      push(tokens, "plain", code.slice(index, end));
      index = end;
      continue;
    }

    if (char === "/" && next === "/") {
      const end = readUntilLineEnd(code, index + 2);
      push(tokens, "comment", code.slice(index, end));
      index = end;
      continue;
    }

    if (char === "/" && next === "*") {
      const end = readBlockCommentEnd(code, index + 2);
      push(tokens, "comment", code.slice(index, end));
      index = end;
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      const end = readQuotedString(code, index, char);
      push(tokens, "string", code.slice(index, end));
      index = end;
      continue;
    }

    if (isNumberStart(code, index)) {
      const end = readNumber(code, index);
      push(tokens, "number", code.slice(index, end));
      index = end;
      continue;
    }

    if (isIdentifierStart(char)) {
      const end = readWhile(code, index + 1, isIdentifierPart);
      const word = code.slice(index, end);
      push(tokens, keywords.has(word) ? "keyword" : "plain", word);
      index = end;
      continue;
    }

    push(tokens, isOperator(char) ? "operator" : "punctuation", char);
    index += 1;
  }

  return tokens;
}

function tokenizeHashCommentLanguage(
  code: string,
  keywords: ReadonlySet<string>,
): CodeHighlightToken[] {
  const tokens: CodeHighlightToken[] = [];
  let index = 0;

  while (index < code.length) {
    const char = code.charAt(index);

    if (isWhitespace(char)) {
      const end = readWhile(code, index + 1, isWhitespace);
      push(tokens, "plain", code.slice(index, end));
      index = end;
      continue;
    }

    if (char === "#") {
      const end = readUntilLineEnd(code, index + 1);
      push(tokens, "comment", code.slice(index, end));
      index = end;
      continue;
    }

    if (char === '"' || char === "'") {
      const quote = char;
      const triple =
        code.charAt(index + 1) === quote && code.charAt(index + 2) === quote;
      const end = triple
        ? readTripleQuotedString(code, index, quote)
        : readQuotedString(code, index, quote);
      push(tokens, "string", code.slice(index, end));
      index = end;
      continue;
    }

    if (isNumberStart(code, index)) {
      const end = readNumber(code, index);
      push(tokens, "number", code.slice(index, end));
      index = end;
      continue;
    }

    if (isIdentifierStart(char)) {
      const end = readWhile(code, index + 1, isIdentifierPart);
      const word = code.slice(index, end);
      push(tokens, keywords.has(word) ? "keyword" : "plain", word);
      index = end;
      continue;
    }

    push(tokens, isOperator(char) ? "operator" : "punctuation", char);
    index += 1;
  }

  return tokens;
}

function tokenizeJson(code: string): CodeHighlightToken[] {
  const tokens: CodeHighlightToken[] = [];
  let index = 0;

  while (index < code.length) {
    const char = code.charAt(index);

    if (isWhitespace(char)) {
      const end = readWhile(code, index + 1, isWhitespace);
      push(tokens, "plain", code.slice(index, end));
      index = end;
      continue;
    }

    if (char === '"') {
      const end = readQuotedString(code, index, char);
      const nextMeaningful = nextNonWhitespace(code, end);
      push(
        tokens,
        nextMeaningful === ":" ? "property" : "string",
        code.slice(index, end),
      );
      index = end;
      continue;
    }

    if (isNumberStart(code, index)) {
      const end = readNumber(code, index);
      push(tokens, "number", code.slice(index, end));
      index = end;
      continue;
    }

    if (isIdentifierStart(char)) {
      const end = readWhile(code, index + 1, isIdentifierPart);
      const word = code.slice(index, end);
      push(tokens, JSON_KEYWORDS.has(word) ? "keyword" : "plain", word);
      index = end;
      continue;
    }

    push(tokens, char === ":" ? "operator" : "punctuation", char);
    index += 1;
  }

  return tokens;
}

function tokenizeCss(code: string): CodeHighlightToken[] {
  const tokens: CodeHighlightToken[] = [];
  let index = 0;
  let expectingProperty = false;

  while (index < code.length) {
    const char = code.charAt(index);
    const next = code.charAt(index + 1);

    if (isWhitespace(char)) {
      const end = readWhile(code, index + 1, isWhitespace);
      push(tokens, "plain", code.slice(index, end));
      index = end;
      continue;
    }

    if (char === "/" && next === "*") {
      const end = readBlockCommentEnd(code, index + 2);
      push(tokens, "comment", code.slice(index, end));
      index = end;
      continue;
    }

    if (char === '"' || char === "'") {
      const end = readQuotedString(code, index, char);
      push(tokens, "string", code.slice(index, end));
      index = end;
      continue;
    }

    if (isNumberStart(code, index)) {
      const end = readNumber(code, index);
      push(tokens, "number", code.slice(index, end));
      index = end;
      continue;
    }

    if (isCssIdentifierStart(char)) {
      const end = readWhile(code, index + 1, isCssIdentifierPart);
      const word = code.slice(index, end);
      const nextMeaningful = nextNonWhitespace(code, end);
      const kind = CSS_KEYWORDS.has(word.replace(/^!/, ""))
        ? "keyword"
        : expectingProperty && nextMeaningful === ":"
          ? "property"
          : "plain";
      push(tokens, kind, word);
      index = end;
      continue;
    }

    if (char === "{") {
      expectingProperty = true;
    } else if (char === "}" || char === ";") {
      expectingProperty = char !== "}";
    } else if (char === ":") {
      expectingProperty = false;
    }

    push(tokens, isOperator(char) ? "operator" : "punctuation", char);
    index += 1;
  }

  return tokens;
}

function tokenizeHtml(code: string): CodeHighlightToken[] {
  const tokens: CodeHighlightToken[] = [];
  let index = 0;

  while (index < code.length) {
    if (code.startsWith("<!--", index)) {
      const commentEnd = code.indexOf("-->", index + 4);
      const end = commentEnd === -1 ? code.length : commentEnd + 3;
      push(tokens, "comment", code.slice(index, end));
      index = end;
      continue;
    }

    const char = code.charAt(index);
    if (char !== "<") {
      const nextTag = code.indexOf("<", index + 1);
      const end = nextTag === -1 ? code.length : nextTag;
      push(tokens, "plain", code.slice(index, end));
      index = end;
      continue;
    }

    push(tokens, "punctuation", char);
    index += 1;

    if (code.charAt(index) === "/") {
      push(tokens, "punctuation", "/");
      index += 1;
    }

    const tagEnd = readWhile(code, index, isHtmlNamePart);
    push(tokens, "tag", code.slice(index, tagEnd));
    index = tagEnd;

    while (index < code.length && code.charAt(index) !== ">") {
      const current = code.charAt(index);
      if (isWhitespace(current)) {
        const end = readWhile(code, index + 1, isWhitespace);
        push(tokens, "plain", code.slice(index, end));
        index = end;
      } else if (current === '"' || current === "'") {
        const end = readQuotedString(code, index, current);
        push(tokens, "string", code.slice(index, end));
        index = end;
      } else if (current === "=") {
        push(tokens, "operator", current);
        index += 1;
      } else if (current === "/") {
        push(tokens, "punctuation", current);
        index += 1;
      } else if (isHtmlNamePart(current)) {
        const end = readWhile(code, index + 1, isHtmlNamePart);
        push(tokens, "attribute", code.slice(index, end));
        index = end;
      } else {
        push(tokens, "plain", current);
        index += 1;
      }
    }

    if (code.charAt(index) === ">") {
      push(tokens, "punctuation", ">");
      index += 1;
    }
  }

  return tokens;
}

function tokenizeDiff(code: string): CodeHighlightToken[] {
  const tokens: CodeHighlightToken[] = [];
  const lines = code.split("\n");

  lines.forEach((line, lineIndex) => {
    if (
      line.startsWith("+++") ||
      line.startsWith("---") ||
      line.startsWith("@@")
    ) {
      push(tokens, "meta", line);
    } else if (line.startsWith("+")) {
      push(tokens, "inserted", line);
    } else if (line.startsWith("-")) {
      push(tokens, "deleted", line);
    } else {
      push(tokens, "plain", line);
    }
    if (lineIndex < lines.length - 1) {
      push(tokens, "plain", "\n");
    }
  });

  return tokens;
}

function readWhile(
  code: string,
  start: number,
  predicate: (char: string) => boolean,
): number {
  let index = start;
  while (index < code.length && predicate(code.charAt(index))) {
    index += 1;
  }
  return index;
}

function readUntilLineEnd(code: string, start: number): number {
  const newline = code.indexOf("\n", start);
  return newline === -1 ? code.length : newline;
}

function readBlockCommentEnd(code: string, start: number): number {
  const commentEnd = code.indexOf("*/", start);
  return commentEnd === -1 ? code.length : commentEnd + 2;
}

function readQuotedString(code: string, start: number, quote: string): number {
  let index = start + 1;
  while (index < code.length) {
    const char = code.charAt(index);
    if (char === "\\") {
      index += 2;
      continue;
    }
    index += 1;
    if (char === quote) {
      break;
    }
  }
  return Math.min(index, code.length);
}

function readTripleQuotedString(
  code: string,
  start: number,
  quote: string,
): number {
  const end = code.indexOf(`${quote}${quote}${quote}`, start + 3);
  return end === -1 ? code.length : end + 3;
}

function readNumber(code: string, start: number): number {
  let index = start;
  if (code.charAt(index) === "-" || code.charAt(index) === "+") {
    index += 1;
  }
  while (
    index < code.length &&
    /[0-9_a-fA-FxXoObBeE.+-]/.test(code.charAt(index))
  ) {
    index += 1;
  }
  return index;
}

function nextNonWhitespace(code: string, start: number): string {
  let index = start;
  while (index < code.length && isWhitespace(code.charAt(index))) {
    index += 1;
  }
  return code.charAt(index);
}

function isNumberStart(code: string, index: number): boolean {
  const char = code.charAt(index);
  if (/[0-9]/.test(char)) {
    return true;
  }
  return (char === "-" || char === "+") && /[0-9]/.test(code.charAt(index + 1));
}

function isWhitespace(char: string): boolean {
  return char === " " || char === "\t" || char === "\n" || char === "\r";
}

function isIdentifierStart(char: string): boolean {
  return /[A-Za-z_$]/.test(char);
}

function isIdentifierPart(char: string): boolean {
  return /[A-Za-z0-9_$]/.test(char);
}

function isCssIdentifierStart(char: string): boolean {
  return /[A-Za-z_@.!#-]/.test(char);
}

function isCssIdentifierPart(char: string): boolean {
  return /[A-Za-z0-9_@.!#%-]/.test(char);
}

function isHtmlNamePart(char: string): boolean {
  return /[A-Za-z0-9_:-]/.test(char);
}

function isOperator(char: string): boolean {
  return /[=+*%&|^~!?:<>/.-]/.test(char);
}
