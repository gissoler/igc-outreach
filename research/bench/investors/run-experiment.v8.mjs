#!/usr/bin/env node
// Runner v8 = copia de run-experiment.v7.mjs (que no se edita) con el motor v8 (fase de listas, b2.list_discovery) y config investor_run_config/6.
// Todo lo demás es el runner v7. Solo condición B2 con el motor v8 (v7 + fase de listas):
//  · engine.v8.mjs (C3 salto de dominios que fallan, C5 mínimo de búsquedas antes de stop) y extractor.v7 (C2) vía external.v7.mjs;
//  · C6: el lote inicial del planner sale de config/<b2.fixed_initial_batch> (v5 B2 s101 del mismo caso), igual en las 3 réplicas;
//  · caché por capas (cache-layers.v7.mjs): escribe en <out>/cache.sqlite y lee en solo lectura las cachés v5/v6 de config.cache_layers;
//  · guardia de Exa: un error de saldo/autorización (401/402/403/429, credits, balance, quota…) o 3 errores seguidos de Exa crean
//    el --stop-file y cortan la corrida en curso (queda failure.json, sin result.json: se descarta), para no seguir con otros buscadores.
// Las semillas 101/202/303 son etiquetas de réplica: el proveedor del LLM no aplica la semilla como control (H1).
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createFetchTool } from '../../agent/tools/fetch.mjs';
import { abstentionReason } from './engine.mjs';
import { runInvestorDiscoveryV8 } from './engine.v8.mjs';
import { loadInvestorPrompt } from './prompts.mjs';
import { createInvestorLlm } from './external.mjs';
import { createLiveInvestorDepsV7 } from './external.v7.mjs';
import { createFailoverSearchTool } from './search-failover.mjs';
import { validateWorkspaceV8 } from './workspace.v8.mjs';
import { createLayeredCache } from './cache-layers.v7.mjs';

const arg = name => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? null : process.argv[i + 1]; };
const repo = resolve(import.meta.dirname, '../../..'), inv = import.meta.dirname;
const configPath = resolve(arg('config')), casesDir = resolve(arg('cases')), outDir = resolve(arg('out'));
const conditions = (arg('conditions') || 'B2').split(',');
if (conditions.some(c => c !== 'B2')) throw new Error('run-experiment.v8 solo corre la condición B2');
const maxRuns = Number(arg('max-runs') || Infinity), concurrency = Math.max(1, Number(arg('concurrency') || 1)), mode = arg('mode') || 'formal';
const config = JSON.parse(readFileSync(configPath, 'utf8'));
validateWorkspaceV8({ configPath, casesDir });
const stopFile = arg('stop-file') ? resolve(arg('stop-file')) : null;

const rand = seed => { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; };
const shuffle = (rows, seed) => { const r = rand(seed), out = [...rows]; for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; } return out; };
const onlyCases = arg('only-cases') ? arg('only-cases').split(',').map(x => x.trim()).filter(Boolean) : null;
const caseFiles = readdirSync(casesDir).filter(x => x.endsWith('.json') && x !== 'manifest.json').filter(x => !onlyCases || onlyCases.some(id => { const b = x.replace(/\.json$/, ''); return b === id || b === `inv-case-syn-${id}`; })).sort();
const seeds = arg('seeds') ? arg('seeds').split(',').map(Number) : config.seeds;
let jobs = caseFiles.flatMap(file => conditions.flatMap(condition => seeds.map(seed => ({ file, condition, seed }))));
jobs = shuffle(jobs, 20261008).slice(0, maxRuns);
const fixed = config.b2.fixed_initial_batch ? JSON.parse(readFileSync(resolve(inv, 'config', config.b2.fixed_initial_batch), 'utf8')) : null;
if (fixed) for (const j of jobs) { const id = j.file.replace(/\.json$/, ''); if (!fixed.cases[id]) throw new Error(`no hay lote inicial fijo para ${id}`); }
if (process.argv.includes('--dry-run')) {
  const rows = jobs.map(j => { const id = `${config.bench_id}__${j.file.replace(/\.json$/, '')}__${j.condition}__s${j.seed}`; return { run_id: id, reuse: existsSync(resolve(outDir, 'runs', id, 'result.json')), fixed_initial_from: fixed?.cases[j.file.replace(/\.json$/, '')]?.source_run_id ?? null }; });
  console.log(JSON.stringify({ dry_run: true, scheduled: rows.length, already_done: rows.filter(r => r.reuse).length, to_run: rows.filter(r => !r.reuse).length, runs: rows }));
  process.exit(0);
}
mkdirSync(resolve(outDir, 'runs'), { recursive: true });
const eventsPath = resolve(outDir, 'events.jsonl');
const append = row => appendFileSync(eventsPath, `${JSON.stringify({ timestamp: new Date().toISOString(), ...row })}\n`);

