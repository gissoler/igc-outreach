// Sondeo: evalúa UNA página guardada con el assess real y muestra la salida cruda + errores de validación.
// Uso: node --env-file-if-exists=.env scripts/probe-assess.mjs [carpeta-de-run] [fragmento-del-texto-de-la-página]
import { readFileSync, readdirSync } from 'node:fs';
import { chatJSON } from '../server/analysis/fleet.mjs';
import { assessPrompt } from '../server/research/agentic/prompts.v14.mjs';
import { validateAssess } from '../server/research/agentic/contracts.v14.mjs';
const run = process.argv[2] || 'eval/runs/v14-3-grant-234229', needle = process.argv[3] || 'PA-27-100';
const brief = JSON.parse(readFileSync('eval/briefs/jefe-igc-mint-ad-2026-10-12.json', 'utf8'));
const files = readdirSync(`${run}/pages`).filter((f) => f.endsWith('.txt')).map((f) => ({ f, t: readFileSync(`${run}/pages/${f}`, 'utf8') })).filter((x) => x.t.includes(needle));
console.log('páginas que contienen', JSON.stringify(needle), ':', files.map((x) => `${x.f.slice(0, 8)} (${x.t.length} car.)`).join(', '));
const env = { ...process.env, COMPILER_LLM_URL: 'http://127.0.0.1:8017/v1', COMPILER_LLM_MODEL: 'Qwen/Qwen3-30B-A3B-Instruct-2507', COMPILER_LLM_JSON_MODE: '1', COMPILER_LLM_SCHEMA_LOOSE: '1', COMPILER_LLM_MAX_TOKENS: '3000', COMPILER_LLM_TIMEOUT_MS: '90000' };
for (const x of files) {
  const p = assessPrompt({ objective: 'grant', brief, page: { url: 'https://example/' + x.f.slice(0, 8), title: x.t.split('\n')[0].slice(0, 120), text: x.t }, ref: 'p9', today: '2026-10-12' });
  const t = Date.now();
  try {
    const r = await chatJSON({ system: p.system, user: p.user, schema: p.schema, name: 'assess', role: 'compiler' }, { env });
    const v = validateAssess(r.json);
    console.log(`\n== ${x.f.slice(0, 8)} · ${Date.now() - t} ms · tokens`, JSON.stringify(r.usage), '· válido:', v.ok);
    if (!v.ok) console.log('ERRORES:', v.errors.slice(0, 12).join('\n  '));
    console.log('SALIDA:', JSON.stringify(r.json).slice(0, 1800));
  } catch (e) { console.log(`\n== ${x.f.slice(0, 8)} · ${Date.now() - t} ms · ERROR`, e.message); }
}
