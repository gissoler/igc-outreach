import { createHash } from 'node:crypto';
import { fleetTransport } from '../../agent/llm.mjs';
import { render, sanitizePageText } from '../../agent/prompts.mjs';
import { parseJsonContent } from '../../server/analysis/fleet.mjs';
import { bundleInvestor, validateInvestor } from './contracts.mjs';
import { extractFixtureInvestor } from './extractor.mjs';

const sha = value => createHash('sha256').update(String(value)).digest('hex');
const schemaForVllm = value => {
  if (Array.isArray(value)) return value.map(schemaForVllm);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'uniqueItems').map(([key, child]) => [key, schemaForVllm(child)]));
};
const repairKnownShape = (schemaName, value) => {
  if (schemaName !== 'investor_extraction' || !value || typeof value !== 'object') return value;
  const out = structuredClone(value);
  if (typeof out.canonical_url === 'string') {
    const raw = out.canonical_url.trim();
    if (!raw) out.canonical_url = null;
    else if (!/^https?:\/\//i.test(raw) && /^[a-z0-9.-]+\.[a-z]{2,}(?:\/.*)?$/i.test(raw)) out.canonical_url = `https://${raw}`;
    try { const parsed = new URL(out.canonical_url); if (!/^https?:$/.test(parsed.protocol)) out.canonical_url = null; }
    catch { out.canonical_url = null; }
  }
  return out;
};
export function createInvestorLlm({ env = process.env, role = 'engine', cache, family, transport }) {
  const tx = transport ?? fleetTransport(env, role);
  return { family, async call({ prompt, user, schemaName, temperature = 0, seed = 0, maxTokens = 4000 }) {
    const key = sha([prompt.sha256, sha(user), schemaName, temperature, seed].join('|')), hit = cache?.get('llm', key);
    if (hit) return { json: hit.value.json, tokens_nominal: hit.meta.tokens, latency: { actual_ms: 0, nominal_ms: hit.meta.latency_ms } };
    let messages = [{ role: 'system', content: prompt.system }, { role: 'user', content: user }];
    let tokens = 0, latency = 0, lastError = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const body = { messages, temperature, seed, max_tokens: maxTokens, response_format: { type: 'json_schema', json_schema: { name: schemaName, schema: schemaForVllm(bundleInvestor(schemaName)) } } };
      const response = await tx({ body, meta: { benchmark: 'investors' } });
      tokens += Number(response.usage?.prompt_tokens ?? 0) + Number(response.usage?.completion_tokens ?? 0); latency += Number(response.latency_ms ?? 0);
      try {
        const parsed = repairKnownShape(schemaName, parseJsonContent(response.content)); validateInvestor(schemaName, parsed);
        cache?.put('llm', key, { json: parsed }, { tokens, latency_ms: latency });
        return { json: parsed, tokens_nominal: tokens, latency: { actual_ms: latency, nominal_ms: latency } };
      } catch (error) {
        lastError = error;
        messages = [...messages, { role: 'assistant', content: response.content || '' }, { role: 'user', content: 'Your previous reply was not valid JSON for the required schema. Reply only with a complete valid JSON object.' }];
      }
    }
    throw lastError;
  } };
}

export function createLiveInvestorDeps({ search, fetch, llm, plannerPrompt, extractorPrompt, config, seed }) {
  return {
    search: (query, options) => search.search(query, options),
    fetch: url => fetch.fetch(url),
    async plan({ mode, profile, state, limit }) {
      const user = render(plannerPrompt.user, { mode, profile, state, limits: { max_queries: limit } });
      const result = await llm.call({ prompt: plannerPrompt, user, schemaName: 'investor_planner_output', temperature: 0, seed, maxTokens: 2000 }); return { ...result.json, tokens_nominal: result.tokens_nominal, latency: result.latency };
    },
    async extract({ document, today, firstSeen }) {
      const safePageText = sanitizePageText(document.text).replaceAll('{{', '{ {').replaceAll('}}', '} }').slice(0, 24000);
      const user = render(extractorPrompt.user, { today, url: document.url, page_text: safePageText });
      const result = await llm.call({ prompt: extractorPrompt, user, schemaName: 'investor_extraction', temperature: 0, seed: 0, maxTokens: 8000 });
      return { ...extractFixtureInvestor({ document, extraction: result.json, today, firstSeen }), tokens_nominal: result.tokens_nominal, latency: result.latency };
    }
  };
}
