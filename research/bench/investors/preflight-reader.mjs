#!/usr/bin/env node
// FIX-11 — preflight del lector para v4. Sale con código 1 y READER_UNAVAILABLE si no hay lector para páginas con JavaScript.
// Pasa si CRAWL4AI_URL responde, o si Jina devuelve ≥ 400 caracteres en 3/3 URLs de prueba.
// URLs de prueba por defecto: agregadores que en v3 dieron 100 % FETCH_EMPTY por lectura directa (FIX_SPEC §1.D), ninguno es firma del gold.
// Uso: node --env-file=.env research/bench/investors/preflight-reader.mjs --out <preflight.json> [--urls a,b,c]
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { jinaRead } from '../../server/research/searchApis.mjs';
import { crawl4aiRead } from '../../server/research/crawl4ai.mjs';
import { fetchPage } from '../../server/research/localSearch.mjs';

export const DEFAULT_PROBES = ['https://www.fundraisingfox.com/', 'https://foundersuite.com/', 'https://pipeseed.com/'];

export async function readerPreflight({ env = process.env, urls = DEFAULT_PROBES, fetcher = fetch } = {}) {
  const probes = [];
  for (const url of urls) {
    const row = { url, direct_chars: null, crawl4ai_chars: null, jina_chars: null, jina_error: null };
    row.direct_chars = (await fetchPage(url, { fetcher }).catch(() => null))?.text?.length ?? 0;
    if (env.CRAWL4AI_URL) row.crawl4ai_chars = (await crawl4aiRead(url, { env, fetcher }).catch(() => null))?.text?.length ?? 0;
    if (env.JINA_API_KEY) row.jina_chars = (await jinaRead(url, { env, fetcher, onError: e => { row.jina_error = e.code; } }))?.text?.length ?? 0;
    probes.push(row);
  }
  const crawl4ai_ok = Boolean(env.CRAWL4AI_URL) && probes.some(p => (p.crawl4ai_chars ?? 0) >= 400);
  const jina_ok = Boolean(env.JINA_API_KEY) && probes.length >= 3 && probes.every(p => (p.jina_chars ?? 0) >= 400);
  return { schema_version: 'investor_reader_preflight/1', checked_at: new Date().toISOString(), crawl4ai_configured: Boolean(env.CRAWL4AI_URL), jina_configured: Boolean(env.JINA_API_KEY), crawl4ai_ok, jina_ok, status: crawl4ai_ok || jina_ok ? 'passed' : 'READER_UNAVAILABLE', probes };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = n => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? null : process.argv[i + 1]; };
  const out = await readerPreflight({ urls: arg('urls') ? arg('urls').split(',') : DEFAULT_PROBES });
  if (arg('out')) { mkdirSync(dirname(resolve(arg('out'))), { recursive: true }); writeFileSync(resolve(arg('out')), `${JSON.stringify(out, null, 2)}\n`); }
  console.log(JSON.stringify(out, null, 2));
  if (out.status !== 'passed') { console.error('READER_UNAVAILABLE'); process.exitCode = 1; }
}
