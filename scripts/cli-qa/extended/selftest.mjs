import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { extendedChecks, extendedScenarios, handleExtendedFixture } from '../v2-extended.mjs';
import { CREATED, DRAFT, EDITED, EDITED_DRAFT, FILE, IDS, SCROLL_MARKERS, TOOL_PROMPT, markdownPieces, stderr, stdout } from './fixtures.mjs';
import { forbiddenControls } from './oracles.mjs';
const user = { role: 'user', content: TOOL_PROMPT };
const message = (id, body, isError, changes) => ({ role: 'tool', tool_call_id: id, content: JSON.stringify({ content: JSON.stringify(body), isError, ...(changes ? { changes } : {}) }) });
const good = [
  message(IDS[0], { written: true }, false, [{ path: FILE, kind: 'created', before: null, after: CREATED }]),
  message(IDS[1], { edited: true, replacements: 1 }, false, [{ path: FILE, kind: 'modified', before: CREATED, after: EDITED }]),
  message(IDS[2], { exit_code: 3, stdout, stderr, truncated: false, timed_out: false, spawn_failed: false }, true),
];
async function invoke(messages, lastUser = TOOL_PROMPT) {
  const chunks = []; let ended = 0;
  const log = [{}];
  const handled = await handleExtendedFixture({ messages, lastUser, log,
    res: { write: c => chunks.push(c), end: () => ended++ },
    sseChunk: (delta, finish) => ({ delta, finish }), textReply: text => [{ text }],
  });
  return { chunks, ended, handled, log };
}
const observations = [];
let runArgs;
for (let i = 0; i <= 3; i++) {
  const messages = [user, ...good.slice(0, i)];
  const response = await invoke(messages);
  assert.equal(response.handled, true); assert.equal(response.ended, 1);
  const calls = response.chunks.flatMap(c => c.delta?.tool_calls ?? []);
  if (i < 3) {
    assert.equal(calls.filter(c => c.id).length, 1);
    assert.equal(calls[0].id, IDS[i]);
    const args = JSON.parse(calls.map(c => c.function.arguments).join(''));
    if (i === 1) assert.deepEqual(args, { path: FILE, old_text: 'qa-ext-created beta', new_text: 'qa-ext-edited beta' });
    if (i === 2) runArgs = args;
  } else { assert.equal(calls.length, 0); assert.equal(response.chunks[0].text, 'QA-EXT-TOOL-FINAL'); }
  observations.push({ lastUser: TOOL_PROMPT, messages });
}
// Execute exactly the emitted non-effectful command; verify true stdout/stderr and exit 3.
const command = spawnSync(runArgs.argv[0], runArgs.argv.slice(1), { encoding: 'utf8', timeout: 5000 });
assert.equal(command.status, 3); assert.equal(command.stdout, stdout); assert.equal(command.stderr, stderr);
const badMessages = [
  [message(IDS[0], { written: true }, true)],
  [{ role: 'tool', tool_call_id: IDS[0], content: '{bad' }],
  [good[0], good[0]], [good[1]],
  [good[0], message(IDS[1], { edited: true }, false)],
  [good[0], good[1], message(IDS[2], { exit_code: 0, stdout, stderr }, false)],
];
for (const bad of badMessages) {
  const r = await invoke([user, ...bad]);
  assert.equal(r.ended, 1); assert.deepEqual(r.chunks, [{ text: 'QA-EXT-TOOL-INVALID' }]);
}
// Earlier turn results cannot advance this turn.
assert.equal((await invoke([...good, user])).chunks[0].delta.tool_calls[0].id, IDS[0]);
assert.equal((await invoke([], 'unrelated')).handled, false);
assert.equal((await invoke([], EDITED_DRAFT)).chunks[0].text, 'QA-EXT-DRAFT-FINAL');
assert.equal((await invoke([], DRAFT)).handled, false);
assert.equal(new Set(SCROLL_MARKERS).size, 90);
assert.ok(DRAFT.length > 80);
assert.deepEqual(forbiddenControls('\u001b[K\u001b[2K'), []);
for (const text of ['\u001b[2J', '\u001b]0;bad\u0007', '\u009b2J', '\u009d0;x\u009c']) assert.ok(forbiddenControls(text).length);
assert.ok(markdownPieces.join('').includes('QA-EXT-C1\u009c'));
assert.ok(markdownPieces.includes('\u001b'));
const streamed = await invoke([], '[qa-extended-markdown] render hostile markdown');
assert.equal(streamed.ended, 1);
assert.ok(streamed.log[0].responseCompleted - streamed.log[0].responseStarted >= 1600);
assert.equal(streamed.chunks.filter(c => c.delta?.content).map(c => c.delta.content).join(''), markdownPieces.join(''));
const simpleFrame = text => ({ viewport: text.split('\n'), text, cells: [[]], cursor: { x: 0, y: 0 }, cols: 80, rows: 24 });
const report = (states, requests, names) => ({ states, requests, screenshots: names.map(mark => ({ mark, file: `${mark}.png` })), exitEvent: { code: 0 } });
const check = (id, r, expected) => assert.equal(extendedChecks[id](r).status, expected);
const markdown = report({ partial: simpleFrame('QA-EXT heading\nconst qaExt'), settled: simpleFrame('QA-EXT heading\nQA-EXT-LINK\nconst qaExt = true;\ncol | val\nQA-EXT-HOSTILE-SAFE QA-EXT-MARKDOWN-FINAL') }, [{ lastUser: '[qa-extended-markdown]', responseStarted: 100, responseCompleted: 2000 }], ['partial', 'settled']);
markdown.rawText = 'UI\u001b[Ksafe';
markdown.events = [{ type: 'mark', name: 'startup', offset: 0 }, { type: 'mark', name: 'partial', wall_ms: 500 }, { type: 'mark', name: 'settled', offset: Buffer.byteLength(markdown.rawText) }];
check('v2_extended_markdown', markdown, 'pass');
for (const mutate of [r => r.events[1].wall_ms = 3000, r => r.states.settled.text = r.states.settled.text.replace('QA-EXT-LINK', ''), r => r.rawText = '\u001b[2Jbad', r => r.screenshots = [], r => r.states.partial.text += ' QA-EXT-MARKDOWN-FINAL']) {
  const r = structuredClone(markdown); mutate(r); check('v2_extended_markdown', r, 'fail');
}
// Real 40-column hardwrap: last L is on its own physical line.
const splitFinal = 'QA-EXT-HOSTILE-SAFE QA-EXT-MARKDOWN-FINA\nL';
for (const cols of [40, 80, 120]) {
  const r = structuredClone(markdown);
  r.states.partial.cols = r.states.settled.cols = cols;
  if (cols === 40) r.states.settled.text = r.states.settled.text.replace('QA-EXT-HOSTILE-SAFE QA-EXT-MARKDOWN-FINAL', splitFinal);
  check('v2_extended_markdown', r, 'pass');
  if (cols === 40) {
    for (const replacement of [splitFinal.slice(0, -1), `${splitFinal}\n${splitFinal}`, 'L\nQA-EXT-HOSTILE-SAFE QA-EXT-MARKDOWN-FINA', 'QA-EXT-HOSTILE-SAFE QA-EXT-MARKDOWN-FIN\nAL']) {
      const bad = structuredClone(r); bad.states.settled.text = bad.states.settled.text.replace(splitFinal, replacement);
      check('v2_extended_markdown', bad, 'fail');
    }
    const premature = structuredClone(r); premature.states.partial.text += `\n${splitFinal}`;
    check('v2_extended_markdown', premature, 'fail');
  }
}
const settledWait = extendedScenarios['v2-extended-markdown'].steps().find(s => s.action === 'wait_for' && s.after_mark === 'partial');
assert.equal(settledWait.pattern, 'completed'); assert.equal(settledWait.timeout_ms, 15000);
const toolScreen = `--- ${FILE}\n+++ ${FILE}\n@@ -1,2 +1,2 @@\n-qa-ext-created beta\n+qa-ext-edited beta\nrun_command · failed · exit 3\n` + Array.from({ length: 4 }, (_, i) => `stdout QA-EXT-STDOUT-${i}\n`).join('') + '… 4 more lines\nstderr QA-EXT-STDERR-0\n… 2 more preview lines\nQA-EXT-TOOL-FINAL';
const tools = report({ 'tools-running': simpleFrame('run_command · running'), 'tools-final': simpleFrame(toolScreen) }, observations, ['tools-running', 'tools-final']);
check('v2_extended_tools', tools, 'pass');
for (const mutate of [r => r.requests.pop(), r => r.requests[3].messages[3] = message(IDS[2], { exit_code: 0 }, false), r => r.states['tools-final'].text += '\nstdout QA-EXT-STDOUT-7', r => r.states['tools-final'].text = r.states['tools-final'].text.replace('+qa-ext-edited beta', ''), r => r.screenshots = []]) {
  const r = structuredClone(tools); mutate(r); check('v2_extended_tools', r, 'fail');
}
// Independent test cell builder: known fixture widths only, not product or oracle layout code.
function draftFrame(text, cols, rows, moves) {
  const clusters = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment('❯ ' + text)].map(s => s.segment);
  const cells = Array.from({ length: rows }, () => Array.from({ length: cols }, () => ({ chars: ' ', width: 1 })));
  let x = 0, y = 1, cursor;
  clusters.forEach((g, i) => {
    const width = /[\u4e00-\u9fff🎉]/u.test(g) ? 2 : 1;
    if (x + width > cols) { x = 0; y++; }
    cells[y][x] = { chars: g, width };
    if (width === 2) cells[y][x + 1] = { chars: '', width: 0 };
    x += width; if (x === cols) { x = 0; y++; }
    if (i === clusters.length - moves - 1) cursor = { x, y };
  });
  return { cols, rows, cells, cursor, viewport: cells.map(row => row.map(c => c.chars).join('')) };
}
function menuFrame(open) {
  const commands = ['model', 'permission', 'mode', 'plan', 'sessions', 'resume', 'new', 'fork'];
  const viewport = ['banner /help', open ? '❯ /' : '❯ Ask anything · / for commands', ...commands.map((c, i) => open ? `${i === 0 ? '❯ ' : '  '}/${c}   description` : '')];
  return { cols: 80, rows: 10, cursor: { x: open ? 3 : 2, y: 1 }, viewport,
    cells: viewport.map((line, y) => Array.from(line, chars => ({ chars, width: 1, inverse: open && y === 2 }))) };
}
const names = ['scrolled', 'menu-open', 'menu-close', 'draft-80', 'draft-mid', 'draft-40', 'draft-tall', 'submitted'];
const scroll = report({ scrolled: simpleFrame(SCROLL_MARKERS.join('\n')), 'menu-open': menuFrame(true), 'menu-close': menuFrame(false),
  'draft-80': draftFrame(DRAFT, 80, 24, 0), 'draft-mid': draftFrame(EDITED_DRAFT, 80, 24, 4),
  'draft-40': draftFrame(EDITED_DRAFT, 40, 12, 4), 'draft-tall': draftFrame(EDITED_DRAFT, 40, 30, 4), submitted: simpleFrame('QA-EXT-DRAFT-FINAL') }, [{ lastUser: '[qa-extended-scroll] fill more than two screens' }, { lastUser: EDITED_DRAFT }], names);
