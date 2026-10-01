/* ─────────────────────────────────────────────────────────────────────────────
   Auditoría de una corrida: responde "¿falló la interpretación de mi mensaje, la búsqueda, la lectura o la
   verificación?". Junta lo que el motor entendió del brief, las consultas (familia, año corregido, resultados),
   los contadores (consultas, páginas, leídas, descartadas por motivo) y el recorrido de cada página descartada.
   Solo reorganiza datos que ya existen (audits del motor, foundBy/verification/codeCheck de los leads).
   ───────────────────────────────────────────────────────────────────────────── */

/** Motivo de descarte de un lead ya rankeado, en una categoría contable. */
export function discardCategory(l) {
  const ver = l.verification || l.codeCheck;
  const r = String(ver?.drop || ver?.reasons?.[0] || '');
  if (r) {
    if (r === 'closed') return 'closed';
    if (r.startsWith('not_a_call') || r.startsWith('wrong_kind')) return r.replace('wrong_kind', 'not_a_call');
    return r;
  }
  const d = String(l.discard || '');
  if (!d) return null;
  if (/^Closed|deadline .*passed|not accepting/i.test(d)) return 'closed';
  if (/Not eligible|excludes/i.test(d)) return 'not_eligible';
  if (/Off-topic|mismatch/i.test(d)) return 'off_topic';
  if (/No confirmed evidence/i.test(d)) return 'no_confirmed_evidence';
  if (/Historical grant intelligence/i.test(d)) return 'historical_record';
  if (/Excluded|Rejected before|competitor/i.test(d)) return 'excluded_by_user';
  if (/not a funder/i.test(d)) return 'not_a_funder';
  if (/Different funding type/i.test(d)) return 'wrong_funding_type';
  return 'other';
}

/**
 * Benchmark por proveedor de búsqueda: suma los contadores de cada objetivo y calcula qué aportó cada uno.
 * Una URL cuenta para TODOS los proveedores que la trajeron; "solo aquí" = la trajo únicamente ese proveedor.
 * Útil = apply + watch (lo que el código verificó y conservó). Coste: solo el que el proveedor declara (costUsd); el resto es "no medido".
 */
export function providerBenchmark(engineRuns = []) {
  const acc = {};
  for (const a of engineRuns) for (const [name, p] of Object.entries(a.providers || {})) {
    const r = (acc[name] ||= { provider: name, calls: 0, returned: 0, errors: 0, ms: 0, costUsd: 0, urls: 0, onlyUrls: 0, pagesRead: 0, kept: 0, keptOnlyHere: 0, outcomes: {}, disabled: null });
    for (const k of ['calls', 'returned', 'errors', 'ms', 'costUsd', 'urls', 'onlyUrls', 'pagesRead', 'kept', 'keptOnlyHere']) r[k] += p[k] || 0;
    for (const [k, v] of Object.entries(p.outcomes || {})) add(r.outcomes, k, v);
    if (p.disabled) r.disabled = p.disabled;
  }
  const round = (x, d = 1) => Math.round(x * 10 ** d) / 10 ** d;
  return Object.values(acc).map((r) => {
    const apply = r.outcomes.apply || 0; const watch = r.outcomes.watch || 0; const useful = apply + watch;
    const noise = ['aggregator', 'social_host', 'too_short', 'over_page_budget', 'unread', 'read_failed'].reduce((n, k) => n + (r.outcomes[k] || 0), 0);
    return { ...r, costUsd: round(r.costUsd, 4), ms: Math.round(r.ms), apply, watch, useful,
      usefulPct: r.urls ? round((100 * useful) / r.urls) : null, applyPct: r.urls ? round((100 * apply) / r.urls) : null,
      noisePct: r.urls ? round((100 * noise) / r.urls) : null,
      urlsPerCall: r.calls ? round(r.urls / r.calls) : null, costPerUseful: r.costUsd > 0 && useful ? round(r.costUsd / useful, 4) : null,
      uniqueUseful: r.keptOnlyHere };
  }).sort((a, b) => b.apply * 3 + b.watch + b.keptOnlyHere * 2 - (a.apply * 3 + a.watch + a.keptOnlyHere * 2) || b.urls - a.urls);
}

const add = (o, k, n = 1) => { if (k) o[k] = (o[k] || 0) + n; return o; };

/**
 * @param {{ engineRuns?: object[], leads?: object[], searchAudit?: object[], brief?: object, today?: string }} input
 */