const cache = createLayeredCache({ primary: { path: resolve(outDir, 'cache.sqlite'), namespace: `investors-${config.bench_id}` }, readLayers: config.cache_layers.map(l => ({ path: resolve(inv, l.path), namespace: l.namespace })) });
const search = createFailoverSearchTool({ providers: config.search.providers, env: process.env, cache, resultsPerQuery: config.search.results_per_query, exaContentsChars: config.search.exa_contents_chars ?? null, exaType: config.search.exa_type ?? null, exaHighlights: config.search.exa_highlights === true });
const fetch = createFetchTool({ env: process.env, cache });
const llm = createInvestorLlm({ env: process.env, cache, family: config.agent_model.family });
const promptOpts = { manifest: config.prompts.manifest };
const templates = loadInvestorPrompt('b0_templates', config.prompts.b0_templates, promptOpts).templates;
const catalog = JSON.parse(readFileSync(resolve(repo, 'docs/contracts/investor/criteria_catalog.investor.v1.json'), 'utf8'));
const plannerPrompt = loadInvestorPrompt('planner', config.prompts.planner, promptOpts);
const extractorPrompt = loadInvestorPrompt('extractor', config.prompts.extractor, promptOpts);
const judgePrompt = loadInvestorPrompt('judge', config.prompts.judge, promptOpts);

// Guardia de Exa (patrón de exa-guard.sh, dentro del proceso).
const BALANCE = /\b40[123]\b|\b429\b|credit|balance|quota|insufficient|payment|billing|exceeded/i;
let exaConsecutiveErrors = 0;
class ExaGuardError extends Error { constructor(message) { super(message); this.code = 'EXA_GUARD'; } }
function exaGuard(value) {
  for (const a of value.attempts ?? []) {
    if (a.provider !== 'exa' || a.cached) continue;
    if (a.error) { exaConsecutiveErrors++; const m = String(a.error.message ?? ''); if (BALANCE.test(m)) return `Exa: ${m.slice(0, 160)}`; } else exaConsecutiveErrors = 0;
  }
  return exaConsecutiveErrors >= 3 ? 'Exa: 3 errores seguidos' : null;
}

function tracedDeps(base, { runId }) {
  return {
    async search(query, options) {
      if (stopFile && existsSync(stopFile) && guardTripped) throw new ExaGuardError('guardia de Exa activada en otra corrida');
      append({ event: 'search_start', run_id: runId, query });
      const { triage, ...searchOptions } = options ?? {};
      const value = await base.search(query, searchOptions);
      if (triage) value.triage = triage(value.results ?? []);
      append({ event: 'search_end', run_id: runId, query, results: value.results?.length || 0, urls: (value.results || []).map(x => x.url), provider: value.provider || null, attempts: value.attempts || [], searches_consumed: value.searches_consumed ?? 1, error: value.error || null, latency: value.latency || null, ...(searchOptions.includeDomains ? { include_domains: searchOptions.includeDomains } : {}), ...(triage ? { triage: value.triage } : {}) });
      const why = exaGuard(value);
      if (why) { guardTripped = true; if (stopFile) writeFileSync(stopFile, `${why}\n`); append({ event: 'exa_guard_stop', run_id: runId, reason: why }); throw new ExaGuardError(why); }
      return value;
    },
    async fetch(url) { append({ event: 'fetch_start', run_id: runId, url }); const value = await base.fetch(url); append({ event: 'fetch_end', run_id: runId, url, ok: value.ok !== false, via: value.via || 'unknown', text_chars: value.text?.length || 0, error: value.error || null, error_code: value.error?.code || null, cached: value.cached ?? null, reader_attempts: value.reader_attempts || null, latency: value.latency || null }); return value; },
    async plan(input) { append({ event: 'planner_start', run_id: runId, mode: input.mode }); const value = await base.plan(input); append({ event: 'planner_end', run_id: runId, mode: input.mode, queries: value.queries || [], stop: value.stop, fixed_initial_batch: value.fixed_initial_batch ?? null, latency: value.latency || null }); return value; },
    async extract(input) { const value = await base.extract(input); append({ event: 'extract_end', run_id: runId, url: input.document.url, accepted: Boolean(value.entity), rejected_kind: value.rejected_kind || null, ...(value.diagnostics || {}), latency: value.latency || null }); return value; },
    log(row) { append({ ...row, run_id: runId }); },
    async sectorFit(input) { const value = await base.sectorFit(input); append({ event: 'sector_fit_llm', run_id: runId, stable_id: input.entity.stable_id, sector_fit: value.sector_fit, guard: value.guard, raw: value.raw, latency: value.latency || null }); return value; }
  };
}
let guardTripped = false;

