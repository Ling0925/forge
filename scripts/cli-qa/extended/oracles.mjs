/** Cell and envelope oracles for the v2 extended real-PTY suite.
 * Ownership: scripts/cli-qa/extended/oracles.mjs (API extension author).
 * Pure functions only. Product rendering is not reimplemented here.
 */

export const result = (ok, observed) => ({ status: ok ? "pass" : "fail", observed });

export const state = (report, name) => {
  const frame = report.states?.[name];
  if (!frame?.viewport || !frame?.cells || !frame?.cursor) {
    throw new Error(`missing cell state ${name}`);
  }
  return frame;
};

export const view = (report, name) => state(report, name).viewport.join("\n");

export const transcript = (report, name = "__final") =>
  state(report, name).text ?? view(report, name);

const occurrences = (text, marker) => {
  if (!marker) return 0;
  let count = 0;
  let from = 0;
  while (from <= text.length) {
    const at = text.indexOf(marker, from);
    if (at < 0) break;
    count += 1;
    from = at + marker.length;
  }
  return count;
};

export const once = (text, marker) => occurrences(text, marker) === 1;

/** Join only physical boundaries at the exact terminal width, preserving all
 * characters/order. Never remove arbitrary whitespace or short-line newlines. */
export const physicalLineText = (text, columns) => {
  if (!Number.isInteger(columns) || columns <= 0) return text;
  const lines = text.split('\n');
  return lines.map((line, i) => line + (i === lines.length - 1 ? '' :
    graphemes(line).reduce((n, g) => n + clusterWidth(g), 0) === columns ? '' : '\n')).join('');
};

/** Tool messages that arrived after the latest user turn. */
export const turnTools = (messages) => {
  if (!Array.isArray(messages)) return [];
  let start = 0;
  messages.forEach((message, index) => {
    if (message?.role === "user") start = index + 1;
  });
  return messages.slice(start).filter((message) => message?.role === "tool");
};

export const parseJson = (value) => {
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

/** A real ToolResult envelope, never a free-text mention of a tool. */
export const toolEnvelope = (message) => {
  if (!message || message.role !== "tool" || typeof message.tool_call_id !== "string") return null;
  const envelope = parseJson(message.content);
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) return null;
  if (typeof envelope.content !== "string" || typeof envelope.isError !== "boolean") return null;
  const body = parseJson(envelope.content);
  return { id: message.tool_call_id, envelope, body };
};

export const requestsFor = (report, marker) =>
  (report.requests ?? []).filter(
    (request) => typeof request.lastUser === "string" && request.lastUser.includes(marker),
  );

const graphemes = (text) =>
  typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
    ? Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text), (part) => part.segment)
    : Array.from(text);

const wide = (code) =>
  (code >= 0x1100 && code <= 0x115f) ||
  (code >= 0x2e80 && code <= 0xa4cf) ||
  (code >= 0xac00 && code <= 0xd7a3) ||
  (code >= 0xf900 && code <= 0xfaff) ||
  (code >= 0x1f300 && code <= 0x1f64f) ||
  (code >= 0x1f680 && code <= 0x1f6ff) ||
  (code >= 0x1f900 && code <= 0x1f9ff);

const zero = (code) =>
  code === 0 ||
  (code >= 1 && code <= 31) ||
  (code >= 127 && code <= 159) ||
  (code >= 0x0300 && code <= 0x036f) ||
  (code >= 0xfe00 && code <= 0xfe0f);

const clusterWidth = (cluster) => {
  if (!cluster) return 0;
  if (/\p{Extended_Pictographic}/u.test(cluster) && (cluster.includes("\uFE0F") || cluster.includes("\u200D"))) return 2;
  const first = cluster.codePointAt(0) ?? 0;
  if (first >= 0x1f1e6 && first <= 0x1f1ff) return 2;
  let width = 0;
  for (const symbol of cluster) width = Math.max(width, wide(symbol.codePointAt(0) ?? 0) ? 2 : zero(symbol.codePointAt(0) ?? 0) ? 0 : 1);
  return width;
};

/** Cursor cell of prefix+text after moving `moves` graphemes left from the end. */
export const cursorCell = (prefix, text, columns, moves = 0) => {
  const clusters = graphemes(text);
  const stop = Math.max(0, clusters.length - moves);
  let column = [...prefix].reduce((sum, char) => sum + (wide(char.codePointAt(0) ?? 0) ? 2 : 1), 0);
  let row = 0;
  for (const cluster of clusters.slice(0, stop)) {
    const cells = Math.min(columns, clusterWidth(cluster));
    if (column + cells > columns) {
      row += 1;
      column = 0;
    }
    column += cells;
    if (column === columns) {
      row += 1;
      column = 0;
    }
  }
  return { row, column, shown: clusters.slice(0, stop).join("") };
};

export const composerRows = (report, name, text) => {
  const frame = state(report, name);
  const expected = `❯ ${text}`.trimEnd();
  return frame.viewport
    .map((line, y) => ({ line: line.trimEnd(), y }))
    .filter(({ line }) => line === expected || line.startsWith(`${expected.slice(0, Math.max(1, frame.cols - 1))}`));
};

const cellText = (cells) => cells.map((cell) => cell.chars || (cell.width === 0 ? "" : " ")).join("").trimEnd();

const layoutRows = (text, columns) => {
  const rows = [];
  let column = 0;
  let current = "";
  const push = () => {
    rows.push(current);
    current = "";
    column = 0;
  };
  for (const cluster of graphemes(text)) {
    const cells = Math.min(columns, clusterWidth(cluster));
    if (column + cells > columns) push();
    current += cluster;
    column += cells;
    if (column === columns) push();
  }
  if (current || rows.length === 0) rows.push(current);
  return rows;
};

/** Exact visible composer cells and cursor. Wrapped drafts may occupy several rows. */
export const composerGeometry = (report, name, text, moves = 0) => {
  const frame = state(report, name);
  const full = `❯ ${text}`;
  const expectedRows = layoutRows(full, frame.cols);
  const expected = cursorCell("❯ ", text, frame.cols, moves);
  const height = frame.viewport.length;
  let found = null;
  let matches = 0;
  for (let y = 0; y <= height - expectedRows.length; y += 1) {
    const slice = expectedRows.map((_, index) => cellText(frame.cells[y + index]));
    if (slice.every((line, index) => line === expectedRows[index].trimEnd())) {
      found ??= { y, slice };
      matches += 1;
    }
  }
  const cursor = frame.cursor;
  const ok = Boolean(
    found && matches === 1 &&
    cursor.y === found.y + expected.row &&
    cursor.x === expected.column &&
    found.slice.join("") === full.trimEnd(),
  );
  return { ok, expected, expectedRows, cursor, found };
};

export const forbiddenControls = (text) => {
  const hits = [];
  const patterns = [
    ["osc", /\u001b\]/g],
    ["erase-display", /\u001b\[[0-9;]*J/g],
    // CSI K is legitimate UI erase-line, not model OSC/display clearing.
    ["c1-csi", /\u009b/g],
    ["c1-osc", /\u009d/g],
  ];
  for (const [name, pattern] of patterns) {
    const count = (text.match(pattern) || []).length;
    if (count) hits.push({ name, count });
  }
  return hits;
};

export const markerCounts = (text, markers) =>
  Object.fromEntries(markers.map((marker) => [marker, occurrences(text, marker)]));

export const pngShots = (report, mark) =>
  (report.screenshots ?? []).filter((shot) => shot.mark === mark && typeof shot.file === "string");
