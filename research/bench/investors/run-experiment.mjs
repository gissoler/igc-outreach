#!/usr/bin/env node
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createBenchCache } from '../../agent/cache.mjs';
import { createSearchTool } from '../../agent/tools/search.mjs';
import { createFetchTool } from '../../agent/tools/fetch.mjs';
import { createApolloClient, ApolloBudget, ApolloCache } from '../../capital/apollo.mjs';
import { abstentionReason, runInvestorDiscovery } from './engine.mjs';
import { loadInvestorPrompt } from './prompts.mjs';
import { createInvestorLlm, createLiveInvestorDeps } from './external.mjs';
import { createFailoverSearchTool } from './search-failover.mjs';
import { validateInvestorWorkspace } from './cli.mjs';

const arg = name => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? null : process.argv[i + 1]; };
const repo = resolve(import.meta.dirname, '../../..');
const configPath = resolve(arg('config'));
const casesDir = resolve(arg('cases'));
const outDir = resolve(arg('out'));
const conditions = (arg('conditions') || 'B0,B1,B2,B3').split(',');
const maxRuns = Number(arg('max-runs') || Infinity);
const concurrency = Math.max(1, Number(arg('concurrency') || 1));
const mode = arg('mode') || 'formal';
const config = JSON.parse(readFileSync(configPath, 'utf8'));
validateInvestorWorkspace({ configPath, casesDir });
mkdirSync(resolve(outDir, 'runs'), { recursive: true });
const eventsPath = resolve(outDir, 'events.jsonl');
const append = row => appendFileSync(eventsPath, `${JSON.stringify({ timestamp: new Date().toISOString(), ...row })}\n`);

const rand = seed => { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; };
const shuffle = (rows, seed) => { const r = rand(seed), out = [...rows]; for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; } return out; };
const caseFiles = readdirSync(casesDir).filter(x => x.endsWith('.json') && x !== 'manifest.json').sort();
const seeds = arg('seeds') ? arg('seeds').split(',').map(Number) : config.seeds;
let jobs = caseFiles.flatMap(file => conditions.flatMap(condition => seeds.map(seed => ({ file, condition, seed }))));
jobs = shuffle(jobs, 20261008).slice(0, maxRuns);

const cache = createBenchCache({ path: resolve(outDir, 'cache.sqlite'), namespace: `investors-${config.bench_id}` });
const search = config.search.provider === 'failover'
  ? createFailoverSearchTool({ providers: config.search.providers, env: process.env, cache, resultsPerQuery: config.search.results_per_query, exaContentsChars: config.search.exa_contents_chars ?? null })
  : createSearchTool({ provider: config.search.provider, env: process.env, cache, resultsPerQuery: config.search.results_per_query });
const fetch = createFetchTool({ env: process.env, cache });
const llm = createInvestorLlm({ env: process.env, cache, family: config.agent_model.family });
const promptOpts = config.prompts.manifest ? { manifest: config.prompts.manifest } : {};
const templates = loadInvestorPrompt('b0_templates', config.prompts.b0_templates, promptOpts).templates;
const catalog = JSON.parse(readFileSync(resolve(repo, 'docs/contracts/investor/criteria_catalog.investor.v1.json'), 'utf8'));
const plannerPrompt = loadInvestorPrompt('planner', config.prompts.planner, promptOpts);
const extractorPrompt = loadInvestorPrompt('extractor', config.prompts.extractor, promptOpts);
const judgePrompt = (config.engine_v ?? 1) >= 2 ? loadInvestorPrompt('judge', config.prompts.judge, promptOpts) : null;
const globalApolloLedger = new Map();
const apolloCache = new ApolloCache({ ttlMs: 24 * 3600_000 });

function apolloRows(response) {
  return (response?.data?.organizations || response?.data?.accounts || []).flatMap((row, index) => {
    const url = row.website_url || row.website || (row.primary_domain ? `https://${row.primary_domain}/` : null);
    return url ? [{ rank: index + 1, url, title: row.name || row.primary_domain || url, snippet: 'Apollo Organization Search identity result.' }] : [];
  });
}

function tracedDeps(base, { runId, condition, apollo }) {
  return {
    async search(query, options) {
      if (condition === 'B3' && /^APOLLO_ORG:/i.test(query)) {
        const text = query.replace(/^APOLLO_ORG:/i, '').split('|')[0].trim();
        const isDomain = /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(text);
        append({ event: 'apollo_search_start', run_id: runId, query, reason: query.split('|reason=')[1]?.trim() || 'planner_requested' });
        try {
          const response = await apollo.organizationSearch(isDomain ? { domain: text, perPage: 10 } : { name: text, perPage: 10 });
          const rows = apolloRows(response);
          append({ event: 'apollo_search_end', run_id: runId, records: rows.length, latency_ms: response.latencyMs, credits_estimated: 1 });
          return { results: rows, nominal_cost: 1, searches_consumed: 1, latency: { actual_ms: response.latencyMs, nominal_ms: response.latencyMs }, apollo: true };
        } catch (error) {
          if (!error.budget) throw error;
          append({ event: 'apollo_search_rejected', run_id: runId, query, reason: error.code, message: error.message, credits_estimated: 0 });
          return { results: [], nominal_cost: 0, searches_consumed: 1, latency: { actual_ms: 0, nominal_ms: 0 }, apollo: true, error: { code: error.code, message: error.message } };
        }
      }
      append({ event: 'search_start', run_id: runId, query });
      const value = await base.search(query, options);
      append({ event: 'search_end', run_id: runId, query, results: value.results?.length || 0, urls: (value.results || []).map(x => x.url), provider: value.provider || null, attempts: value.attempts || [], searches_consumed: value.searches_consumed ?? 1, error: value.error || null, latency: value.latency || null });
      return value;
    },
    async fetch(url) { append({ event: 'fetch_start', run_id: runId, url }); const value = await base.fetch(url); append({ event: 'fetch_end', run_id: runId, url, ok: value.ok !== false, via: value.via || 'unknown', text_chars: value.text?.length || 0, error: value.error || null, error_code: value.error?.code || null, cached: value.cached ?? null, reader_attempts: value.reader_attempts || null, latency: value.latency || null }); return value; },
    async plan(input) { append({ event: 'planner_start', run_id: runId, mode: input.mode }); const value = await base.plan(input); append({ event: 'planner_end', run_id: runId, mode: input.mode, queries: value.queries || [], stop: value.stop, latency: value.latency || null }); return value; },
    async extract(input) { const value = await base.extract(input); append({ event: 'extract_end', run_id: runId, url: input.document.url, accepted: Boolean(value.entity), rejected_kind: value.rejected_kind || null, ...(value.diagnostics || {}), latency: value.latency || null }); return value; },
    log(row) { append({ ...row, run_id: runId }); },
    ...(base.sectorFit ? { async sectorFit(input) { const value = await base.sectorFit(input); append({ event: 'sector_fit_llm', run_id: runId, stable_id: input.entity.stable_id, sector_fit: value.sector_fit, guard: value.guard, raw: value.raw, latency: value.latency || null }); return value; } } : {}),
  };
}