const manifest = new Array(jobs.length);
const writeManifest = () => writeFileSync(resolve(outDir, 'runs_manifest.json'), `${JSON.stringify({ schema_version: 'runs_manifest/1', expected_runs: caseFiles.length * conditions.length * seeds.length, scheduled_runs: jobs.length, order_seed: 20261008, concurrency, conditions, seeds, runs: manifest.filter(Boolean).sort((a, b) => a.ordinal - b.ordinal) }, null, 2)}\n`);
try {
  async function runJob(job, ordinal) {
    const caseObj = JSON.parse(readFileSync(resolve(casesDir, job.file), 'utf8'));
    const profile = JSON.parse(readFileSync(resolve(repo, caseObj.profile_path), 'utf8'));
    const runId = `${config.bench_id}__${caseObj.case_id}__${job.condition}__s${job.seed}`;
    const runDir = resolve(outDir, 'runs', runId), resultPath = resolve(runDir, 'result.json');
    if (existsSync(resultPath)) { manifest[ordinal - 1] = { run_id: runId, status: 'reused', ordinal, result_path: resultPath }; writeManifest(); return; }
    mkdirSync(runDir, { recursive: true });
    append({ event: 'run_start', run_id: runId, ordinal, mode, case_id: caseObj.case_id, condition: job.condition, seed: job.seed, capital_strategy_context: false });
    const live = createLiveInvestorDepsV7({ search, fetch, llm, plannerPrompt, extractorPrompt, judgePrompt, config, seed: job.seed });
    const fixedCase = fixed?.cases[caseObj.case_id] ?? null;
    // C6: la primera llamada (initial_batch) devuelve la salida congelada de v5 B2 s101 sin llamar al LLM.
    const base = fixedCase ? { ...live, async plan(input) { if (input.mode !== 'initial_batch') return live.plan(input); return { ...structuredClone(fixedCase.output), tokens_nominal: fixedCase.tokens_nominal, latency: { actual_ms: 0, nominal_ms: fixedCase.latency_ms }, fixed_initial_batch: fixedCase.source_run_id }; } } : live;
    const deps = tracedDeps(base, { runId });
    try {
      const result = await runInvestorDiscoveryV8({ caseObj, profile, condition: 'B2', config, templates, catalog, deps });
      const output = { ...result, condition: job.condition, seed: job.seed, run_id: runId, replicate_label: `s${job.seed}`, fixed_initial_batch: fixedCase?.source_run_id ?? null, ablation: null, capital_strategy_context: false, apollo: { calls: 0, credits_estimated: 0 } };
      writeFileSync(resultPath, `${JSON.stringify(output, null, 2)}\n`);
      manifest[ordinal - 1] = { run_id: runId, status: 'valid', ordinal, stop_reason: output.stop_reason, result_path: resultPath };
      append({ event: 'run_end', run_id: runId, status: 'valid', stop_reason: output.stop_reason, abstention_reason: output.abstention_reason ?? abstentionReason(output.ranked, output.judgments), totals: output.totals });
    } catch (error) {
      const failure = { run_id: runId, status: 'failed', ordinal, error: { name: error.name, code: error.code || null, message: error.message } };
      writeFileSync(resolve(runDir, 'failure.json'), `${JSON.stringify(failure, null, 2)}\n`);
      manifest[ordinal - 1] = failure; append({ event: 'run_end', ...failure });
    }
    writeManifest();
  }
  let next = 0;
  const worker = async () => { while (true) { const index = next++; if (index >= jobs.length) return; if (stopFile && existsSync(stopFile)) { append({ event: 'run_skipped', reason: guardTripped ? 'exa_guard' : 'spend_cap', ordinal: index + 1 }); continue; } await runJob(jobs[index], index + 1); } };
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
} finally { append({ event: 'cache_layers', own_hits: cache.stats.own_hits, layer_hits: cache.stats.layer_hits, misses: cache.stats.misses }); cache.close(); }

console.log(JSON.stringify({ mode, scheduled: jobs.length, concurrency, skipped_by_cap: jobs.length - manifest.filter(Boolean).length, valid: manifest.filter(x => x && ['valid', 'reused'].includes(x.status)).length, failed: manifest.filter(x => x?.status === 'failed').length, exa_guard: guardTripped }));
process.exit(guardTripped ? 3 : 0);
