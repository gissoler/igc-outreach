// Backtest del Módulo 2. Corre desde tu Mac con la base de deals ya ingerida (scripts/deals.mjs ingest).
//   node --env-file-if-exists=.env scripts/backtest.mjs [--no-fleet] [--cutoff 2025-12-31] [--rounds ../backend/eval/backtest_rounds.json]
// --cutoff: subconjunto de rondas anunciadas después del corte de conocimiento del modelo de la línea base (el que decide).
// Lee (si existe) ../backend/eval/results/llm_baseline.json (scripts/baseline-llm.mjs).
// Escribe ../backend/eval/results/backtest_<fecha>.{json,md}.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createStore } from '../server/research/store.mjs';
import { loadVehicles } from '../server/analysis/momentum.mjs';
import { markdownReport, runBacktest } from '../server/analysis/backtest.mjs';
import { fleetConfig } from '../server/analysis/fleet.mjs';

const args = process.argv.slice(2);
const opt = (n, f = null) => { const i = args.indexOf(`--${n}`); return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : f; };
const roundsPath = resolve(opt('rounds', '../backend/eval/backtest_rounds.json'));
const data = JSON.parse(readFileSync(roundsPath, 'utf8'));
const rounds = data.rounds.filter((r) => r.include !== false);
const store = createStore(resolve(process.env.RESEARCH_DB || 'data/research.sqlite')).analysis;
const allDeals = store.deals();
const vehicles = loadVehicles(resolve(process.env.FUND_VEHICLES_PATH || 'data/fund_vehicles.json'));
const baselinePath = resolve('../backend/eval/results/llm_baseline.json');
const baselines = existsSync(baselinePath) ? { llm: JSON.parse(readFileSync(baselinePath, 'utf8')).rounds } : {};
const cfg = fleetConfig(process.env);
const model = cfg.roles.embed.model || 'lexico';
const cache = store.embeddings(model);
console.log(`${rounds.length} rondas · ${allDeals.length} deals en la base · ${vehicles.count} vehículos Form D · flota: ${opt('no-fleet') ? 'no' : cfg.roles.embed.ready ? 'sí' : 'no configurada'}`);
if (!allDeals.length) console.log('AVISO: la base de deals está vacía; corre primero scripts/deals.mjs ingest. Todas las métricas saldrán en 0.');
const res = await runBacktest(rounds, { allDeals, vehicles, env: process.env, useFleet: !opt('no-fleet'), baselines, cache, log: console.log, cutoff: opt('cutoff', null) });
for (const [id, v] of cache) store.saveEmbedding(id, model, v);
const stamp = new Date().toISOString().slice(0, 10);
mkdirSync(resolve('../backend/eval/results'), { recursive: true });
writeFileSync(resolve(`../backend/eval/results/backtest_${stamp}.json`), JSON.stringify({ at: new Date().toISOString(), rounds: roundsPath, ...res }, null, 2));
const md = `# Backtest ${stamp}\n\n${markdownReport(res)}\n`;
writeFileSync(resolve(`../backend/eval/results/backtest_${stamp}.md`), md);
console.log(`\n${md}`);
