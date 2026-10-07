import { createHash } from 'node:crypto';
import { norm } from '../../server/research/core.mjs';
import { PROVIDER_FN } from '../../server/research/searchApis.mjs';

const sha = s => createHash('sha256').update(s).digest('hex');
export function createSearchTool({ provider, env = process.env, transport, cache, resultsPerQuery = 10, recency = '', clock = Date.now }) {
  const fn = transport || PROVIDER_FN[provider]; if (!fn) throw new Error(`Unknown search provider ${provider}`);
  return { async search(query) {
    const key = sha(`${provider}|${resultsPerQuery}|${recency}|${norm(query)}`); const at = clock(); const hit = cache?.get('search', key);
    if (hit) return { results: hit.value, latency: { actual_ms: clock() - at, nominal_ms: hit.meta.latency_ms }, error: null };
    try {
      const rows = await fn(query, { env, limit: resultsPerQuery, recency });
      const results = rows.map((x, i) => ({ rank: x.rank || i + 1, url: x.url, title: x.title || '', snippet: x.snippet ?? x.description ?? '', published: x.published || null }));
      const ms = clock() - at; cache?.put('search', key, results, { latency_ms: ms }); return { results, latency: { actual_ms: ms, nominal_ms: ms }, error: null };
    } catch (e) { const ms=clock()-at;return { results: [], latency: { actual_ms: ms, nominal_ms: ms }, error: { code: /timeout|abort/i.test(e.message) ? 'SEARCH_TIMEOUT' : 'SEARCH_HTTP', message: e.message.slice(0, 300) } }; }
  }};
}