const manifest = new Array(jobs.length);
const writeManifest = () => writeFileSync(resolve(outDir, 'runs_manifest.json'), `${JSON.stringify({ schema_version: 'runs_manifest/1', expected_runs: caseFiles.length * conditions.length * seeds.length, scheduled_runs: jobs.length, order_seed: 20261008, concurrency, conditions, seeds, runs: manifest.filter(Boolean).sort((a, b) => a.ordinal - b.ordinal) }, null, 2)}\n`);
try {
  async function runJob(job, ordinal) {
    const caseObj = JSON.parse(readFileSync(resolve(casesDir, job.file), 'utf8'));
    const profile = JSON.parse(readFileSync(resolve(repo, caseObj.profile_path), 'utf8'));
    const runId = `${config.bench_id}__${caseObj.case_id}__${job.condition}__s${job.seed}`;
    const runDir = resolve(outDir, 'runs', runId);
    const resultPath = resolve(runDir, 'result.json');
    if (existsSync(resultPath)) { manifest[ordinal - 1] = { run_id: runId, status: 'reused', ordinal, result_path: resultPath }; writeManifest(); return; }
    mkdirSync(runDir, { recursive: true });
    append({ event: 'run_start', run_id: runId, ordinal, mode, case_id: caseObj.case_id, condition: job.condition, seed: job.seed, capital_strategy_context: false });
    const b3Prompt = job.condition === 'B3' ? { ...plannerPrompt, user: `${plannerPrompt.user}\n\nAdditional read-only tool for this ablation only: emit a query exactly as APOLLO_ORG: <official-domain-or-organization-name> | reason=<brief reason> only to resolve a partially found organization, search by domain, cover an institutional gap, or check a firm suggested by other evidence. Maximum two. Do not use people, contacts, email or warm paths.` } : plannerPrompt;
    const base = createLiveInvestorDeps({ search, fetch, llm, plannerPrompt: b3Prompt, extractorPrompt, judgePrompt, config, seed: job.seed });
    const apollo = job.condition === 'B3' ? createApolloClient({ apiKey: process.env.APOLLO_API_KEY, cache: apolloCache, budget: new ApolloBudget({ perRun: 2, perOrganization: 2, perDay: 90, dailyLedger: globalApolloLedger }) }) : null;
    const deps = tracedDeps(base, { runId, condition: job.condition, apollo });
    try {
      const coreCondition = job.condition === 'B3' ? 'B2' : job.condition;
      const result = await runInvestorDiscovery({ caseObj, profile, condition: coreCondition, config, templates, catalog, deps });
      const output = { ...result, condition: job.condition, seed: job.seed, run_id: runId, ablation: job.condition === 'B3' ? 'incremental_tool_ablation' : null, capital_strategy_context: false, apollo: job.condition === 'B3' ? { calls: apollo.stats.calls, credits_estimated: apollo.stats.creditsEstimated, max_calls_per_run: 2 } : { calls: 0, credits_estimated: 0 } };
      writeFileSync(resultPath, `${JSON.stringify(output, null, 2)}\n`);
      manifest[ordinal - 1] = { run_id: runId, status: 'valid', ordinal, stop_reason: output.stop_reason, apollo_calls: output.apollo.calls, result_path: resultPath };
      append({ event: 'run_end', run_id: runId, status: 'valid', stop_reason: output.stop_reason, abstention_reason: output.abstention_reason ?? abstentionReason(output.ranked, output.judgments), totals: output.totals, apollo: output.apollo });
    } catch (error) {
      const failure = { run_id: runId, status: 'failed', ordinal, error: { name: error.name, code: error.code || null, message: error.message } };
      writeFileSync(resolve(runDir, 'failure.json'), `${JSON.stringify(failure, null, 2)}\n`);
      manifest[ordinal - 1] = failure; append({ event: 'run_end', ...failure });
    }
    writeManifest();
  }
  let next = 0;
  const worker = async () => { while (true) { const index = next++; if (index >= jobs.length) return; await runJob(jobs[index], index + 1); } };
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
} finally { cache.close(); }

console.log(JSON.stringify({ mode, scheduled: jobs.length, concurrency, valid: manifest.filter(x => x && ['valid','reused'].includes(x.status)).length, failed: manifest.filter(x => x?.status === 'failed').length }));
