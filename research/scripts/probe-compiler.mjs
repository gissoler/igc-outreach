// Sondeo: ¿el compilador (8017) se cuelga por el response_format con esquema?
// Uso: node --env-file-if-exists=.env scripts/probe-compiler.mjs
import { readFileSync } from 'node:fs';
import { chatJSON } from '../server/analysis/fleet.mjs';
import { understandPrompt } from '../server/research/agentic/prompts.v14.mjs';
const brief = JSON.parse(readFileSync('eval/briefs/jefe-igc-mint-ad-2026-10-12.json', 'utf8'));
const p = understandPrompt({ brief, objective: 'grant', today: '2026-10-12' });
const url = 'http://127.0.0.1:8017/v1/chat/completions', model = 'Qwen/Qwen3-30B-A3B-Instruct-2507';
console.log('system chars:', p.system.length, '· user chars:', p.user.length, '· schema bytes:', JSON.stringify(p.schema || null).length);
async function run(label, rf) {
  const t = Date.now();
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(60000),
      body: JSON.stringify({ model, temperature: 0, stream: false, messages: [{ role: 'system', content: p.system }, { role: 'user', content: p.user }], ...(rf ? { response_format: rf } : {}) }) });
    const j = await r.json();
    console.log(label.padEnd(14), `${Date.now() - t} ms`, r.status, (j.error?.message || j.choices?.[0]?.message?.content || '').slice(0, 160).replace(/\n/g, ' '));
  } catch (e) { console.log(label.padEnd(14), `${Date.now() - t} ms`, 'ERROR', e.message); }
}
if (false) await run('json_schema', { type: 'json_schema', json_schema: { name: 'understand', schema: p.schema } });

{ const t = Date.now(); try {
  const env = { ...process.env, COMPILER_LLM_URL: 'http://127.0.0.1:8017/v1', COMPILER_LLM_MODEL: model, COMPILER_LLM_JSON_MODE: '1', COMPILER_LLM_SCHEMA_LOOSE: '1', COMPILER_LLM_TIMEOUT_MS: '60000' };
  const r = await chatJSON({ system: p.system, user: p.user, schema: p.schema, name: 'understand', role: 'compiler' }, { env });
  console.log('esquema suelto', `${Date.now() - t} ms`, JSON.stringify(r.json).slice(0, 200));
} catch (e) { console.log('esquema suelto', `${Date.now() - t} ms`, 'ERROR', e.message); } }
