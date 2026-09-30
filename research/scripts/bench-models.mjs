// Compara los modelos de la flota (y opcionalmente uno de referencia) en planear, leer y juzgar búsquedas.
// Uso (desde research/, en la máquina que llega a la flota):
//   node --env-file-if-exists=.env scripts/bench-models.mjs
//   node --env-file-if-exists=.env scripts/bench-models.mjs --ports 8000,8001,8002 --live
// Referencia opcional (cualquier endpoint compatible con OpenAI):
//   BENCH_REF_URL=https://openrouter.ai/api/v1 BENCH_REF_MODEL=<id> BENCH_REF_KEY=<key> node ... scripts/bench-models.mjs
// --live gasta créditos de Firecrawl: corre hasta 12 consultas del plan de cada modelo y mide si aparecen
// los sitios oficiales de las oportunidades verificadas (Solve, One Mind, EIC, NSF/NIH SBIR, Future of Health).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { benchModel, summaryTable } from '../eval/benchModels.mjs';
import { firecrawlSearch } from '../server/research/webscrape.mjs';

const arg = (name, fallback = '') => { const at = process.argv.indexOf(name); return at >= 0 ? process.argv[at + 1] : fallback; };
const env = process.env;
const gold = JSON.parse(readFileSync(resolve('eval/bench/mentiva-gold.json'), 'utf8'));
const { pages } = JSON.parse(readFileSync(resolve('eval/bench/mentiva-pages.json'), 'utf8'));
const host = arg('--host', env.VLLM_BASE || (env.INTAKE_LLM_BASE_URL ? new URL(env.INTAKE_LLM_BASE_URL).origin.replace(/:\d+$/, '') : ''));
const ports = arg('--ports', '8000,8001,8002').split(',').map((p) => p.trim()).filter(Boolean);
const only = arg('--only', '');

const models = [];
for (const port of ports) {
  const url = `${host}:${port}/v1`;
  try {
    const r = await fetch(`${url}/models`, { headers: env.VLLM_API_KEY ? { Authorization: `Bearer ${env.VLLM_API_KEY}` } : {}, signal: AbortSignal.timeout(10_000) });
    const ids = ((await r.json())?.data || []).map((m) => m.id);
    if (!ids.length) { console.error(`:${port} sin modelos`); continue; }
    const id = ids[0];
    const reasoning = /deepseek|r1|reason/i.test(id);
    models.push({ name: `${id.split('/').pop()} (:${port})`, url, model: id, apiKey: env.VLLM_API_KEY || '', noThink: /qwen3/i.test(id) && !/instruct-2507/i.test(id), maxTokens: reasoning ? 8000 : 4000 });
  } catch (error) { console.error(`:${port} no responde (${error.message})`); }
}
if (env.BENCH_REF_URL && env.BENCH_REF_MODEL) models.push({ name: `ref · ${env.BENCH_REF_MODEL}`, url: env.BENCH_REF_URL, model: env.BENCH_REF_MODEL, apiKey: env.BENCH_REF_KEY || '', maxTokens: 6000 });
const selected = only ? models.filter((m) => m.name.includes(only)) : models;
if (!selected.length) { console.error('No hay modelos que probar. Revisa --host/--ports o VLLM_BASE.'); process.exit(1); }

const search = process.argv.includes('--live') ? async (q) => (await firecrawlSearch(q, { limit: 5, env })).map((r) => r.url) : null;
const rows = [];
for (const model of selected) {
  console.error(`→ ${model.name}`);
  rows.push(await benchModel(model, { gold, pages, search }));
}
const table = summaryTable(rows);
console.log(table);
mkdirSync(resolve('eval/results'), { recursive: true });
const file = resolve(`eval/results/bench-models-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`);
writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), host, rows }, null, 2));
console.error(`Detalle por página y por campo: ${file}`);
