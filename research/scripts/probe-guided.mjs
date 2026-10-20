// Sonda de decodificación guiada (20/10): ¿json_schema es lento por el esquema o por la decodificación guiada en sí?
// Solo envía peticiones normales a /chat/completions de UN endpoint. No toca el servidor, no usa buscadores ni Apollo.
// Uso (desde research/, con el túnel abierto):
//   node scripts/probe-guided.mjs --pipeline "<…>/Fuentes/Pipeline I+D Outreach - 2026-10-19" [--case RD-04] [--runs runs,runs-v2-qwen-assess-timeout]
//        [--endpoint "qwen=http://127.0.0.1:8017/v1#Qwen/Qwen3-30B-A3B-Instruct-2507"] [--repeat 2] [--max-tokens 400]
//        [--backends xgrammar,outlines] [--out eval/runs/probe-guided-<fecha>] [--dry]
// Orden de ejecución: ronda a ronda (todas las sondas, luego otra vez), para que un pico de carga no sesgue a una sola sonda.
// Salida: tabla en pantalla + calls.jsonl y results.json en un directorio NUEVO. Código 2 si el endpoint no responde.
import { mkdirSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { checkEndpoint, loadReplayCorpus, parseEndpoints, sampleCorpus } from '../server/research/agentic/replay.mjs';
import { probeSet, runProbe, summarizeProbes } from '../server/research/agentic/guidedProbe.mjs';

const argv = process.argv.slice(2);
const arg = (name, fallback = '') => { const at = argv.indexOf(name); return at >= 0 ? argv[at + 1] : fallback; };
const pipeline = arg('--pipeline', process.env.OUTREACH_PIPELINE_DIR || '');
if (!pipeline || !existsSync(pipeline)) { console.error('✖ Falta --pipeline <carpeta con runs/ y profiles/>.'); process.exit(2); }
const runs = arg('--runs', 'runs,runs-v2-qwen-assess-timeout').split(',').map((x) => x.trim()).filter(Boolean);
const [endpoint] = parseEndpoints(arg('--endpoint', 'qwen=http://127.0.0.1:8017/v1#Qwen/Qwen3-30B-A3B-Instruct-2507'));
const repeat = Math.max(1, Number(arg('--repeat', '2')) || 2); const maxTokens = Number(arg('--max-tokens', '400')) || 400;
const backends = arg('--backends', '').split(',').map((x) => x.trim()).filter(Boolean); const caseId = arg('--case', 'RD-04');
const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16); const outDir = resolve(arg('--out', join('eval/runs', `probe-guided-${stamp}`)));

const corpus = loadReplayCorpus(pipeline, { runs }).filter((p) => p.case === caseId); const page = sampleCorpus(corpus, 1)[0];
if (!page) { console.error(`✖ No hay páginas guardadas del caso ${caseId} en ${runs.join(', ')}.`); process.exit(2); }
const effort = /gpt-oss/i.test(endpoint.model) ? 'low' : '';
const probes = probeSet(page, { model: endpoint.model, maxTokens, reasoningEffort: effort, backends });
console.log(`Sonda guiada · ${endpoint.name}=${endpoint.url}#${endpoint.model} · página ${page.case} (${page.url})\n  ${probes.length} sondas × ${repeat} rondas = ${probes.length * repeat} llamadas, max_tokens ${maxTokens}`);
if (argv.includes('--dry')) { for (const p of probes) console.log(`  ${p.name}: ${p.note} · formato ${p.body.response_format?.type || 'ninguno'}${p.body.guided_decoding_backend ? ` · motor ${p.body.guided_decoding_backend}` : ''}`); console.log('Dry run: no se llamó a ningún modelo.'); process.exit(0); }
try { endpoint.model = await checkEndpoint(endpoint); } catch (error) { console.error(`✖ ${error.message}\n  No se ejecutó ninguna llamada.`); process.exit(2); }
if (existsSync(outDir)) { console.error(`✖ ${outDir} ya existe; elige otro --out.`); process.exit(2); }
mkdirSync(outDir, { recursive: true });
const rows = [];
for (let round = 1; round <= repeat; round++) for (const probe of probes) {
  const row = { round, ...(await runProbe(endpoint, probe, { timeoutMs: 120_000 })) }; rows.push(row); appendFileSync(join(outDir, 'calls.jsonl'), `${JSON.stringify(row)}\n`);
  console.log(`  [r${round}] ${probe.name.padEnd(30)} ${row.ok ? `${String(row.completion_tokens).padStart(4)} tok · ${String(row.tok_s_decode ?? '?').padStart(6)} tok/s · ttft ${row.ttft_ms} ms · ${row.finish_reason}` : `error: ${row.error}`}`);
}
const summary = summarizeProbes(rows);
console.log('\nSonda'.padEnd(32) + 'n  tokens  ttft p50  tok/s p50 (mín–máx)');
for (const s of summary) console.log(`${s.probe.padEnd(31)}${s.ok}/${s.n}  ${String(s.tokens_mean ?? '—').padStart(5)}  ${String(s.ttft_p50_ms ?? '—').padStart(7)}  ${String(s.tok_s_p50 ?? '—').padStart(8)} (${s.tok_s_min ?? '—'}–${s.tok_s_max ?? '—'})${s.error ? `  ← ${s.error}` : ''}`);
writeFileSync(join(outDir, 'results.json'), JSON.stringify({ v: 'probe-guided/1', at: new Date().toISOString(), endpoint: { ...endpoint, apiKey: undefined }, page: { case: page.case, url: page.url, sha256: page.sha256 }, repeat, max_tokens: maxTokens, backends, summary, calls: rows }, null, 2));
console.log(`\n✔ ${rows.length} llamadas. Resultados: ${join(outDir, 'results.json')}`);
