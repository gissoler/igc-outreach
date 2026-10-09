import { createHash } from 'node:crypto';
import { PROVIDER_FN, PROVIDER_KEYS } from '../../server/research/searchApis.mjs';

const sha = value => createHash('sha256').update(String(value)).digest('hex');

export function createFailoverSearchTool({ providers, env = process.env, cache, resultsPerQuery = 10, recency = '', clock = Date.now, exaContentsChars = null }) {
  const ordered = [...providers];
  // v4 (FIX-11b): con exaContentsChars Exa devuelve texto, que sirve de respaldo si el fetch sale vacío. Sin él, idéntico a v3.
  const providerEnv = exaContentsChars
    ? { ...env, EXA_SEARCH_TYPE: 'instant', EXA_TEXT_CHARS: String(exaContentsChars), TAVILY_DEPTH: 'basic', TAVILY_INCLUDE_RAW_CONTENT: '0' }
    : { ...env, EXA_SEARCH_TYPE: 'instant', EXA_INCLUDE_CONTENTS: '0', TAVILY_DEPTH: 'basic', TAVILY_INCLUDE_RAW_CONTENT: '0' };
  if (exaContentsChars) delete providerEnv.EXA_INCLUDE_CONTENTS;
  const keyPrefix = exaContentsChars ? `c${exaContentsChars}|` : '';
  if (!ordered.length) throw new Error('Failover search requires at least one provider');
  for (const provider of ordered) {
    if (!PROVIDER_FN[provider]) throw new Error(`Unknown failover provider ${provider}`);
    if (!String(env[PROVIDER_KEYS[provider]] || '').trim()) throw new Error(`Missing ${PROVIDER_KEYS[provider]} for failover search`);
  }
  return {
    async search(query, { remainingSearches = ordered.length } = {}) {
      const attempts = [], started = clock();
      let searchesConsumed = 0, nominalCost = 0;
      for (const provider of ordered.slice(0, Math.max(0, remainingSearches))) {
        const key = sha(`${keyPrefix}${provider}|${resultsPerQuery}|${recency}|${query.trim().toLowerCase()}`);
        const hit = cache?.get('search', key);
        if (hit) {
          attempts.push({ provider, cached: true, results: hit.value.length, error: null });
          if (hit.value.length) return { results: hit.value, searches_consumed: Math.max(1, searchesConsumed), provider, attempts, latency: { actual_ms: clock() - started, nominal_ms: hit.meta.latency_ms }, nominal_cost: nominalCost };
          continue;
        }
        const attemptStarted = clock();
        try {
          const rows = await PROVIDER_FN[provider](query, { env: providerEnv, limit: resultsPerQuery, recency });
          searchesConsumed++;
          const latencyMs = clock() - attemptStarted;
          const results = rows.map((row, index) => ({ rank: row.rank || index + 1, url: row.url, title: row.title || '', snippet: row.snippet ?? row.description ?? '', published: row.published || null, provider, ...(exaContentsChars ? { text: String(row.markdown || row.description || '').slice(0, exaContentsChars) } : {}) }));
          const attemptCost = Number(rows.costUsd) || 0;
          nominalCost += attemptCost;
          cache?.put('search', key, results, { latency_ms: latencyMs, nominal_cost: attemptCost });
          attempts.push({ provider, cached: false, results: results.length, error: null });
          if (results.length) return { results, searches_consumed: searchesConsumed, provider, attempts, latency: { actual_ms: clock() - started, nominal_ms: latencyMs }, nominal_cost: nominalCost };
        } catch (error) {
          searchesConsumed++;
          attempts.push({ provider, cached: false, results: 0, error: { code: /timeout|abort/i.test(error.message) ? 'SEARCH_TIMEOUT' : 'SEARCH_HTTP', message: error.message.slice(0, 300) } });
        }
      }
      return { results: [], searches_consumed: Math.max(1, searchesConsumed), provider: null, attempts, latency: { actual_ms: clock() - started, nominal_ms: clock() - started }, nominal_cost: nominalCost, error: attempts.at(-1)?.error || { code: 'SEARCH_EMPTY', message: 'All configured providers returned zero results' } };
    }
  };
}