export function buildRunAudit({ engineRuns = [], leads = [], searchAudit = [], brief = {}, today = new Date().toISOString().slice(0, 10), maxTraces = 300 } = {}) {
  const counters = { queries: 0, queriesYearFixed: 0, pagesSeen: 0, pagesRead: 0, pagesUnread: 0, rereadForDates: 0, rereadImproved: 0, extracted: 0, extractFailed: 0, extractChanged: 0, extractConflicts: 0, extractCredits: 0, extractCacheHits: 0, scrapeCacheHits: 0, readVia: { crawl4ai: 0, jina: 0, firecrawl: 0 }, research: { steps: 0, searches: 0, opens: 0, newPages: 0 }, firecrawl: { credits: 0, possiblyCharged: 0, cacheHits: 0, capReached: false, capSkipped: 0, daily: null }, keptByEngine: 0, droppedByEngine: {}, skippedBeforeReading: {}, verdicts: {}, buckets: { top: 0, radar: 0, discarded: 0 }, discardReasons: {}, radarReasons: {} };
  const queries = []; const traces = []; const interpretations = [];
  for (const a of engineRuns) {
    counters.queries += a.queries || 0; counters.queriesYearFixed += a.yearFixed || 0; counters.pagesSeen += a.pages || 0; counters.pagesRead += a.read || 0; counters.pagesUnread += a.unread || 0;
    counters.rereadForDates += a.reread || 0; counters.rereadImproved += a.rereadImproved || 0; counters.extracted += a.extracted || 0; counters.extractFailed += a.extractFailed || 0; counters.extractChanged += a.extractChanged || 0; counters.extractConflicts += a.extractConflicts || 0; counters.extractCredits += a.extractCredits || 0; counters.keptByEngine += a.kept || 0;
    if (a.research) for (const k of ['steps', 'searches', 'opens', 'newPages']) counters.research[k] += a.research[k] || 0;
    counters.readVia.crawl4ai += a.crawl4aiRead || 0; counters.readVia.jina += a.jinaRead || 0; counters.readVia.firecrawl += a.firecrawlRead || 0;
    counters.extractCacheHits += a.extractCacheHits || 0; counters.scrapeCacheHits += a.scrapeCacheHits || 0;
    // Gasto de Firecrawl de la corrida (por objetivo, sumado) y el último estado del día (tope diario).
    const fc = a.firecrawl;
    if (fc) {
      counters.firecrawl.credits += fc.credits || 0; counters.firecrawl.possiblyCharged += fc.possiblyCharged || 0;
      counters.firecrawl.cacheHits += Object.values(fc.cacheHits || {}).reduce((x, y) => x + (y || 0), 0);
      counters.firecrawl.capSkipped += Object.values(fc.capSkipped || {}).reduce((x, y) => x + (y || 0), 0);
      counters.firecrawl.capReached = counters.firecrawl.capReached || Boolean(fc.capReached);
      if (fc.daily) counters.firecrawl.daily = fc.daily;
    }
    for (const [k, v] of Object.entries(a.dropped || {})) add(counters.droppedByEngine, k, v);
    for (const [k, v] of Object.entries(a.skipped || {})) add(counters.skippedBeforeReading, k, v);
    for (const [k, v] of Object.entries(a.verdicts || {})) add(counters.verdicts, k, v);
    if (a.interpretation) interpretations.push(a.interpretation);
    for (const q of a.queryLog || []) queries.push({ objective: a.objective, ...q });
    for (const t of a.traces || []) if (traces.length < maxTraces) traces.push({ objective: a.objective, ...t });
  }
  for (const row of searchAudit) if (row.dimension !== 'engine' && row.query && !queries.some((q) => q.query === row.query)) queries.push({ objective: '', query: row.query, family: `${row.provider}${row.dimension ? ` · ${row.dimension}` : ''}`, returned: row.returned ?? null, newPages: row.discovered ?? null });
  for (const l of leads) {
    add(counters.buckets, l.bucket);
    if (l.bucket === 'discarded') add(counters.discardReasons, discardCategory(l) || 'other');
    if (l.bucket === 'radar') add(counters.radarReasons, String(l.gate?.reason || l.verification?.blockers?.[0] || l.codeCheck?.blockers?.[0] || (l.status === 'forecasted' ? 'Forecast' : l.status === 'closed' ? 'Closed' : 'Other')).slice(0, 80));
    // Descartes que no vienen del motor (búsqueda sin modelo, registros): también con su recorrido
    if (l.bucket === 'discarded' && l.trace && traces.length < maxTraces && !traces.some((t) => t.url === l.trace.url)) traces.push({ objective: l.fundingType, url: l.contact?.value || l.trace.url, title: l.title, ...l.trace, verdict: 'skip', drop: discardCategory(l), reasons: [l.discard] });
  }
  return {
    today, brief: { venture: brief.venture || brief.company || null, product: brief.product || null, industry: brief.industry || null, geography: brief.geography || null, stage: brief.stage || null, round: brief.round || null, fundingTypes: brief.fundingTypes || [], constraints: brief.constraints || null },
    interpretations, counters, queries: queries.slice(0, 200), discarded: traces, providers: providerBenchmark(engineRuns),
  };
}
