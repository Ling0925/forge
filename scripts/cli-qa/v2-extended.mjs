/** Owned external API QA extension; no runner/product imports with side effects. */
import { DRAFT, INSERT, TOOL_PROMPT } from './extended/fixtures.mjs';
export { handleExtendedFixture } from './extended/fixtures.mjs';
export { extendedChecks } from './extended/checks.mjs';
const enter = text => [{ action: 'type', text }, { action: 'key', name: 'enter' }];
const mark = (name, ms = 350) => [{ action: 'wait_quiet', ms, timeout_ms: 8000 }, { action: 'mark', name }];
const direct = name => [{ action: 'wait', ms: 120 }, { action: 'mark', name }];
const wait = (pattern, after_mark) => ({ action: 'wait_for', pattern, after_mark, timeout_ms: 15000 });
const key = name => ({ action: 'key', name });
const start = [...mark('startup', 700)];
const quit = [...enter('/quit'), { action: 'wait_exit', timeout_ms: 8000 }, { action: 'mark', name: 'final' }];
export const extendedScenarios = {
  'v2-extended-markdown': {
    describe: 'fragmented terminated OSC/C1 markdown, explicit open-fence partial pause, preserved hyperlink label',
    steps: () => [...start, ...enter('[qa-extended-markdown] render hostile markdown'),
      wait('const qaExt', 'startup'), ...direct('partial'),
      wait('completed', 'partial'), ...mark('settled'), ...quit],
    checks: ['v2_extended_markdown'],
  },
  'v2-extended-tools': {
    describe: 'one user prompt, finite real write/edit/exit-3 command chain with scoped envelope validation',
    steps: () => [...start, ...enter('/permission unrestricted'), ...mark('permission'),
      ...enter(TOOL_PROMPT), wait('run_command', 'permission'), ...direct('tools-running'),
      wait('QA-EXT-TOOL-(FINAL|INVALID)', 'tools-running'), ...mark('tools-final'), ...quit],
    checks: ['v2_extended_tools'],
  },
  'v2-extended-scroll': {
    rows: 24,
    describe: '90 unique history lines, slash menu before draft, exact midline insertion and resize cursor preservation',
    steps: () => [...start, ...enter('[qa-extended-scroll] fill more than two screens'),
      wait('QA-EXT-SCROLL-DONE', 'startup'), ...mark('scrolled'),
      { action: 'type', text: '/' }, ...mark('menu-open'), key('esc'), key('ctrl-u'), ...mark('menu-close'),
      { action: 'resize', cols: 80, rows: 24 }, { action: 'type', text: DRAFT }, ...direct('draft-80'),
      ...Array.from({ length: 4 }, () => key('left')), { action: 'type', text: INSERT }, ...direct('draft-mid'),
      { action: 'resize', cols: 40, rows: 12 }, ...mark('draft-40', 500),
      { action: 'resize', cols: 40, rows: 30 }, ...mark('draft-tall', 500),
      ...Array.from({ length: 4 }, () => key('right')), key('enter'),
      wait('QA-EXT-DRAFT-FINAL', 'draft-tall'), ...mark('submitted'), ...quit],
    checks: ['v2_extended_scroll'],
  },
};
