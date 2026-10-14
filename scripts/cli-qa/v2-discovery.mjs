// Harness-only finite catalog lifecycle; never enabled by model IDs or product env.
export function discoveryFixture(runId, log) {
  let ordinal = 0;
  const pending = new Set();
  return {
    handle(res) {
      const index = ++ordinal;
      const outcome = ['cancel', 'success', 'error'][index - 1] ?? 'unexpected';
      const entry = { scenario: 'v2-model-discovery', runId, catalog: true, ordinal: index,
        outcome, at: new Date().toISOString(), requestedAt: Date.now(), state: 'pending' };
      log.push(entry);
      // Keep each wait bounded, but long enough for a real elapsed status and editing.
      const timer = setTimeout(() => {
        pending.delete(timer);
        entry.settledAt = Date.now();
        entry.state = outcome === 'error' || outcome === 'unexpected' ? 'error' : 'settled';
        res.writeHead(entry.state === 'error' ? 400 : 200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(entry.state === 'error'
          ? { error: { message: 'QA-DISCOVERY-CATALOG-ERROR' } }
          : { object: 'list', data: Array.from({ length: 15 }, (_, i) => ({ id: `qa-v2-model-${String(i + 1).padStart(3, '0')}`, object: 'model' })) }));
      }, 5000);
      pending.add(timer);
      res.on('close', () => {
        clearTimeout(timer); pending.delete(timer);
        entry.closedAt = Date.now(); entry.completed = res.writableEnded;
        if (!res.writableEnded) { entry.state = 'cancelled'; entry.cancelledAt = entry.closedAt; }
      });
    },
    dispose() { for (const timer of pending) clearTimeout(timer); pending.clear(); },
  };
}
const mark = name => ({ action: 'mark', name });
const key = name => ({ action: 'key', name });
const enter = text => [{ action: 'type', text }, key('enter')];
const wait = (pattern, after_mark, timeout_ms = 8000) => ({ action: 'wait_for', pattern, after_mark, timeout_ms });
const quiet = { action: 'wait_quiet', ms: 350, timeout_ms: 6000 };
const loading = 'Loading models';
const mid = 'Loading models[^\\r\\n]*[1-9][0-9]*s';
export const discoveryScenario = {
  describe: 'isolated delayed catalog: visible status, editable gated draft, cancel, exact selection and error cleanup',
  steps: () => [
    { action: 'wait_quiet', ms: 700, timeout_ms: 12000 }, mark('startup'),
    ...enter('/model'), wait(loading, 'startup', 2500), mark('loading'),
    wait(mid, 'loading', 3000), mark('mid-wait'),
    { action: 'type', text: 'catalog draft' }, key('left'), mark('draft'),
    key('enter'), mark('gated'), key('ctrl-c'), quiet, mark('cancelled'),
    key('right'), key('ctrl-u'), ...enter('[qa-discovery] after cancel'), wait('QA-FIXTURE-REPLY', 'cancelled'), quiet, mark('restored'),
    ...enter('/model'), wait(loading, 'restored', 2500), mark('success-loading'),
    wait(mid, 'success-loading', 3000), mark('success-mid'),
    wait('qa-v2-model-001', 'success-mid'), quiet, mark('picker'),
    { action: 'type', text: 'qa-v2-model-012' }, quiet, mark('filtered'), key('enter'), quiet, mark('chosen'),
    ...enter('[qa-discovery] selected'), wait('QA-FIXTURE-REPLY', 'chosen'), quiet, mark('selected-reply'),
    ...enter('/model'), wait(loading, 'selected-reply', 2500), mark('error-loading'),
    wait(mid, 'error-loading', 3000), mark('error-mid'),
    wait('HTTP 400', 'error-mid'), quiet, mark('error'),
    ...enter('[qa-discovery] after error'), wait('QA-FIXTURE-REPLY', 'error'), quiet, mark('error-restored'),
    ...enter('/quit'), { action: 'wait_exit', timeout_ms: 8000 }, mark('final'),
  ],
  checks: ['v2_discovery'],
};
