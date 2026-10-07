import { createHash } from 'node:crypto';
import { fetchPage, isPublicUrl } from '../../server/research/localSearch.mjs';
import { crawl4aiRead } from '../../server/research/crawl4ai.mjs';
import { jinaRead } from '../../server/research/searchApis.mjs';
import { normalizeUrl } from '../docs.mjs';

export function createFetchTool({ env = process.env, transport, cache, clock = Date.now }) {
  return { async fetch(url) {
    const at = clock(); if (!isPublicUrl(url)) return { ok: false, text: '', title: '', via: 'none', http_status: null, latency: { actual_ms: 0, nominal_ms: 0 }, error: { code: 'FETCH_BLOCKED', message: 'URL is not public' } };
    const key = normalizeUrl(url); const hit = cache?.get('fetch', key); if (hit) return { ...hit.value, latency: { actual_ms: clock() - at, nominal_ms: hit.meta.latency_ms }, cached: true };
    try {
      let got = transport ? await transport(url) : await fetchPage(url, { env }); let via = got?.via || 'direct';
      if ((!got || got.text?.length < 400) && !transport && env.CRAWL4AI_URL) { got = await crawl4aiRead(url, { env }) || got; if (got) via = 'crawl4ai'; }
      if ((!got || got.text?.length < 400) && !transport) { got = await jinaRead(url, { env }) || got; if (got) via = 'jina'; }
      const ms = clock() - at;
      if (!got || String(got.text || '').length < 200) return { ok: false, text: String(got?.text || ''), title: got?.title || '', via, http_status: got?.http_status || null, latency: { actual_ms: ms, nominal_ms: ms }, error: { code: 'FETCH_EMPTY', message: 'Page text shorter than 200 characters' } };
      const value = { ok: true, text: got.text, title: got.title || '', via, http_status: got.http_status || 200, text_sha256: createHash('sha256').update(got.text).digest('hex') };
      cache?.put('fetch', key, value, { latency_ms: ms }); return { ...value, latency: { actual_ms: ms, nominal_ms: ms }, cached: false };
    } catch (e) { const ms = clock() - at; return { ok: false, text: '', title: '', via: 'none', http_status: null, latency: { actual_ms: ms, nominal_ms: ms }, error: { code: /timeout|abort/i.test(e.message) ? 'FETCH_TIMEOUT' : 'FETCH_HTTP', message: e.message.slice(0, 300) } }; }
  }};
}
