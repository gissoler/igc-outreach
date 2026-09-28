// Ingesta de deals: búsqueda por sector × etapa × región × periodo (Firecrawl, con tbs), extracción
// (flota vLLM con esquema JSON, o reglas si no hay flota), verificación literal, resolución de fondos
// y guardado. Cada extracción (cruda y verificada) se guarda en `extractions`: es el conjunto de
// entrenamiento y evaluación del Módulo 1.
import { createHash } from 'node:crypto';
import { firecrawlSearch } from '../research/webscrape.mjs';
import { noopRecorder } from '../research/liveRun.mjs';
import { chatJSON, extractorTarget, fleetConfig } from './fleet.mjs';
import { DEAL_SCHEMA, EXTRACT_SYSTEM, extractionPrompt, mergeDeals, plainText, ruleExtract, verifyDeal } from './deals.mjs';
import { resolveFundNames } from './entities.mjs';

const BLOCKED = /(^|\.)(linkedin\.com|facebook\.com|instagram\.com|x\.com|twitter\.com|youtube\.com|tiktok\.com|crunchbase\.com|pitchbook\.com|reddit\.com)$/i;
const hostOf = (u) => { try { return new URL(u).hostname; } catch { return ''; } };
const pad = (n) => String(n).padStart(2, '0');

/** Periodos trimestrales entre dos fechas ISO, en formato tbs de Firecrawl. */
export function quarterPeriods(from, to) {
  const out = [];
  let d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (d < end) {
    const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 3, 1));
    const last = new Date(Math.min(next.getTime() - 86400000, end.getTime()));
    out.push({ label: `${d.getUTCFullYear()}-T${Math.floor(d.getUTCMonth() / 3) + 1}`, tbs: `cdr:1,cd_min:${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}/${d.getUTCFullYear()},cd_max:${pad(last.getUTCMonth() + 1)}/${pad(last.getUTCDate())}/${last.getUTCFullYear()}` });
    d = next;
  }
  return out;
}

const SECTOR_TERMS = { 'mental health': ['mental health startup', 'salud mental startup'], 'digital health': ['digital health startup', 'healthtech'], neuro: ['neurotech startup', 'Alzheimer startup'], biotech: ['biotech startup'] };
const STAGE_TERMS = { 'pre-seed': ['pre-seed round led by', 'ronda pre-semilla liderada por'], seed: ['seed round led by', 'ronda semilla liderada por'], 'series-a': ['Series A led by', 'Serie A liderada por'] };
const REGION_TERMS = { LATAM: ['Latin America', 'Latinoamérica'], US: [''], CO: ['Colombia'], MX: ['Mexico', 'México'], BR: ['Brazil'] };

/** Consultas por sector × etapa × región (una variante en inglés y otra en español cuando aplica). */
export function dealQueries({ sectors = ['mental health', 'digital health'], stages = ['pre-seed', 'seed'], regions = ['LATAM', 'US'] } = {}) {
  const out = [];
  for (const s of sectors) for (const st of stages) for (const r of regions) {
    const [sEn, sEs] = SECTOR_TERMS[s] || [s, s];
    const [stEn, stEs] = STAGE_TERMS[st] || [st, st];
    const [rEn, rEs] = REGION_TERMS[r] || [r, r];
    out.push(`${sEn} raises ${stEn} ${rEn}`.replace(/\s+/g, ' ').trim());
    if (rEs && r !== 'US') out.push(`${sEs} levanta ${stEs} ${rEs}`.replace(/\s+/g, ' ').trim());
  }
  return [...new Set(out)];
}

/** Extrae deals de una página con la flota; sin flota (o si falla), con reglas. */
export async function extractPage(page, { env = process.env, fetcher = fetch, signal, forceRules = false } = {}) {
  const cfg = fleetConfig(env);
  const target = extractorTarget(cfg);
  if (!forceRules && target.ready) {
    const { json, model } = await chatJSON({ system: EXTRACT_SYSTEM, user: extractionPrompt(page), schema: DEAL_SCHEMA, name: 'deals', role: target.role, model: target.model }, { env, fetcher, signal });
    return { raw: json, extractor: `vllm:${model}` };
  }
  return { raw: ruleExtract(page.text), extractor: 'reglas-v1' };
}

/** Procesa una página: extrae, verifica y guarda. Devuelve los deals aceptados y el registro de extracción. */
export async function processPage(page, { store, env = process.env, fetcher = fetch, signal, forceRules = false, now = new Date().toISOString() } = {}) {
  const text = plainText(page.markdown || page.text || '');
  const p = { url: page.url, title: page.title || '', published: page.date || page.published || '', text, source: page.source || hostOf(page.url) };
  const { raw, extractor } = await extractPage(p, { env, fetcher, signal, forceRules });
  const results = (raw?.deals || []).map((r) => ({ raw: r, ...verifyDeal(r, p, { extractor, now }) }));
  const textHash = createHash('sha256').update(text).digest('hex').slice(0, 20);
  const record = { id: createHash('sha256').update(`${p.url}|${extractor}|${textHash}`).digest('hex').slice(0, 20), url: p.url, textHash, extractor, createdAt: now, page: { url: p.url, title: p.title, published: p.published, text }, raw, verified: results.map(({ deal, status, reason }) => ({ deal, status, reason })) };
  const accepted = results.filter((r) => r.deal).map((r) => r.deal);
  if (store) {
    store.saveExtraction(record);
    for (const d of accepted) store.saveDeal(mergeDeals(store.deal(d.id), d));
    const { review } = resolveFundNames(accepted.flatMap((d) => d.investors.map((i) => i.name)));
    for (const r of review) store.saveFundReview(r.left, r.right, r.score);
  }
  return { accepted, record };
}

/** Corrida completa de ingesta. Firecrawl y la flota deben estar accesibles desde donde corre. */
export async function ingestDeals({ queries, periods, perQuery = 8 }, { store, env = process.env, fetcher = fetch, signal, live = noopRecorder, forceRules = false, log = () => {} } = {}) {
  const seen = new Set();
  const stats = { queries: 0, pages: 0, extracted: 0, accepted: 0, errors: [] };
  for (const period of periods) for (const query of queries) {
    stats.queries++;
    let results = [];
    try { results = await firecrawlSearch(query, { limit: perQuery, markdown: true, tbs: period.tbs, sources: ['web', 'news'], env, fetcher, signal, live }); }
    catch (error) { stats.errors.push(`${query} (${period.label}): ${error.message}`); continue; }
    for (const r of results) {
      if (seen.has(r.url) || BLOCKED.test(hostOf(r.url)) || (r.markdown || '').length < 300) continue;
      seen.add(r.url);
      stats.pages++;
      try {
        const { accepted, record } = await processPage(r, { store, env, fetcher, signal, forceRules });
        stats.extracted += record.raw?.deals?.length || 0;
        stats.accepted += accepted.length;
        log(`${period.label} · ${hostOf(r.url)} · ${accepted.length}/${record.raw?.deals?.length || 0} verified deals`);
      } catch (error) { stats.errors.push(`${r.url}: ${error.message}`); }
    }
  }
  return stats;
}
