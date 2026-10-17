import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const auth = JSON.parse(await readFile(process.env.FORGE_AUTHOR_CONFIG ?? join(homedir(), '.config', 'desktop-harness', 'development-api.json'), 'utf8'));
if (typeof auth.baseUrl !== 'string' || typeof auth.apiKey !== 'string') throw new Error('Invalid development API configuration');
const home = await mkdtemp(join(tmpdir(), 'forge-gemini-ui-'));
const attempt = process.argv[2] ?? 'initial';
const proposal = process.argv[4] !== 'write';
const requestedModel = process.argv[5];
if (!/^[a-z0-9-]+$/.test(attempt)) throw new Error('Invalid attempt label');
const evidence = join(root, '.build/gemini-design-fixes-ui', attempt);
await mkdir(evidence, { recursive: true, mode: 0o700 });
const diagnosticProxy = process.env.FORGE_DIAGNOSTIC_PROXY;
if (diagnosticProxy && !/^http:\/\/127[.]0[.]0[.]1:\d+\/v1$/.test(diagnosticProxy)) throw new Error('Invalid diagnostic proxy');
const env = { ...process.env, FORGE_MODEL: undefined, FORGE_HOME: home, FORGE_BASE_URL: diagnosticProxy ?? auth.baseUrl, FORGE_API_KEY: auth.apiKey };
const safe = text => {
  const redactedKey = auth.apiKey ? text.replaceAll(auth.apiKey, '[REDACTED]') : text;
  return auth.baseUrl ? redactedKey.replaceAll(auth.baseUrl, '[REDACTED_ENDPOINT]') : redactedKey;
};
async function cli(args, file) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(join(homedir(), '.local', 'bin', 'forge'), args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; let errors = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { errors += chunk; });
    child.once('error', () => reject(new Error('Forge could not start')));
    child.once('close', async code => {
      try {
        await writeFile(join(evidence, file), safe(`${output}\n${errors}`), { mode: 0o600 });
        resolveResult({ code, output, errors });
      } catch { reject(new Error('Could not retain Forge author evidence')); }
    });
  });
}
try {
  const setup = await cli(['config','set','--model','catalogue-discovery','--reasoning-effort','low','--max-tools','200','--timeout-ms','180000'], 'config.log');
  if (setup.code) throw new Error('Isolated Forge setup failed');
  const catalogue = await cli(['models','--json'], 'catalogue.log');
  if (catalogue.code) throw new Error('Forge model catalogue request failed; no retry was attempted');
  const ids = JSON.parse(catalogue.output);
  const list = Array.isArray(ids) ? ids : ids.ids ?? ids.models ?? [];
  const matches = list.map(item => typeof item === 'string' ? item : item.id).filter(id => typeof id === 'string' && /gemini-3[.]8-flash/i.test(id));
  console.log(JSON.stringify({ phase: 'catalogue', matches }));
  const catalogueIds = list.map(item => typeof item === 'string' ? item : item.id);
  const model = requestedModel ? (catalogueIds.includes(requestedModel) ? requestedModel : undefined) : matches.includes('ag/gemini-3.8-flash') ? 'ag/gemini-3.8-flash' : matches.length === 1 ? matches[0] : undefined;
  if (!model) throw new Error('Exact Gemini 3.8 Flash route must be selected from catalogue; no run started');
  const prompt = resolve(process.argv[3] ?? '.build/prompts/gemini-design-fixes-ui.md');
  await writeFile(join(evidence, 'manifest.json'), JSON.stringify({ model, promptSha256: createHash('sha256').update(await readFile(prompt)).digest('hex'), launcher:join(homedir(), '.local', 'bin', 'forge'), startedAt:new Date().toISOString(), isolatedHome:true, proposal, maxToolCalls:200 }, null, 2), { mode:0o600 });
  console.log(JSON.stringify({ phase: 'started', model }));
  const result = await cli(['run','--workspace',root,'--model',model,'--permission',proposal?'readonly':'unrestricted','--yes','--prompt-file',prompt,'--json'], 'run.jsonl');
  console.log(JSON.stringify({ phase: 'finished', model, code: result.code, log:join(evidence,'run.jsonl') }));
  process.exitCode = result.code ?? 1;
} catch (error) {
  console.error(JSON.stringify({ error: safe(error instanceof Error ? error.message : 'Forge authoring failed') }));
  process.exitCode = 1;
} finally { await rm(home, { recursive:true, force:true }); }
