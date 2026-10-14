import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { v2Scenarios, v2Checks } from './v2.mjs';
for (const file of ['scripts/qa-cli-terminal.mjs','scripts/cli-qa/v2.mjs','scripts/cli-qa/v2-checks.mjs','scripts/cli-qa/preflight.mjs','scripts/cli-qa/v2-extended.mjs']) {
  assert.equal(spawnSync(process.execPath,['--check',file]).status,0,file);
}
for (const file of await readdir('tests/cli/fixtures/cli-v2')) if (file.endsWith('.json')) JSON.parse(await readFile(`tests/cli/fixtures/cli-v2/${file}`,'utf8'));
assert.equal(spawnSync('python3',['-c',"import ast,pathlib; ast.parse(pathlib.Path('.build/qa-pty-helper.py').read_text())"]).status,0);
const source = await readFile('scripts/qa-cli-terminal.mjs','utf8');
const html = vm.runInNewContext(source.match(/const RENDER_HTML = (`[\s\S]*?`);/)[1]);
new vm.SourceTextModule(html.match(/<script type="module">([\s\S]*?)<\/script>/)[1]);
for (const [name,scenario] of Object.entries(v2Scenarios)) for (const check of scenario.checks) assert.equal(typeof v2Checks[check],'function',`${name}:${check}`);
const frame = (lines, x, y) => ({ cols:120, rows:30, cursor:{x,y}, viewport:lines.map(s=>s.padEnd(120)), cells:lines.map(line=>Array.from({length:120},(_,x)=>({chars:line[x] || ' ',width:1,inverse:false}))) });
const states = {};
const menu = ['Banner /help','❯ /','❯ /help Help','  /model Model'];
for (const name of ['menu','previous','narrow']) { states[name]=frame(menu,3,1); states[name].cells[2][0].inverse=true; }
states.next=frame(menu,3,1); states.next.cells[3][0].inverse=true;
states.filter=frame(['❯ /he','❯ /help Help'],5,0);
states.tab=frame(['❯ /help '],8,0); states.escaped=frame(['❯ /help '],8,0);
assert.equal(v2Checks.v2_menu({states}).status,'pass','valid Tab trailing-space frame');
states.escaped.cursor.x=7;
assert.equal(v2Checks.v2_menu({states}).status,'fail','wrong cursor must fail');
states.escaped.cursor.x=8; states.next.cells[3][0].inverse=false; states.next.cells[2][0].inverse=true;
assert.equal(v2Checks.v2_menu({states}).status,'fail','unchanged selection must fail');
states.startup=frame(['Forge','Model','Workspace','Hint /help','❯ Ask anything · / for commands'],2,4);
assert.equal(v2Checks.v2_startup({states}).status,'pass');
states.startup.cursor.x=3;
assert.equal(v2Checks.v2_startup({states}).status,'fail','wrong placeholder cursor');
states.startup=frame(['Forge','Model','Workspace','Hint','Extra','❯ Ask anything · / for commands'],2,5);
assert.equal(v2Checks.v2_startup({states}).status,'fail');
assert.throws(()=>v2Checks.v2_stream({states:{},requests:[],events:[]}));
// Regression from real root cells: mid-line cursor is independent of draft extent.
const unicodeFrame = (text,x) => {
  const s=frame([`❯ ${text}`],x,0); const cells=[];
  for (const c of `❯ ${text}`) {
    if (/\p{Mark}/u.test(c)) { cells.at(-1).chars += c; continue; }
    const width=/[\p{Script=Han}\p{Extended_Pictographic}]/u.test(c)?2:1;
    cells.push({chars:c,width,inverse:false}); if(width===2) cells.push({chars:'',width:0,inverse:false});
  }
  while(cells.length<120) cells.push({chars:'',width:1,inverse:false}); s.cells=[cells]; return s;
};
const small=unicodeFrame('中文 🎉 e\u0301 resize exact',23), wide=unicodeFrame('中文 🎉 e\u0301 resize exact',23);
small.cols=40; small.rows=12; wide.cols=80;
const smallRun={states:{small,wide},requests:[{messages:[],lastUser:'中文 🎉 e\u0301 resize exact'}]};
assert.equal(v2Checks.v2_small(smallRun).status,'pass','Unicode full draft with mid-line cursor');
wide.cells[0][4].chars='错';
assert.equal(v2Checks.v2_small(smallRun).status,'fail','wrong CJK cell must fail');
console.log('PASS: syntax/browser module, JSON fixtures, helper AST, check IDs, positive/negative startup/menu geometry oracles');
