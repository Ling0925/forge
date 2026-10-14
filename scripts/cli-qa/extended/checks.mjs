import { composerGeometry, forbiddenControls, markerCounts, once, physicalLineText, pngShots, requestsFor, result, state, toolEnvelope, transcript, turnTools, view } from './oracles.mjs';
import { CREATED, DRAFT, EDITED, EDITED_DRAFT, FILE, IDS, SCROLL_MARKERS, TOOL_PROMPT, validTool } from './fixtures.mjs';
const shots = (r, names) => names.every(n => pngShots(r, n).length > 0);
const event = (r, n) => r.events?.find(e => e.type === 'mark' && e.name === n);
function markdownCheck(r) {
  const partial = physicalLineText(transcript(r, 'partial'), state(r, 'partial').cols);
  const final = physicalLineText(transcript(r, 'settled'), state(r, 'settled').cols);
  const request = requestsFor(r, '[qa-extended-markdown]')[0];
  const time = event(r, 'partial')?.wall_ms;
  const during = Number.isFinite(time) && request?.responseStarted < time && time < request?.responseCompleted;
  const start = event(r, 'startup')?.offset;
  const end = event(r, 'settled')?.offset;
  // Offsets are bytes, not JS code units.
  const scopedRaw = Number.isFinite(start) && Number.isFinite(end) ? Buffer.from(r.rawText ?? '').subarray(start, end).toString() : '';
  const controls = forbiddenControls(scopedRaw);
  const labels = ['QA-EXT heading', 'QA-EXT-LINK', 'QA-EXT-HOSTILE-SAFE', 'QA-EXT-MARKDOWN-FINAL', 'const qaExt = true;'];
  const counts = markerCounts(final, labels);
  const ok = during && partial.includes('const qaExt') && !partial.includes('QA-EXT-MARKDOWN-FINAL') &&
    labels.every(m => counts[m] === 1) && final.includes('col') && final.includes('val') &&
    !/```|QA-EXT-TITLE-MUST-NOT-APPLY|QA-EXT-C1|https:\/\/qa-ext.invalid/.test(final) &&
    scopedRaw.length > 0 && controls.length === 0 && shots(r, ['partial', 'settled']) && r.exitEvent?.code === 0;
  return result(ok, { during, time, counts, controls });
}
function toolCheck(r) {
  const requests = requestsFor(r, '[qa-extended-tools]');
  const tools = requests.map(q => turnTools(q.messages).map(toolEnvelope));
  const finite = requests.length === 4 && requests.every((q, i) => q.lastUser === TOOL_PROMPT && tools[i].length === i && tools[i].every((t, j) => t?.id === IDS[j] && validTool(t, j)));
  const screen = transcript(r, 'tools-final');
  const running = view(r, 'tools-running');
  const diff = screen.includes(`--- ${FILE}`) && screen.includes(`+++ ${FILE}`) && /@@ -\d+,\d+ \+\d+,\d+ @@/.test(screen) && screen.includes('-qa-ext-created beta') && screen.includes('+qa-ext-edited beta');
  // Renderer shows stdout 0..3, a more-lines note, then stderr 0 within six preview rows.
  // Command argv may echo fixture markers, so inspect only the completed preview after the status header.
  const preview = screen.split('· failed · exit 3')[1]?.split('QA-EXT-TOOL-FINAL')[0] ?? '';
  const bounded = [0, 1, 2, 3].every(i => preview.includes(`stdout QA-EXT-STDOUT-${i}`)) && preview.includes('… 4 more lines') && preview.includes('stderr QA-EXT-STDERR-0') && preview.includes('more preview lines') && !/stdout QA-EXT-STDOUT-[4-7]|stderr QA-EXT-STDERR-[12]/.test(screen);
  return result(finite && diff && bounded && running.includes('run_command') && running.includes('running') && once(screen, 'QA-EXT-TOOL-FINAL') && shots(r, ['tools-running', 'tools-final']) && r.exitEvent?.code === 0, { finite, phases: tools.map(t => t.length), diff, bounded, created: CREATED, edited: EDITED });
}
function transientMenu(r, name) {
  const frame = state(r, name);
  const composer = frame.viewport[frame.cursor.y]?.trimEnd();
  const options = [];
  for (let y = frame.cursor.y + 1; y < frame.viewport.length; y++) {
    const cells = frame.cells[y] ?? [];
    const text = cells.map(c => c.chars || (c.width === 0 ? '' : ' ')).join('').trimEnd();
    const match = /^(?:❯ |  )\/(\w+)\s+\S/.exec(text);
    if (match && text === frame.viewport[y].trimEnd()) options.push({ command: `/${match[1]}`, inverse: cells.some(c => c.inverse) });
  }
  const inverseRows = frame.cells.slice(frame.cursor.y + 1).filter(row => row.some(c => c.inverse)).length;
  return { composer, options, inverseRows };
}
function scrollCheck(r) {
  const specs = [['draft-80', DRAFT, 0], ['draft-mid', EDITED_DRAFT, 4], ['draft-40', EDITED_DRAFT, 4], ['draft-tall', EDITED_DRAFT, 4]];
  const geometry = Object.fromEntries(specs.map(([n, t, m]) => [n, composerGeometry(r, n, t, m)]));
  const stages = ['scrolled', 'menu-open', 'menu-close', ...specs.map(s => s[0]), 'submitted'];
  // Require full retained text, never a viewport fallback for multi-screen history.
  const counts = Object.fromEntries(stages.map(n => [n, markerCounts(state(r, n).text ?? '', SCROLL_MARKERS)]));
  const history = stages.every(n => SCROLL_MARKERS.every(m => counts[n][m] === 1) && once(state(r, n).text ?? '', 'QA-EXT-SCROLL-DONE'));
  const completion = Object.fromEntries(stages.map(n => [n, (state(r, n).text ?? '').split('\n').filter(line => line.trim() === 'completed · 0 tools').length]));
  const completionRetained = stages.every(n => completion[n] >= 1);
  const exact = (r.requests ?? []).filter(q => q.lastUser === EDITED_DRAFT);
  const requestsOk = r.requests?.length === 2 && exact.length === 1 && r.requests[0].lastUser === '[qa-extended-scroll] fill more than two screens' && r.requests[1].lastUser === EDITED_DRAFT;
  const sizes = state(r, 'draft-80').cols === 80 && state(r, 'draft-40').cols === 40 && state(r, 'draft-40').rows === 12 && state(r, 'draft-tall').cols === 40 && state(r, 'draft-tall').rows === 30;
  const opened = transientMenu(r, 'menu-open');
  const closed = transientMenu(r, 'menu-close');
  const menu = opened.composer === '❯ /' && closed.composer?.startsWith('❯ ') && opened.options.length >= 2 && opened.options.length <= 8 &&
    opened.options.some(o => o.command === '/model') && opened.options.filter(o => o.inverse).length === 1 && opened.inverseRows === 1 &&
    closed.options.length === 0 && closed.inverseRows === 0;
  const ok = Object.values(geometry).every(g => g.ok) && history && completionRetained && sizes && menu && requestsOk && once(transcript(r, 'submitted'), 'QA-EXT-DRAFT-FINAL') && shots(r, stages) && r.exitEvent?.code === 0;
  return result(ok, { geometry, counts, history, completion, completionRetained, sizes, menu, opened, closed, requestsOk });
}
export const extendedChecks = { v2_extended_markdown: markdownCheck, v2_extended_tools: toolCheck, v2_extended_scroll: scrollCheck };
