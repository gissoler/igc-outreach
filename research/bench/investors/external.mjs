import { createHash } from 'node:crypto';
import { fleetTransport } from '../../agent/llm.mjs';
import { render, sanitizePageText } from '../../agent/prompts.mjs';
import { parseJsonContent } from '../../server/analysis/fleet.mjs';
import { bundleInvestor, validateInvestor } from './contracts.mjs';
import { extractFixtureInvestor } from './extractor.mjs';

const sha = value => createHash('sha256').update(String(value)).digest('hex');
export function createInvestorLlm({ env = process.env, role = 'engine', cache, family, transport }) {
  const tx = transport ?? fleetTransport(env, role);
  return { family, async call({ prompt, user, schemaName, temperature = 0, seed = 0, maxTokens = 4000 }) {
    const key = sha([prompt.sha256, sha(user), schemaName, temperature, seed].join('|')), hit = cache?.get('llm', key);
    if (hit) return { json: hit.value.json, tokens_nominal: hit.meta.tokens, latency: { actual_ms: 0, nominal_ms: hit.meta.latency_ms } };
    const body = { messages: [{ role: 'system', content: prompt.system }, { role: 'user', content: user }], temperature, seed, max_tokens: maxTokens, response_format: { type: 'json_schema', json_schema: { name: schemaName, schema: bundleInvestor(schemaName) } } };
    const response = await tx({ body, meta: { benchmark: 'investors' } }), parsed = parseJsonContent(response.content); validateInvestor(schemaName, parsed);
    const tokens = Number(response.usage?.prompt_tokens ?? 0) + Number(response.usage?.completion_tokens ?? 0), latency = Number(response.latency_ms ?? 0); cache?.put('llm', key, { json: parsed }, { tokens, latency_ms: latency });
    return { json: parsed, tokens_nominal: tokens, latency: { actual_ms: latency, nominal_ms: latency } };
  } };
}

export function createLiveInvestorDeps({ search, fetch, llm, plannerPrompt, extractorPrompt, config, seed }) {
  return {
    search: query => search.search(query),
    fetch: url => fetch.fetch(url),
    async plan({ mode, profile, state, limit }) {
      const user = render(plannerPrompt.user, { mode, profile, state, limits: { max_queries: limit } });
      const result = await llm.call({ prompt: plannerPrompt, user, schemaName: 'investor_planner_output', temperature: 0, seed, maxTokens: 2000 }); return { ...result.json, tokens_nominal: result.tokens_nominal, latency: result.latency };
    },
    async extract({ document, today, firstSeen }) {
      const user = render(extractorPrompt.user, { today, url: document.url, page_text: sanitizePageText(document.text).slice(0, 24000) });
      const result = await llm.call({ prompt: extractorPrompt, user, schemaName: 'investor_extraction', temperature: 0, seed: 0, maxTokens: 4000 });
      return { ...extractFixtureInvestor({ document, extraction: result.json, today, firstSeen }), tokens_nominal: result.tokens_nominal, latency: result.latency };
    }
  };
}
