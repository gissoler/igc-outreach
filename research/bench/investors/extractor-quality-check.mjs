#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createBenchCache } from '../../agent/cache.mjs';
import { createFetchTool } from '../../agent/tools/fetch.mjs';
import { createInvestorLlm, createLiveInvestorDeps } from './external.mjs';
import { loadInvestorPrompt } from './prompts.mjs';

const repo = resolve(import.meta.dirname, '../../..');
const out = resolve(process.argv[2]);
const config = JSON.parse(readFileSync(resolve(repo, 'research/bench/investors/config/v2-2026-10-08.json'), 'utf8'));
const cache = createBenchCache({ path: resolve(out, '..', 'extractor-quality-v2.sqlite'), namespace: 'extractor-quality-v2' });
try {
  const url = 'https://deetkenimpact.com/';
  const fetch = createFetchTool({ env: process.env, cache });
  const llm = createInvestorLlm({ env: process.env, cache, family: config.agent_model.family });
  const deps = createLiveInvestorDeps({ search: { search: async () => ({ results: [] }) }, fetch, llm, plannerPrompt: loadInvestorPrompt('planner', config.prompts.planner), extractorPrompt: loadInvestorPrompt('extractor', config.prompts.extractor), config, seed: 101 });
  const page = await deps.fetch(url);
  if (page.ok === false) throw new Error(`Reader failed: ${page.error?.code || 'unknown'}`);
  const extracted = await deps.extract({ document: { url, title: page.title || url, text: page.text || '' }, today: config.today, firstSeen: { step: 0, search_index: 0, order: 0, query_id: 'q999' } });
  if (!extracted.entity) throw new Error(`Positive investor page rejected as ${extracted.rejected_kind || 'unknown'}`);
  writeFileSync(out, `${JSON.stringify({ schema_version: 'investor_extractor_quality/1', status: 'passed', fixture_excluded_from_gold: true, url, accepted: true, stable_id: extracted.entity.stable_id, canonical_name: extracted.entity.canonical_name, official_domain: extracted.entity.official_domain, quote: extracted.entity.sources[0].quote, reader: { via: page.via, text_chars: page.text.length }, contacts_or_messages_sent: 0 }, null, 2)}\n`);
} finally { cache.close(); }
