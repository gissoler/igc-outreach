// Banco de reproducción offline de la lectura estructurada (P0.1). No usa buscadores ni Apollo: solo los endpoints de modelo.
// Uso:
//   node scripts/replay-assess.mjs --pipeline "<…>/Fuentes/Pipeline I+D Outreach - 2026-10-19" \
//     [--runs runs,runs-v2-qwen-assess-timeout] [--pages 6] [--variants full,full+mt700,lite,lite+mt700,json,json+mt700] \
//     [--endpoints "gpt-oss=http://127.0.0.1:8016/v1#openai/gpt-oss-120b,qwen=http://127.0.0.1:8017/v1#Qwen/Qwen3-30B-A3B-Instruct-2507"] \
//     [--reasoning-effort low] [--concurrency 1] [--timeout-ms 120000] [--no-stream] [--out eval/runs/replay-assess-<fecha>] [--dry]
// Escribe en un directorio NUEVO (falla si ya existe): calls.jsonl (una línea por llamada, a medida que terminan),
// results.json (meta + llamadas + resumen) y summary.md. Si un endpoint no responde, termina con código 2 sin escribir nada.
import { mkdirSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { REPLAY_VARIANTS, buildReplayRequest, checkEndpoint, loadReplayCorpus, measureOnce, parseEndpoints, sampleCorpus, summarizeReplay } from '../server/research/agentic/replay.mjs';

const argv = process.argv.slice(2);
const arg = (name, fallback = '') => { const at = argv.indexOf(name); return at >= 0 ? argv[at + 1] : fallback; };
const flag = (name) => argv.includes(name);
const pipeline = arg('--pipeline', process.env.OUTREACH_PIPELINE_DIR || '');
if (!pipeline || !existsSync(pipeline)) { console.error('✖ Falta --pipeline <carpeta con runs/ y profiles/> (o OUTREACH_PIPELINE_DIR).'); process.exit(2); }
const runs = arg('--runs', 'runs').split(',').map((x) => x.trim()).filter(Boolean);
const variants = arg('--variants', Object.keys(REPLAY_VARIANTS).join(',')).split(',').map((x) => x.trim()).filter(Boolean);
for (const v of variants) if (!REPLAY_VARIANTS[v]) { console.error(`✖ Variante desconocida: ${v}. Válidas: ${Object.keys(REPLAY_VARIANTS).join(', ')}`); process.exit(2); }
const endpoints = parseEndpoints(arg('--endpoints', 'gpt-oss=http://127.0.0.1:8016/v1#openai/gpt-oss-120b,qwen=http://127.0.0.1:8017/v1#Qwen/Qwen3-30B-A3B-Instruct-2507'));
const nPages = Number(arg('--pages', '6')) || 6; const concurrency = Math.max(1, Number(arg('--concurrency', '1')) || 1);
const timeoutMs = Number(arg('--timeout-ms', '120000')) || 120_000; const stream = !flag('--no-stream'); const effort = arg('--reasoning-effort', 'low');
const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
const outDir = resolve(arg('--out', join('eval/runs', `replay-assess-${stamp}`)));

const corpus = loadReplayCorpus(pipeline, { runs }); const sample = sampleCorpus(corpus, nPages);
if (!sample.length) { console.error(`✖ No hay páginas guardadas en ${runs.map((r) => join(pipeline, r)).join(', ')}.`); process.exit(2); }
const plan = endpoints.flatMap((endpoint) => variants.flatMap((variant) => sample.map((page) => ({ endpoint, variant, page }))));
console.log(`Banco assess · ${corpus.length} páginas guardadas, muestra ${sample.length} (${[...new Set(sample.map((p) => p.case))].join(', ')})\n  variantes: ${variants.join(', ')}\n  endpoints: ${endpoints.map((e) => `${e.name}=${e.url}#${e.model}`).join(', ')}\n  llamadas previstas: ${plan.length} · concurrencia ${concurrency} · streaming ${stream ? 'sí' : 'no'}`);

if (flag('--dry')) {
  for (const v of variants) { const req = buildReplayRequest(sample[0], v, { model: endpoints[0]?.model || 'model', reasoningEffort: effort }); console.log(`  ${v}: prompt ≈ ${Math.round(req.prompt_chars / 4)} tokens (${req.prompt_chars} caracteres), formato ${req.format}, max_tokens ${req.maxTokens || '—'}, contrato ${req.contract}`); }
  console.log('Dry run: no se llamó a ningún modelo ni se escribió nada.'); process.exit(0);
}

// Comprobación previa: todos los endpoints deben responder y servir el modelo pedido. Sin esto no se mide nada.
for (const e of endpoints) {
  try { e.model = await checkEndpoint(e); }
  catch (error) { console.error(`✖ ${error.message}\n  No se ejecutó ninguna llamada ni se escribieron resultados. Abre el túnel a g355 (8016/8017) y vuelve a correr.`); process.exit(2); }
}
if (existsSync(outDir)) { console.error(`✖ ${outDir} ya existe; elige otro --out (nunca se sobrescriben resultados).`); process.exit(2); }
mkdirSync(outDir, { recursive: true });

const calls = []; let i = 0; const started = new Date().toISOString();
await Promise.all(Array.from({ length: concurrency }, async () => {
  while (i < plan.length) {
    const job = plan[i++];
    const row = await measureOnce(job.endpoint, job.page, job.variant, { timeoutMs, stream, reasoningEffort: /gpt-oss/i.test(job.endpoint.model) ? effort : '' });
    calls.push(row); appendFileSync(join(outDir, 'calls.jsonl'), `${JSON.stringify(row)}\n`);
    console.log(`  [${calls.length}/${plan.length}] ${row.endpoint} ${row.variant} ${row.case} ${row.ok ? `${row.total_ms} ms · ${row.completion_tokens ?? '?'} tok · ${row.tok_s_decode ?? row.tok_s_e2e ?? '?'} tok/s · json ${row.json_ok ? 'ok' : 'no'} · contrato ${row.contract_ok ? 'ok' : 'no'}` : `error: ${row.error}`}`);
  }
}));
const summary = summarizeReplay(calls);
const meta = { started, finished: new Date().toISOString(), pipeline, runs, pages_available: corpus.length, pages_sampled: sample.map((p) => ({ case: p.case, run: p.run, sha256: p.sha256, url: p.url })),
  endpoints: endpoints.map(({ apiKey, ...e }) => e), variants, concurrency, stream, timeout_ms: timeoutMs, reasoning_effort_gpt_oss: effort, calls_made: calls.length, external_search_calls: 0, apollo_calls: 0 };
writeFileSync(join(outDir, 'results.json'), JSON.stringify({ v: 'replay-assess/1', meta, summary, calls }, null, 2));
const md = ['# Banco de reproducción · lectura assess', '', `- ${meta.started} → ${meta.finished} · ${calls.length} llamadas a modelo, 0 búsquedas externas, 0 Apollo`, `- Páginas: ${sample.length} de ${corpus.length} guardadas (${runs.join(', ')}) · concurrencia ${concurrency} · streaming ${stream ? 'sí' : 'no'}`, '',
  '| Endpoint | Variante | n | OK | JSON válido | Contrato válido | Cortadas (length) | p50 ms | p95 ms | TTFT p50 ms | tok entrada (media) | tok salida (media) | tok/s decode p50 | tok/s e2e p50 |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  ...summary.map((s) => `| ${s.endpoint} | ${s.variant} | ${s.n} | ${s.ok} | ${s.json_ok} | ${s.contract_ok} | ${s.truncated} | ${s.latency_p50_ms ?? '—'} | ${s.latency_p95_ms ?? '—'} | ${s.ttft_p50_ms ?? '—'} | ${s.prompt_tokens_mean ?? '—'} | ${s.completion_tokens_mean ?? '—'} | ${s.tok_s_decode_p50 ?? '—'} | ${s.tok_s_e2e_p50 ?? '—'} |`),
  '', 'tok/s decode = tokens de salida / (último − primer fragmento); e2e = tokens de salida / latencia total. En gpt-oss los tokens de salida incluyen razonamiento.'];
writeFileSync(join(outDir, 'summary.md'), md.join('\n'));
console.log(`✔ ${calls.length} llamadas. Resultados: ${join(outDir, 'results.json')}`);