for (const n of names) scroll.states[n].text = SCROLL_MARKERS.join('\n') + '\nQA-EXT-SCROLL-DONE\ncompleted · 0 tools\n' + (n === 'submitted' ? 'QA-EXT-DRAFT-FINAL' : '');
check('v2_extended_scroll', scroll, 'pass');
for (const mutate of [r => r.states['draft-40'].cursor.x++, r => r.requests[1].lastUser = DRAFT, r => r.states.scrolled.text += '\nQA-EXT-LINE-000', r => r.states['menu-close'] = { ...menuFrame(true), text: r.states['menu-close'].text }, r => r.screenshots = [],
  r => r.states['draft-tall'].text += '\nQA-EXT-LINE-000', r => r.states.submitted.text = r.states.submitted.text.replace('QA-EXT-LINE-089', ''),
  r => r.states['draft-40'].text = r.states['draft-40'].text.replace('completed · 0 tools', ''),
  r => r.states['menu-open'].cells[2].forEach(c => c.inverse = false),
  r => r.states['menu-open'].cells[3].forEach(c => c.inverse = true),
  r => { const f = r.states['menu-open']; f.cursor.y = 9; f.viewport[9] = '❯ /'; },
]) {
  const r = structuredClone(scroll); mutate(r); check('v2_extended_scroll', r, 'fail');
}
for (const scenario of Object.values(extendedScenarios)) assert.ok(!scenario.steps().some(s => s.action === 'key' && ['home', 'end'].includes(s.name)));
console.log('PASS: finite four-request tool chain; exact emitted exit-3 command; 6 malformed/error/order negatives; streaming pause/terminators; three positive oracles plus 40/80/120 markdown cases and 26 mutation negatives; supported scenario keys');
