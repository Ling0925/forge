import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { v2Checks as coreChecks } from './v2-checks.mjs';
import { extendedScenarios, extendedChecks } from './v2-extended.mjs';
export const v2Checks = { ...coreChecks, ...extendedChecks };

const fixture = (root, name) => join(root, 'tests/cli/fixtures/cli-v2', name);
export async function v2Context({ root, forgeHome, wsDir }) {
  const sessions = JSON.parse(await readFile(fixture(root, 'sessions.json'), 'utf8'));
  const folder = join(forgeHome, 'sessions');
  await mkdir(folder, { recursive: true, mode: 0o700 });
  for (const session of sessions) {
    // Stored sessions are real snapshots, not synthetic picker option labels.
    session.workspace = join(wsDir, 'resume-' + session.id);
    await mkdir(session.workspace, { recursive: true });
    await writeFile(join(folder, `${session.id}.json`), JSON.stringify(session), { mode: 0o600 });
  }
}
const start = [{ action: 'wait_quiet', ms: 700, timeout_ms: 12000 }, { action: 'mark', name: 'startup' }];
const quit = [{ action: 'type', text: '/quit' }, { action: 'key', name: 'enter' }, { action: 'wait_exit', timeout_ms: 8000 }, { action: 'mark', name: 'final' }];
const enter = (text) => [{ action: 'type', text }, { action: 'key', name: 'enter' }];
const direct = name => [{ action: 'wait', ms: 150 }, { action: 'mark', name }];
const mark = (name) => [{ action: 'wait_quiet', ms: 350, timeout_ms: 6000 }, { action: 'mark', name }];
const reply = (after) => [{ action: 'wait_for', pattern: 'QA-FIXTURE-REPLY', after_mark: after, timeout_ms: 15000 }, ...mark('reply')];
const coreScenarios = {
  'v2-no-color': { env: { NO_COLOR: '1' }, describe: 'NO_COLOR capture has no SGR', steps: () => [...start, ...quit], checks: ['v2_no_color'] },
  'v2-dumb': { env: { TERM: 'dumb' }, describe: 'dumb PTY has zero ESC', steps: () => [...start, ...quit], checks: ['v2_dumb'] },
  'v2-startup': { describe: 'four logical banner rows with actual initial width', steps: () => [...start, ...quit], checks: ['v2_startup'] },
  'v2-menu': { describe: 'visible slash filter, navigation, completion, escape and resize', steps: () => [
    ...start, { action: 'type', text: '/' }, ...mark('menu'), { action: 'key', name: 'ctrl-n' }, ...mark('next'),
    { action: 'key', name: 'ctrl-p' }, ...mark('previous'), { action: 'resize', cols: 40, rows: 12 }, ...mark('narrow'),
    { action: 'type', text: 'he' }, ...mark('filter'), { action: 'key', name: 'tab' }, ...mark('tab'),
    { action: 'key', name: 'esc' }, ...mark('escaped'), { action: 'key', name: 'ctrl-u' }, ...quit
  ], checks: ['v2_menu'] },
  'v2-model': { describe: '/model without argument: catalog selection affects actual provider request', steps: () => [
    ...start, ...enter('[qa-v2-initial] initial request'), ...reply('startup'), ...enter('/model'), ...mark('picker'), { action: 'type', text: 'qa-v2-model-012' }, ...mark('filtered'),
    { action: 'key', name: 'enter' }, ...mark('chosen'), ...enter('[qa-v2-model] chosen request'), ...reply('chosen'), ...quit
  ], checks: ['v2_model'] },
  'v2-resume': { describe: '/resume without argument uses stored UUID and its history', steps: () => [
    ...start, ...enter('/resume'), ...mark('picker'), { action: 'type', text: 'Implement dark mode toggle' }, ...mark('selected'),
    { action: 'key', name: 'enter' }, ...mark('resumed'), ...enter('[qa-v2-resume] check history'), ...reply('resumed'), ...quit
  ], checks: ['v2_resume'] },
  'v2-stream': { describe: 'busy draft and exact subsequent request', steps: () => [
    ...start, ...enter('[qa-stream] long reply'), { action: 'wait_for', pattern: 'QA-FIXTURE-STREAM', after_mark: 'startup', timeout_ms: 15000 },
    { action: 'type', text: '下一个 e\u0301 🎉 exact-draft' }, { action: 'key', name: 'left' }, ...direct('busy'),
    { action: 'key', name: 'enter' }, ...direct('busy-enter'), { action: 'resize', cols: 80, rows: 24 }, ...direct('busy-resized'),
    { action: 'wait_for', pattern: 'QA-FIXTURE-STREAM-OK', after_mark: 'busy', timeout_ms: 15000 }, ...mark('done'),
    { action: 'key', name: 'right' }, { action: 'key', name: 'enter' }, ...reply('done'), ...quit
  ], checks: ['v2_stream'] },
  'v2-approval': { describe: 'paste after approval does not independently execute, fresh approval only once', steps: () => [
    ...start, ...enter('[qa-v2-approval] run counter'),
    { action: 'wait_for', pattern: 'Allow|allow|approve.*\\[|\\[y/N\\]|\\[y/n\\]', after_mark: 'startup', timeout_ms: 12000 }, ...mark('approval'),
    { action: 'paste', text: 'y\ny\n' }, { action: 'wait', ms: 400 },
    { action: 'assert_file', path: 'qa-approval-counter', equals: '', name: 'paste-denied' }, ...mark('pasted'),
    { action: 'key', name: 'enter' }, { action: 'wait', ms: 1400 },
    { action: 'assert_file', path: 'qa-approval-counter', equals: '', name: 'enter-still-denied' },
    { action: 'wait_for', pattern: 'QA-V2-APPROVAL-DENIED', after_mark: 'pasted', timeout_ms: 12000 },
    ...enter('[qa-v2-approval] fresh counter'), { action: 'wait_for', pattern: 'Allow|allow|\\[y/N\\]|\\[y/n\\]', after_mark: 'pasted', timeout_ms: 12000 },
    { action: 'type', text: 'y' }, ...direct('partial'), { action: 'assert_file', path: 'qa-approval-counter', equals: '', name: 'partial-denied' },
    { action: 'key', name: 'enter' }, { action: 'wait_for', pattern: 'QA-V2-APPROVAL-RESULT', after_mark: 'partial', timeout_ms: 12000 },
    { action: 'assert_file', path: 'qa-approval-counter', equals: 'x', name: 'fresh-approved-once' }, ...mark('approved'), ...quit
  ], checks: ['v2_approval'] },
  'v2-interrupt': { describe: 'real Ctrl+C cancels slow stream and restores input', steps: () => [
    ...start, ...enter('[qa-slow] interrupt'),
    { action: 'wait_for', pattern: 'QA-FIXTURE-SLOW-HEAD', after_mark: 'startup', timeout_ms: 12000 }, ...mark('streaming'),
    { action: 'key', name: 'ctrl-c' }, ...mark('interrupted'), ...enter('after-interrupt'), ...reply('interrupted'), ...quit
  ], checks: ['v2_interrupt'] },
  'v2-eof-stream': { describe: 'raw Ctrl+D closes unfinished slow provider and restores terminal', steps: () => [
    ...start, ...enter('[qa-slow] eof'), { action: 'wait_for', pattern: 'QA-FIXTURE-SLOW-HEAD', after_mark: 'startup', timeout_ms: 12000 },
    ...direct('head'), { action: 'key', name: 'ctrl-d' }, { action: 'wait_exit', timeout_ms: 8000 }, { action: 'mark', name: 'final' }
  ], checks: ['v2_eof_stream'] },
  'v2-idle-interrupt': { describe: 'idle Ctrl+C clears draft; second empty Ctrl+C exits', steps: () => [
    ...start, { action: 'type', text: 'idle draft' }, ...mark('draft'), { action: 'key', name: 'ctrl-c' }, ...mark('cleared'),
    { action: 'key', name: 'ctrl-c' }, { action: 'wait_exit', timeout_ms: 8000 }, { action: 'mark', name: 'final' }
  ], checks: ['v2_idle_interrupt'] },
  'v2-picker-cancel': { describe: 'Escape cancels model/resume without changing actual model or session', steps: () => [
    ...start, ...enter('[qa-v2-cancel] before'), ...reply('startup'), ...enter('/model'), ...mark('model-picker'),
    { action: 'type', text: 'qa-v2-model-012' }, ...mark('model-filter'), { action: 'key', name: 'esc' }, ...mark('model-cancelled'),
    ...enter('[qa-v2-cancel] after model'), ...reply('model-cancelled'), ...enter('/resume'), ...mark('resume-picker'),
    { action: 'type', text: 'Implement dark mode toggle' }, ...mark('resume-filter'), { action: 'key', name: 'esc' }, ...mark('resume-cancelled'),
    ...enter('[qa-v2-cancel] after resume'), ...reply('resume-cancelled'), ...quit
  ], checks: ['v2_picker_cancel'] },
  'v2-help-enter': { describe: 'filtered slash Enter dispatches help; real help captures at80 and40', steps: () => [
    ...start, { action: 'resize', cols: 80, rows: 40 }, { action: 'type', text: '/he' }, ...mark('help-filter80'),
    { action: 'key', name: 'enter' }, ...mark('help80'), { action: 'resize', cols: 40, rows: 60 },
    { action: 'type', text: '/he' }, ...mark('help-filter40'), { action: 'key', name: 'enter' }, ...mark('help40'), ...quit
  ], checks: ['v2_help_enter'] },
  'v2-small': { rows: 12, describe: '40x12 input cursor and resize roundtrip', steps: () => [
    ...start, { action: 'resize', cols: 40, rows: 12 }, { action: 'type', text: '中文 🎉 e\u0301 resize exact' },
    { action: 'key', name: 'left' }, ...mark('small'), { action: 'resize', cols: 80, rows: 24 }, ...mark('wide'),
    { action: 'key', name: 'right' }, { action: 'key', name: 'enter' }, ...reply('wide'), ...quit
  ], checks: ['v2_small'] },
};

import { discoveryScenario } from './v2-discovery.mjs';
export const v2Scenarios = { ...coreScenarios, 'v2-model-discovery': discoveryScenario, ...extendedScenarios };
