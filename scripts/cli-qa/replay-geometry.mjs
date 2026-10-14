// Browser-only capture geometry diagnostic. Never invokes a CLI or model API.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import vm from 'node:vm';
import { chromium } from 'playwright';
const [evidenceDir, outputDir] = process.argv.slice(2);
assert(evidenceDir && outputDir, 'usage: node scripts/cli-qa/replay-geometry.mjs EVIDENCE_DIR NEW_OUTPUT_DIR');
await mkdir(outputDir); // Refuse to overwrite prior evidence.
const source = await readFile('scripts/qa-cli-terminal.mjs', 'utf8');
const html = vm.runInNewContext(source.match(/const RENDER_HTML = (`[\s\S]*?`);/)[1]);
const summary = JSON.parse(await readFile(`${evidenceDir}/summary.json`, 'utf8'));
const run = summary.runs.find(r => r.scenario === 'v2-help-enter');
assert(run);
const raw = await readFile(`${evidenceDir}/${run.artifacts.raw}`);
const eventBytes = await readFile(`${evidenceDir}/${run.artifacts.events}`);
const events = eventBytes.toString().trim().split('\n').map(JSON.parse);
const base = summary.deps.xterm;
const assets = {
  '/assets/xterm/xterm.mjs': `${base}/@xterm/xterm/lib/xterm.mjs`,
  '/assets/xterm/xterm.css': `${base}/@xterm/xterm/css/xterm.css`,
  '/assets/xterm/addon-fit.mjs': `${base}/@xterm/addon-fit/lib/addon-fit.mjs`,
  '/assets/xterm/addon-unicode11.mjs': '.build/qa-deps/@xterm/addon-unicode11/lib/addon-unicode11.mjs',
};
const server = createServer(async (req, res) => {
  try {
    assert(req.url === '/render' || assets[req.url]);
    res.setHeader('content-type', req.url === '/render' ? 'text/html' : req.url.endsWith('.css') ? 'text/css' : 'text/javascript');
    res.end(req.url === '/render' ? html : await readFile(assets[req.url]));
  } catch { res.writeHead(404).end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const report = { execution: 'replay only; no CLI/API execution, not new acceptance', source: evidenceDir,
  cli: summary.cli, rawSha256: sha(raw), eventsSha256: sha(eventBytes), rendererSha256: sha(source), captures: [] };
let browser;
async function capture(page, name) {
  const state = await page.evaluate(() => window.__qa.state());
  const geometry = await page.evaluate(() => {
    const selectors = ['#host','.xterm','.xterm-screen','.xterm-viewport','.xterm-rows','.xterm-rows > div:nth-child(7)','canvas'];
    return { dpr: devicePixelRatio, viewport: {width:innerWidth,height:innerHeight}, elements: selectors.flatMap(selector =>
      Array.from(document.querySelectorAll(selector), el => { const b=el.getBoundingClientRect(), c=getComputedStyle(el);
        return {selector, width:b.width,height:b.height,x:b.x,y:b.y,scrollWidth:el.scrollWidth,clientWidth:el.clientWidth,
          styleWidth:el.style.width,font:c.font,letterSpacing:c.letterSpacing,textSpacingTrim:c.textSpacingTrim,overflow:c.overflow,canvasWidth:el.width,canvasHeight:el.height,
          text:selector.includes('nth-child')?el.textContent:undefined,
          spans:selector.includes('nth-child')?Array.from(el.children,s=>{const r=s.getBoundingClientRect(),c=getComputedStyle(s);return {text:s.textContent,x:r.x,width:r.width,font:c.font,style:s.getAttribute('style')};}):undefined}; })) };
  });
  const png = await page.locator('#host').screenshot({path:`${outputDir}/${name}.png`});
  const pixelProof = await page.evaluate(async ([data, cols, row, theme]) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + data; await img.decode();
    const canvas = document.createElement('canvas'); canvas.width=img.width; canvas.height=img.height;
    const ctx=canvas.getContext('2d'); ctx.drawImage(img,0,0);
    const screen=document.querySelector('.xterm-screen').getBoundingClientRect();
    const cell=screen.width/cols, height=screen.height/window.__qa.state().rows;
    const d=ctx.getImageData(Math.round((screen.x+(cols-1)*cell)*2),Math.round((screen.y+row*height)*2),Math.round(cell*2),Math.round(height*2));
    const bitmap=Array.from({length:d.height},(_,y)=>Array.from({length:d.width},(_,x)=>{
      const i=(y*d.width+x)*4, sum=d.data[i]+d.data[i+1]+d.data[i+2];
      return (theme==='light'?sum<400:sum>500)?'#':' ';
    }).join('')).join('\n');
    return {finalColumnBitmap:bitmap, pngWidth:img.width,pngHeight:img.height};
  },[png.toString('base64'),state.cols,name.includes('help80')?6:0,name.split('-')[0]]);
  report.captures.push({name,geometry,state,pixelProof});
}
try {
  browser = await chromium.launch({ executablePath: summary.deps.chrome,
    args:['--no-sandbox','--force-color-profile=srgb','--disable-lcd-text'] });
  const page = await browser.newPage({deviceScaleFactor:2});
  for (const theme of ['light','dark']) {
    await page.goto(`http://127.0.0.1:${server.address().port}/render`);
    await page.waitForFunction(() => window.__qaReady);
    const start = events.find(e=>e.type==='start');
    await page.evaluate(([c,r,t])=>window.__qa.init(c,r,t),[start.cols,start.rows,theme]);
    let fed=0;
    for (const ev of events.filter(e=>e.type==='mark'||e.type==='resize')) {
      const offset=ev.offset??raw.length;
      if(offset>fed) await page.evaluate(b=>window.__qa.feed(b),raw.subarray(fed,offset).toString('base64'));
      fed=Math.max(fed,offset);
      if(ev.type==='resize') { await page.evaluate(([c,r])=>window.__qa.resize(c,r),[ev.cols,ev.rows]); continue; }
      const state = await page.evaluate(()=>window.__qa.state());
      const box=await page.locator('#host').boundingBox();
      await page.setViewportSize({width:Math.ceil(box.width)+24,height:Math.ceil(box.height)+24});
      if(ev.name==='help80') {
        assert.deepEqual(state.cells[6].slice(78,80).map(c=>[c.chars,c.width]),[['I',1],['D',1]]);
        await capture(page,`${theme}-help80`);
      }
      if(ev.name==='help40') await capture(page,`${theme}-help40`);
    }
    // Synthetic terminal data only, not product text. Exact final-column ASCII
    // and adjacent CJK are rendered at 120 -> 80 -> 40 with unchanged cols.
    await page.evaluate(t=>window.__qa.init(120,12,t),theme);
    for (const cols of [120,80,40]) {
      await page.evaluate(c=>window.__qa.resize(c,12),cols);
      const text='\x1b[2J\x1b[H'+' '.repeat(cols-4)+'中ID\r\n'+' '.repeat(cols-2)+'中文';
      await page.evaluate(b=>window.__qa.feed(b),Buffer.from(text).toString('base64'));
      const state=await page.evaluate(()=>window.__qa.state());
      assert.equal(state.cols,cols);
      assert.deepEqual(state.cells[0].slice(cols-4).map(c=>[c.chars,c.width]),[['中',2],['',0],['I',1],['D',1]]);
      // Second row has a CJK glyph ending at the boundary; next wraps naturally.
      assert.deepEqual(state.cells[1].slice(cols-2).map(c=>[c.chars,c.width]),[['中',2],['',0]]);
      const box=await page.locator('#host').boundingBox();
      await page.setViewportSize({width:Math.ceil(box.width)+24,height:Math.ceil(box.height)+24});
      await capture(page,`${theme}-edge-${cols}`);
    }
  }
} finally {
  await writeFile(`${outputDir}/geometry.json`,JSON.stringify(report,null,2));
  if(browser) await browser.close();
  await new Promise(r=>server.close(r));
}
console.log(`PASS browser replay/edge cells; inspect PNG/geometry in ${outputDir}`);
