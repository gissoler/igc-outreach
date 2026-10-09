#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createBenchCache } from '../../agent/cache.mjs';
import { createSearchTool } from '../../agent/tools/search.mjs';
import { createFetchTool } from '../../agent/tools/fetch.mjs';
import { ApolloBudget, ApolloCache, createApolloClient } from '../../capital/apollo.mjs';
import { createInvestorLlm, createLiveInvestorDeps } from './external.mjs';
import { loadInvestorPrompt } from './prompts.mjs';
import { judgeInvestor } from './judge.mjs';
import { rankInvestors } from './ranking.mjs';

const repo = resolve(import.meta.dirname, '../../..');
const out = resolve(process.argv[2]);
const config = JSON.parse(readFileSync(resolve(repo, 'research/bench/investors/config/v1-2026-10-08.json'), 'utf8'));
const profile = JSON.parse(readFileSync(resolve(repo, 'research/bench/investors/cases/profiles/smoke-inv-case-syn-n05.json'), 'utf8'));
const catalog = JSON.parse(readFileSync(resolve(repo, 'docs/contracts/investor/criteria_catalog.investor.v1.json'), 'utf8'));
const cache = createBenchCache({ path: resolve(out, '..', 'preflight-cache.sqlite'), namespace: 'investor-preflight-chain' });
try {
  const search = createSearchTool({ provider: 'searxng', env: process.env, cache, resultsPerQuery: 10 });
  const fetch = createFetchTool({ env: process.env, cache });
  const llm = createInvestorLlm({ env: process.env, cache, family: config.agent_model.family });
  const basePrompt = loadInvestorPrompt('planner', config.prompts.planner);
  const plannerPrompt = { ...basePrompt, user: `${basePrompt.user}\n\nTechnical fixture state: Sequoia Capital is a partially identified organization that must be resolved by official domain. For this B3 preflight, emit exactly one query as APOLLO_ORG: sequoiacap.com | reason=resolve partially identified organization by official domain.` };
  const deps = createLiveInvestorDeps({ search, fetch, llm, plannerPrompt, extractorPrompt: loadInvestorPrompt('extractor', config.prompts.extractor), config, seed: 101 });
  const started = Date.now();
  const plan = await deps.plan({ mode: 'adaptive_step', profile, state: { queries: [], entities: [{ stable_id: 'inv:domain:sequoiacap.com', sectors: [], stages: [], geographies: [] }] }, limit: 1 });
  const action = plan.queries.find(x => /^APOLLO_ORG:/i.test(x));
  if (!action) throw new Error('Planner did not select Apollo Organization Search for the technical fixture.');
  const reason = action.match(/\|\s*reason\s*=\s*(.+)$/i)?.[1]?.trim() || null;
  const client = createApolloClient({ apiKey: process.env.APOLLO_API_KEY, cache: new ApolloCache(), budget: new ApolloBudget({ perRun: 2, perOrganization: 2, perDay: 90, dailyLedger: new Map() }) });
  const org = await client.organizationSearch({ domain: 'sequoiacap.com', perPage: 1 });
  const row = (org.data?.organizations || org.data?.accounts || [])[0];
  const rawUrl = row?.website_url || row?.website || (row?.primary_domain ? `https://${row.primary_domain}/` : 'https://www.sequoiacap.com/');
  const normalized = new URL(rawUrl); normalized.protocol = 'https:'; const url = normalized.toString();
  const page = await deps.fetch(url);
  if (page.ok === false || !page.text || page.text.length < 200) throw new Error('Reader did not return sufficient public text for the Apollo organization result.');
  const extracted = await deps.extract({ document: { url, title: page.title || row?.name || 'Apollo', text: page.text || '' }, today: config.today, firstSeen: { step: 1, search_index: 0, order: 0, query_id: 'q000' } });
  if (!extracted.entity) throw new Error(`Extractor rejected Apollo result as ${extracted.rejected_kind || 'unknown'}.`);
  const judgment = judgeInvestor({ entity: extracted.entity, profile, catalog });
  const ranked = rankInvestors([extracted.entity], [judgment]);
  writeFileSync(out, `${JSON.stringify({ schema_version: 'investor_chain_preflight/1', status: 'passed', fixture_excluded_from_gold: true, profile_id: profile.profile_id, planner: { selected_tool: 'apollo_organization_search', query: action, reason }, apollo: { calls: client.stats.calls, credits_estimated: client.stats.creditsEstimated, records: row ? 1 : 0, latency_ms: org.latencyMs }, reader: { ok: page.ok !== false, title: page.title || null, text_chars: page.text?.length || 0, via: page.via || null, latency: page.latency || null }, extractor: { accepted: true, stable_id: extracted.entity.stable_id }, judge: { hard_eligibility: judgment.hard_eligibility, overall_relevance: judgment.overall_relevance }, ranking: ranked, latency_ms: Date.now() - started, capital_strategy_context: false, contacts_or_messages_sent: 0 }, null, 2)}\n`);
} finally { cache.close(); }
