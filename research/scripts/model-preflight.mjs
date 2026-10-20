// Preflight de rendimiento de modelos (P0.7). Una inferencia real de ~500 tokens con el esquema de lectura por endpoint;
// aborta (código ≠ 0) si los tokens/s caen por debajo del umbral. No usa buscadores ni Apollo.
// Uso:
//   node --env-file-if-exists=.env scripts/model-preflight.mjs [--endpoints "agent=http://127.0.0.1:8016/v1#openai/gpt-oss-120b,compiler=http://127.0.0.1:8017/v1#Qwen/Qwen3-30B-A3B-Instruct-2507"]
//        [--min-toks 80] [--metric decode|e2e] [--max-tokens 600] [--timeout-ms 90000] [--reasoning-effort low] [--out preflight.json]
// Sin --endpoints usa los roles agent, compiler y judge configurados (ENGINE_AGENT_LLM_*, COMPILER_LLM_*, JUDGE_LLM_*).
// Salida: 0 pasa · 2 endpoint caído, sin el modelo o error · 3 por debajo del umbral · 4 sin tokens medibles.
import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { preflightTargets, runPreflight } from '../server/research/agentic/preflight.mjs';

const argv = process.argv.slice(2);
const arg = (name, fallback = '') => { const at = argv.indexOf(name); return at >= 0 ? argv[at + 1] : fallback; };
const env = process.env; const out = arg('--out', '');
const opts = { minToks: Number(arg('--min-toks', env.PREFLIGHT_MIN_TOKS || '80')), metric: arg('--metric', env.PREFLIGHT_METRIC || 'decode'), maxTokens: Number(arg('--max-tokens', '600')) || 600,
  timeoutMs: Number(arg('--timeout-ms', '90000')) || 90_000, effort: arg('--reasoning-effort', 'low') };
const targets = preflightTargets(arg('--endpoints', ''), env);
if (!targets.length) { console.error('✖ No hay endpoints: pasa --endpoints o configura ENGINE_AGENT_LLM_*, COMPILER_LLM_* o JUDGE_LLM_*.'); process.exit(2); }
if (out && existsSync(resolve(out))) { console.error(`✖ ${out} ya existe; el preflight no sobrescribe resultados.`); process.exit(2); }
const { rows, code } = await runPreflight(targets, { ...opts, log: (line) => (line.startsWith('✖') ? console.error(line) : console.log(line)) });
if (out) writeFileSync(resolve(out), JSON.stringify({ v: 'model-preflight/1', at: new Date().toISOString(), ...opts, rows: rows.map(({ apiKey, ...r }) => r), exit_code: code }, null, 2));
if (code) console.error(code === 3 ? `✖ Rendimiento bajo el umbral (${opts.minToks} tok/s): no se crea ninguna corrida.` : '✖ Preflight fallido: no se crea ninguna corrida.');
process.exit(code);
