const result = (ok, observed) => ({ status: ok ? 'pass' : 'fail', observed });
const state = (r, name) => { if (!r.states[name]?.viewport || !r.states[name]?.cells) throw new Error(`missing cell state ${name}`); return r.states[name]; };
const view = (r, name) => state(r, name).viewport.join('\n');
const requests = r => r.requests.filter(x => x.messages && !x.hasToolResult);
const composer = (r, name, text, x) => {
  const s = state(r, name);
  const rows = s.viewport.map((line, y) => ({ line: line.trimEnd(), y })).filter(({line}) => line === `❯ ${text}`.trimEnd());
  // Derive draft extent from expected text in captured cells, never from cursor.
  let extent = 0, assembled = '';
  if (rows.length === 1) for (const c of s.cells[rows[0].y]) {
    assembled += c.chars || (c.width === 0 ? '' : ' '); extent++;
    if (assembled === `❯ ${text}`) break;
  }
  const cellDraft = rows.length === 1 ? s.cells[rows[0].y].slice(0,extent).map(c=>c.chars || (c.width === 0 ? '' : ' ')).join('') : null;
  return { ok: rows.length === 1 && cellDraft === `❯ ${text}` && s.cursor.x === x && s.cursor.y === rows[0].y, cursor: s.cursor, rows, cellDraft };
};
const menuRows = (r, name) => state(r,name).viewport.flatMap((line,y) => /^\s*(?:❯ )?(\/\w+)\s+\S/.test(line) ? [{ name: line.match(/\/\w+/)[0], y, selected: state(r,name).cells[y].some(c => c.inverse) }] : []);
const selected = (r,name) => menuRows(r,name).filter(x=>x.selected).map(x=>x.name);
export const v2Checks = {
  v2_discovery(r) {
    const catalog = r.requests.filter(x=>x.catalog), req = requests(r);
    const time = n => r.events.find(e=>e.type==='mark' && e.name===n)?.wall_ms;
    const active = (n,i) => Number.isFinite(time(n)) && time(n)>=catalog[i]?.requestedAt && time(n)<(catalog[i]?.cancelledAt ?? catalog[i]?.settledAt);
    const loadingMarks = ['loading','mid-wait','draft','gated','success-loading','success-mid','error-loading','error-mid'];
    const feedback = loadingMarks.map(n=>{
      const s=state(r,n), rows=s.viewport.map((line,y)=>({line,y})).filter(x=>x.line.includes('Loading models'));
      const row=rows[0];
      const cells=row ? s.cells[row.y].map(c=>c.chars || (c.width===0?'':' ')).join('') : '';
      return {name:n, ok:rows.length===1 && cells.includes('Loading models') && row.y<s.cursor.y && /\b\d+s\b/.test(row.line) && row.line.includes('Ctrl+C') && (s.cols===40 || row.line.includes('cancel')), row, cursor:s.cursor};
    });
    const geometry=Object.fromEntries(['draft','gated'].map(n=>[n,composer(r,n,'catalog draft',14)]));
    const immediate=['loading','success-loading','error-loading'].every((n,i)=>active(n,i) && time(n)-catalog[i].requestedAt<2000);
    const mid=['mid-wait','success-mid','error-mid'].every((n,i)=>active(n,i) && /[1-9][0-9]*s/.test(view(r,n)));
    const cleanMarks=['cancelled','restored','picker','filtered','chosen','selected-reply','error','error-restored'];
    const clean=cleanMarks.every(n=>!view(r,n).includes('Loading models'));
    const prompt=n=>{const s=state(r,n);return s.cursor.x===2 && /^❯(?: Ask anything · \/ for commands)?\s*$/.test(s.viewport[s.cursor.y]);};
    const filtered=state(r,'filtered');
    const exactPicker=filtered.viewport.some((line,y)=>line.includes('qa-v2-model-012') && filtered.cells[y].some(c=>c.inverse));
    const lifecycle=catalog.length===3 && catalog.every((c,i)=>c.ordinal===i+1) && catalog[0].state==='cancelled' && catalog[0].completed===false && catalog[0].cancelledAt<=time('cancelled') && catalog[1].state==='settled' && catalog[1].completed===true && catalog[1].settledAt<=time('picker') && catalog[2].state==='error' && catalog[2].completed===true && catalog[2].settledAt<=time('error');
    const prompts=['[qa-discovery] after cancel','[qa-discovery] selected','[qa-discovery] after error'];
    const actual=req.length===3 && req.every((x,i)=>x.lastUser===prompts[i]) && req[0].model==='qa-fixture-model' && req.slice(1).every(x=>x.model==='qa-v2-model-012') && Date.parse(req[0].at)>time('gated');
    return result(feedback.every(x=>x.ok) && immediate && mid && active('draft',0) && active('gated',0) && Object.values(geometry).every(x=>x.ok) && clean && prompt('restored') && prompt('error') && prompt('error-restored') && exactPicker && lifecycle && actual && r.exitEvent.code===0, {feedback,geometry,immediate,mid,clean,exactPicker,lifecycle,catalog,prompts:req.map(x=>({prompt:x.lastUser,model:x.model}))});
  },

  v2_no_color(r) { return result(!/\x1b\[[0-9;]*m/.test(r.rawText), { sgrCount: (r.rawText.match(/\x1b\[[0-9;]*m/g)||[]).length, rawBytes:r.rawText.length }); },
  v2_dumb(r) { return result(!r.rawText.includes('\x1b'), { escCount:(r.rawText.match(/\x1b/g)||[]).length, rawBytes:r.rawText.length }); },
  v2_startup(r) {
    const s = state(r,'startup');
    const lines = s.viewport.map(x=>x.trimEnd());
    const composerRows = lines.map((line,y)=>({line,y})).filter(x=>/^❯(?: |$)/.test(x.line));
    const banner = lines.slice(0,composerRows[0]?.y).filter(x=>x.trim());
    const logical = [];
    for (let y=0; y<(composerRows[0]?.y ?? lines.length); y++) {
      if (!lines[y].trim()) continue;
      // Rich output can explicitly newline-wrap (not xterm auto-wrap). Only
      // accept continuation after a full-width physical row, never a fifth
      // short content row. Known banner row starts remain separate.
      const knownStart = /^(Forge\b|qa-fixture-model\b|\/tmp\/|\/ 命令)/.test(lines[y]);
      const previousFull = y > 0 && s.cells[y-1]?.some((c,x) => c.chars?.trim() && x + c.width >= s.cols);
      if (!knownStart && logical.length && (s.wrapped?.[y] || previousFull)) logical[logical.length-1] += lines[y];
      else logical.push(lines[y]);
    }
    const prompt = composerRows[0];
    const ok = [120,80,40].includes(s.cols) && composerRows.length === 1 && s.cursor.x === 2 && s.cursor.y === prompt?.y && logical.length >= 1 && logical.length <= 4 && (s.cols !== 120 || banner.length <= 4) && !/\b(usage|options)\b/i.test(logical.join(' '));
    return result(ok, { banner, logical, composerRows, cursor:s.cursor, cols:s.cols, wrapped:s.wrapped });
  },
  v2_menu(r) {
    const rows = menuRows(r,'menu'), filtered = menuRows(r,'filter');
    const selections = Object.fromEntries(['menu','next','previous','narrow'].map(n=>[n,selected(r,n)]));
    const tab = composer(r,'tab','/help ',8), escaped = composer(r,'escaped','/help ',8);
    const ok = rows.length >= 2 && rows.length <= 8 && Object.values(selections).every(x=>x.length===1) && selections.menu[0] !== selections.next[0] && selections.previous[0] === selections.menu[0] && selections.narrow[0] === selections.previous[0] && filtered.length === 1 && filtered[0].name === '/help' && tab.ok && escaped.ok && menuRows(r,'escaped').length === 0;
    return result(ok,{ rows, filtered, selections, tab, escaped });
  },
  v2_model(r) {
    const req = requests(r), initial = req.filter(x=>x.lastUser === '[qa-v2-initial] initial request'), chosen = req.filter(x=>x.lastUser === '[qa-v2-model] chosen request');
    return result(/qa-v2-model-00[1-9]/.test(view(r,'picker')) && /qa-v2-model-012/.test(view(r,'filtered')) && initial.length===1 && chosen.length===1 && initial[0].model !== chosen[0].model && chosen[0].model === 'qa-v2-model-012', { initial: initial.map(x=>x.model), chosen: chosen.map(x=>x.model), picker: view(r,'picker') });
  },
  v2_resume(r) {
    const req = requests(r).filter(x=>x.lastUser === '[qa-v2-resume] check history');
    const expected = [{role:'user',content:'Add a dark mode toggle to settings'},{role:'assistant',content:"I'll implement a theme toggle in the settings panel."}];
    const history = req[0]?.messages || [], persisted = r.persistedSession;
    const exactHistory = expected.every((x,i)=>history.some((m,j)=>m.role===x.role && m.content===x.content && (i===0 || history[j-1]?.content===expected[0].content)));
    const wrongHistory = history.some(x=>['Fix the login bug','Review the database migration scripts 🗄️'].includes(x.content));
    return result(/Implement dark mode toggle/.test(view(r,'selected')) && req.length===1 && exactHistory && !wrongHistory && persisted?.id==='22222222-2222-4222-8222-222222222222' && persisted.messages.some(x=>x.role==='user' && x.content==='[qa-v2-resume] check history'), { history, persistedId:persisted?.id, persistedWorkspace:persisted?.workspace, persistedMessages:persisted?.messages });
  },
  v2_stream(r) {
    const draft = '下一个 e\u0301 🎉 exact-draft';
    // 2 prompt cells + 6 CJK + 3 spaces + e (combining accent=0) + emoji(2) + exact-draft(11) = 25; Left => 24.
    const geometry = Object.fromEntries(['busy','busy-enter','busy-resized','done'].map(n=>[n,composer(r,n,draft,24)]));
    const req = requests(r), mark = r.events.find(x=>x.type==='mark' && x.name==='busy-resized');
    const busyTimes = ['busy','busy-enter','busy-resized'].map(n=>r.events.find(e=>e.type==='mark' && e.name===n)?.wall_ms);
    const active = busyTimes.every(t=>Number.isFinite(t) && t >= req[0]?.responseStarted && t < req[0]?.responseCompleted);
    const before = req.filter(x=>Date.parse(x.at) <= mark?.wall_ms);
    return result(active && Object.values(geometry).every(x=>x.ok) && req.length===2 && req[0].lastUser==='[qa-stream] long reply' && req[1].lastUser===draft && before.length===1 && Number.isFinite(mark?.wall_ms), { geometry, prompts:req.map(x=>x.lastUser), requestsBeforeBusyResize:before.length });
  },
  v2_small(r) {
    const draft = '中文 🎉 e\u0301 resize exact';
    const small = composer(r,'small',draft,23), wide = composer(r,'wide',draft,23);
    return result(small.ok && wide.ok && state(r,'small').cols===40 && state(r,'small').rows===12 && state(r,'wide').cols===80 && requests(r).filter(x=>x.lastUser===draft).length===1,{small,wide,prompts:requests(r).map(x=>x.lastUser)});
  },
  v2_approval(r) {
    const observations = r.events.filter(x=>x.type==='assert_file');
    return result(observations.length===4 && observations.every(x=>x.matched) && r.counterText==='x' && r.requests.filter(x=>x.approvalValidation?.ok).length===1,{ observations, counter:r.counterText, toolRequests:r.requests.filter(x=>x.hasToolResult) });
  },
  v2_eof_stream(r) {
    const req = requests(r), closure = r.requests.filter(x=>x.responseClosed && !x.completed);
    const restored = r.events.find(x=>x.type==='terminal_restoration');
    const elapsed = closure[0]?.responseClosedAt - Date.parse(req[0]?.at);
    const pasteOff = r.rawText.lastIndexOf('\x1b[?2004l') > r.rawText.lastIndexOf('\x1b[?2004h') && r.rawText.includes('\x1b[?2004h');
    return result(req.length===1 && req[0].lastUser==='[qa-slow] eof' && closure.length===1 && elapsed>=0 && elapsed<25000 && !r.rawText.includes('QA-FIXTURE-SLOW-TAIL') && r.exitEvent.code===0 && pasteOff && restored?.canonical===true && restored?.echo===true, {prompts:req.map(x=>x.lastUser),closure,elapsed,pasteOff,restored,exit:r.exitEvent});
  },
  v2_idle_interrupt(r) {
    const draft=composer(r,'draft','idle draft',12), s=state(r,'cleared');
    const row=s.viewport[s.cursor.y]?.trimEnd();
    const cleared=s.cursor.x===2 && /^❯(?: Ask anything · \/ for commands)?$/.test(row) && !view(r,'cleared').includes('idle draft');
    const restored=r.events.find(x=>x.type==='terminal_restoration');
    return result(draft.ok && cleared && requests(r).length===0 && r.exitEvent.code===0 && restored?.canonical===true && restored?.echo===true,{draft,cleared,row,cursor:s.cursor,restored,exit:r.exitEvent});
  },
  v2_picker_cancel(r) {
    const prompts=['[qa-v2-cancel] before','[qa-v2-cancel] after model','[qa-v2-cancel] after resume'];
    const req=requests(r), sessions=r.sessionSnapshots.filter(s=>s.messages.some(m=>m.role==='user' && m.content===prompts[0]));
    const sameSession=sessions.length===1 && prompts.every(p=>sessions[0].messages.some(m=>m.role==='user' && m.content===p)) && sessions[0].workspace===r.ctx.wsDir;
    const history=req[2]?.messages || [];
    const sameHistory=prompts.slice(0,2).every(p=>history.some(m=>m.role==='user' && m.content===p)) && !history.some(m=>m.content==='Add a dark mode toggle to settings');
    const pickerGone=['model-cancelled','resume-cancelled'].every(n=>!state(r,n).cells.some(row=>row.some(c=>c.inverse)));
    return result(req.length===3 && req.every((x,i)=>x.lastUser===prompts[i] && x.model===req[0].model) && /qa-v2-model-012/.test(view(r,'model-filter')) && /Implement dark mode toggle/.test(view(r,'resume-filter')) && pickerGone && sameHistory && sameSession,{prompts:req.map(x=>x.lastUser),models:req.map(x=>x.model),pickerGone,sameHistory,sessions:sessions.map(s=>({id:s.id,workspace:s.workspace}))});
  },
  v2_help_enter(r) {
    const marks=['help80','help40'];
    const observations=marks.map((n,i)=>({mark:n,cols:state(r,n).cols,text:r.screens[n],shots:r.screenshots.filter(s=>s.mark===n)}));
    const filterRows=Object.fromEntries(['help-filter80','help-filter40'].map(n=>{const s=state(r,n);return [n,menuRows(r,n).filter(row=>row.y>s.cursor.y)];}));
    // Previous dispatched help remains in scrollback/viewport: only the live
    // suggestion area below the current composer is the menu being filtered.
    const filters=Object.values(filterRows).every(rows=>rows.length===1 && rows[0].name==='/help' && rows[0].selected);
    const help=observations.every((o,i)=>o.cols===[80,40][i] && ['/help','/model','/resume','/quit'].every(cmd=>o.text.includes(cmd)) && o.shots.length===1);
    return result(filters && help && requests(r).length===0,{filters,observations,requests:requests(r).length});
  },
  v2_interrupt(r) {
    const req = requests(r);
    return result(req.length===2 && req[1].lastUser==='after-interrupt' && r.requests.some(x=>x.responseClosed && !x.completed) && !view(r,'reply').includes('QA-FIXTURE-SLOW-TAIL') && r.exitEvent.code===0,{prompts:req.map(x=>x.lastUser), closure:r.requests.filter(x=>x.responseClosed),exit:r.exitEvent});
  },
};
