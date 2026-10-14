import { turnTools, toolEnvelope } from './oracles.mjs';
export const FILE = 'qa-extended-note.txt';
export const CREATED = 'qa-ext-created alpha\nqa-ext-created beta\n';
export const EDITED = CREATED.replace('created beta', 'edited beta');
export const TOOL_PROMPT = '[qa-extended-tools] create, edit, run, confirm';
export const DRAFT = '下一个很长的草稿 e\u0301 🎉 中文宽度 ' + 'mixed-width-draft-'.repeat(5) + 'tail';
export const INSERT = 'MID';
export const EDITED_DRAFT = DRAFT.slice(0, -4) + INSERT + DRAFT.slice(-4);
export const SCROLL_MARKERS = Array.from({ length: 90 }, (_, i) => `QA-EXT-LINE-${String(i).padStart(3, '0')}`);
export const IDS = ['call_qa_ext_write', 'call_qa_ext_edit', 'call_qa_ext_run'];
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export function validTool(tool, phase) {
  if (!tool || !tool.body || typeof tool.body !== 'object') return false;
  const { envelope: e, body: b } = tool;
  const change = e.changes?.find(c => c.path?.endsWith(FILE));
  if (phase === 0) return e.isError === false && b.written === true && change?.kind === 'created' && change.before === null && change.after === CREATED;
  if (phase === 1) return e.isError === false && b.edited === true && b.replacements === 1 && change?.kind === 'modified' && change.before === CREATED && change.after === EDITED;
  return e.isError === true && b.exit_code === 3 && b.stdout === stdout && b.stderr === stderr && b.truncated === false && b.timed_out === false && b.spawn_failed === false;
}
export const stdout = Array.from({ length: 8 }, (_, i) => `QA-EXT-STDOUT-${i}\n`).join('');
export const stderr = 'QA-EXT-STDERR-0\nQA-EXT-STDERR-1\nQA-EXT-STDERR-2\n';
function emitTool(ctx, phase) {
  const script = "setTimeout(()=>{for(let i=0;i<11;i++)(i<8?console.log:console.error)('QA-EXT-STD'+(i<8?'OUT-':'ERR-')+(i%8));process.exit(3)},1200)";
  const calls = [
    ['write_file', { path: FILE, content: CREATED }],
    // Verified against src/tools/local.ts; the current registry uses snake_case.
    ['edit_file', { path: FILE, old_text: 'qa-ext-created beta', new_text: 'qa-ext-edited beta' }],
    ['run_command', { argv: [process.execPath, '-e', script] }],
  ];
  const [name, args] = calls[phase];
  ctx.res.write(ctx.sseChunk({ role: 'assistant', tool_calls: [{ index: 0, id: IDS[phase], type: 'function', function: { name, arguments: '' } }] }, null));
  const json = JSON.stringify(args);
  for (let i = 0; i < json.length; i += 24) ctx.res.write(ctx.sseChunk({ tool_calls: [{ index: 0, function: { arguments: json.slice(i, i + 24) } }] }, null));
  ctx.res.write(ctx.sseChunk({}, 'tool_calls'));
  ctx.res.write('data: [DONE]\n\n');
  ctx.res.end();
}
function reply(ctx, text) {
  for (const chunk of ctx.textReply(text)) ctx.res.write(chunk);
  ctx.res.end();
}
function tools(ctx) {
  const raw = turnTools(ctx.messages);
  const parsed = raw.map(toolEnvelope);
  // Ordered, scoped actual IDs: malformed/duplicate/out-of-order results terminate, never replay effects.
  if (raw.length > 3 || parsed.some((t, i) => t?.id !== IDS[i] || !validTool(t, i))) {
    reply(ctx, 'QA-EXT-TOOL-INVALID');
    return;
  }
  const phase = raw.length;
  if (ctx.log.at(-1)) ctx.log.at(-1).extendedValidation = { phase, ok: true };
  if (phase < 3) emitTool(ctx, phase);
  else reply(ctx, 'QA-EXT-TOOL-FINAL');
}
export const markdownPieces = [
  '\u001b', ']0;QA-EXT-TITLE-MUST-NOT-APPLY', '\u0007# QA-EXT heading\n\n- item ',
  '\u001b]8;;https://qa-ext.invalid\u001b', '\\QA-EXT-LINK\u001b]8;;\u001b', '\\ **bold**\n\n',
  '\u001b[', '2J\u001b[H```js\nconst qaExt',
  ' = true;\n```\n\n| col | val |\n| --- | --- |\n| a | ',
  '\u009b', '2J\u009d', '0;QA-EXT-C1', '\u009c |\n\nQA-EXT-HOSTILE-SAFE QA-EXT-MARKDOWN-FINAL\n',
];
async function stream(ctx, pieces, pauseAt = -1) {
  const observation = ctx.log.at(-1);
  if (observation) observation.responseStarted = Date.now();
  for (let i = 0; i < pieces.length; i++) {
    ctx.res.write(ctx.sseChunk({ role: 'assistant', content: pieces[i] }, null));
    await sleep(i === pauseAt ? 1600 : 40);
  }
  ctx.res.write(ctx.sseChunk({}, 'stop'));
  ctx.res.write('data: [DONE]\n\n');
  ctx.res.end();
  if (observation) observation.responseCompleted = Date.now();
}
export async function handleExtendedFixture(ctx) {
  const text = ctx.lastUser;
  if (text === TOOL_PROMPT) { tools(ctx); return true; }
  if (text === '[qa-extended-markdown] render hostile markdown') {
    await stream(ctx, markdownPieces, 7); return true;
  }
  if (text === '[qa-extended-scroll] fill more than two screens') {
    await stream(ctx, SCROLL_MARKERS.map(m => `${m}\n`).concat('QA-EXT-SCROLL-DONE\n')); return true;
  }
  if (text === EDITED_DRAFT) { reply(ctx, 'QA-EXT-DRAFT-FINAL'); return true; }
  return false;
}
