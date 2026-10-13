/* ─────────────────────────────────────────────────────────────────────────────
   Auditoría de una corrida: responde "¿falló la interpretación de mi mensaje, la búsqueda, la lectura o la
   verificación?". Junta lo que el motor entendió del brief, las consultas (familia, año corregido, resultados),
   los contadores (consultas, páginas, leídas, descartadas por motivo) y el recorrido de cada página descartada.
   Solo reorganiza datos que ya existen (audits del motor, foundBy/verification/codeCheck de los leads).
   ───────────────────────────────────────────────────────────────────────────── */

import { applicantProfile } from './applicant.mjs';

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
  if (/Doesn't fund this kind/i.test(d)) return 'scope_mismatch';
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

/**
 * Prompt listo para copiar y pegar en otra IA con búsqueda web, con el MISMO brief y las MISMAS reglas que usó la corrida,
 * para comparar resultados sin tener que redactarlo cada vez. Declara el supuesto sobre el tipo de entidad cuando el brief no lo dice.
 */
const ENTITY_ES = { for_profit_startup: 'empresa / startup con fines de lucro', nonprofit: 'organización sin ánimo de lucro', academic: 'entidad académica o de investigación' };
export function comparisonPrompt(brief = {}, today = new Date().toISOString().slice(0, 10), objective = '') {
  const kind = objective || (brief.fundingTypes || [])[0] || 'grant';
  const p = applicantProfile(brief);
  const line = (k, v) => (v ? `- ${k}: ${String(v).replace(/\s+/g, ' ').trim()}` : null);
  const minDays = Number(brief.minDays) > 0 ? Number(brief.minDays) : 0;
  const limit = new Date(Date.parse(`${today}T00:00:00Z`) + minDays * 86400000).toISOString().slice(0, 10);
  const entity = p.entitySource.startsWith('default')
    ? `El tipo de entidad NO está definido en el brief (el motor asumió: ${ENTITY_ES[p.entity]}). Para cada resultado dime qué tipos de entidad pueden aplicar.`
    : `Tipo de entidad: ${ENTITY_ES[p.entity] || p.entity}.`;
  const where = p.outside.length ? `constituida FUERA de: ${p.outside.join(', ')}` : p.country ? `constituida en ${p.country}` : 'país de constitución no indicado';
  const about = [
    line('Proyecto', [brief.company || brief.venture, brief.oneLiner || brief.description].filter(Boolean).join(': ')), line('Producto', brief.product), line('Sector', brief.industry),
    line('Etapa', [brief.stage, brief.round].filter(Boolean).join(' / ')), line('Geografía', brief.geography), line('Constitución', where),
    line('Monto objetivo', brief.amount ? `${Number(brief.amount).toLocaleString('en-US')} USD` : ''), line('Restricciones', brief.constraints), line('Uso de fondos', brief.useOfFunds),
    line('Horizonte', brief.timeline), line('Excluir', brief.exclusions), line('Criterios adicionales', brief.criteria),
  ].filter(Boolean).join('\n');
  const head = `Hoy es ${today}. `;
  if (kind === 'investment') return `${head}Actúa como investigador de capital de riesgo. Busca en la web INVERSORES (fondos, firmas de venture capital, ángeles o redes de ángeles) que invertirían en este proyecto:\n\n${about}\n\n${entity}\n\nREGLAS (estrictas):\n1. Solo páginas OFICIALES del inversor (su sitio, su portafolio o su tesis). Nada de blogs, noticias, listas ni agregadores, ni páginas de eventos.\n2. Debe invertir en esta etapa y sector, y en esta geografía. Si no es seguro, márcalo aparte.\n3. Dame la persona concreta que decide (socio o managing partner) solo si la página oficial la nombra con su cargo; si no, dime solo la firma. No incluyas ventas, marketing ni relaciones públicas.\n4. No inventes nada. Si no estás segura, dilo.\n\nDevuélveme una tabla: Firma | URL oficial | Etapas y sectores en los que invierte (CITA LITERAL de su página) | Geografías | Cheque típico | Persona y cargo (si la página lo dice) | Por qué encaja | Estado (confirmado / dudoso).\nDespués una segunda tabla, «No pude confirmar». Al final, dime cuántos hay en cada tabla.`;
  const type = kind === 'grant' ? 'GRANTS (subvenciones, premios o concursos; no inversión ni deuda)' : `oportunidades de tipo «${kind}»`;
  return `${head}Actúa como investigador de financiación no dilutiva. Busca en la web convocatorias de ${type} a las que pueda aplicar este proyecto:\n\n${about}\n\n${entity}\n\nREGLAS (estrictas):\n1. Solo convocatorias ABIERTAS cuya fecha límite sea posterior al ${limit}${minDays ? ` (mínimo ${minDays} días desde hoy)` : ''}. Si no encuentras la fecha de cierre en la página oficial, NO la pongas en la lista principal.\n2. Solo páginas OFICIALES de la convocatoria o del financiador. Nada de blogs, noticias, agregadores ni directorios.\n3. Elegibilidad: debe poder aplicar el tipo de entidad indicado. Si la convocatoria lo excluye o no lo dice, márcala aparte.\n4. No incluyas convocatorias que contradigan las restricciones del proyecto.\n5. No inventes nada. Si no estás segura, dilo.\n\nDevuélveme una tabla: Nombre | URL oficial | Fecha límite (AAAA-MM-DD) | CITA LITERAL de la página donde aparece esa fecha | Quién puede aplicar (CITA LITERAL) | Monto máximo | Encaje (una línea) | Estado (abierta / dudosa).\nDespués una segunda tabla, «No pude confirmar», con lo que podría servir pero le falta fecha, elegibilidad o monto, y qué falta. Al final, dime cuántas hay en cada tabla.`;
}

const add = (o, k, n = 1) => { if (k) o[k] = (o[k] || 0) + n; return o; };

/**
 * @param {{ engineRuns?: object[], leads?: object[], searchAudit?: object[], brief?: object, today?: string }} input
 */
export function buildRunAudit({ engineRuns = [], orchestrator = null, grantSources = null, leads = [], searchAudit = [], brief = {}, today = new Date().toISOString().slice(0, 10), maxTraces = 300 } = {}) {
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
  // V13 · agentes de compilación y juez: totales por modelo y detalle por página (modelos, criterios, citas, desacuerdos, tiempo, llamadas).
  const judge = judgeSummary(engineRuns, leads, maxTraces);
  return {
    today, judge, brief: { venture: brief.venture || brief.company || null, product: brief.product || null, industry: brief.industry || null, geography: brief.geography || null, stage: brief.stage || null, round: brief.round || null, fundingTypes: brief.fundingTypes || [], constraints: brief.constraints || null },
    interpretations, counters, queries: queries.slice(0, 200), discarded: traces, providers: providerBenchmark(engineRuns),
    expansion: engineRuns.filter((a) => a.expand).map((a) => ({ objective: a.objective, seeds: a.expand.seeds || 0, pages: a.expand.pages || 0, snowball: a.expand.snowball || 0, siteDive: a.expand.siteDive || 0, similar: a.expand.similar || 0, siteDiveVia: a.expand.siteDiveVia || '', lateral: { openalex: a.expand.lateral?.openalex || 0, edgar: a.expand.lateral?.edgar || 0, ai: a.expand.lateral?.ai || 0 }, errors: (a.expand.errors || []).slice(0, 6) })),
    grantSources: grantSources ? { jurisdiction: grantSources.jurisdiction || null, portals: grantSources.portals || [], portalPages: engineRuns.filter((a) => a.portals).map((a) => ({ objective: a.objective, seeds: a.portals.seeds, pages: a.portals.pages, errors: a.portals.errors || [] })), reporter: grantSources.intel?.reporter ? { projects: grantSources.intel.reporter.all.n, medianAward: grantSources.intel.reporter.all.medianAward, orgTypes: grantSources.intel.reporter.all.orgTypes, institutes: grantSources.intel.reporter.all.institutes, notices: grantSources.intel.reporter.notices.slice(0, 8).map((n) => ({ id: n.id, projects: n.projects, medianAward: n.medianAward })) } : null, nsf: grantSources.intel?.nsf ? { awards: grantSources.intel.nsf.n, medianAward: grantSources.intel.nsf.medianAward, programs: grantSources.intel.nsf.programs } : null, errors: grantSources.intel?.errors || [] } : null,
    comparePrompts: Object.fromEntries((brief.fundingTypes || []).filter((t) => ['grant', 'investment'].includes(t)).map((t) => [t, comparisonPrompt(brief, today, t)])),
    orchestrator: orchestrator ? { by: orchestrator.by || null, attempts: (orchestrator.attempts || []).map((a) => ({ attempt: a.attempt, stopped: a.stopped || null, strategy: a.strategy || null, gap: a.gap || a.assessment?.gap || null, by: a.by || a.assessment?.by || null, diagnosis: a.diagnosis || null, queries: (a.queries || []).slice(0, 10), added: a.added ?? null, topBefore: a.before?.top ?? null, topAfter: a.after?.top ?? null, error: a.error || null })) } : null,
  };
}

const sumInto = (acc, src) => { for (const [k, v] of Object.entries(src || {})) acc[k] = (acc[k] || 0) + (typeof v === 'number' ? v : 0); return acc; };
function judgeSummary(engineRuns, leads, maxTraces) {
  const runs = engineRuns.filter((a) => a.judge);
  if (!runs.length) return null;
  const j = { on: true, ready: runs.every((a) => a.judge.ready), blind: runs.some((a) => a.judge.blind), sameModel: runs.some((a) => a.judge.sameModel), notices: [...new Set(runs.map((a) => a.judge.notice).filter(Boolean))], prompts: runs[0].judge.prompts, models: { compiler: null, judge: null }, calls: { compiler: 0, judge: 0 }, ms: { compiler: 0, judge: 0 }, invalid: { compiler: 0, judge: 0 }, errors: { compiler: 0, judge: 0 }, pages: 0, states: {}, disagreed: 0, failClosed: 0, patternDisagrees: 0, perPage: [] };
  for (const a of runs) {
    const x = a.judge;
    for (const k of ['calls', 'ms', 'invalid', 'errors']) sumInto(j[k], x[k]);
    sumInto(j.states, x.states); j.pages += x.pages || 0; j.disagreed += x.disagreed || 0; j.failClosed += x.failClosed || 0; j.patternDisagrees += x.patternDisagrees || 0;
    for (const r of ['compiler', 'judge']) if (x.models?.[r] && !j.models[r]) j.models[r] = x.models[r];
  }
  const page = (url, title, objective, bucket, jd, extra = {}) => ({ url, title: title || '', objective, bucket, models: jd.models, state: jd.state, deadline: jd.deadline, estimatedDeadline: jd.estimatedDeadline, daysLeft: jd.daysLeft, blind: jd.blind, judgeSawClaims: jd.judgeSawClaims, pageType: jd.pageType, criteria: jd.criteria, dates: jd.dates, disagreements: jd.disagreements, flags: jd.flags, blockers: jd.blockers, failure: jd.failure, ms: jd.ms, calls: jd.calls, dropReason: jd.dropReason, ...extra });
  const seen = new Set();
  for (const l of leads) { const jd = l.trace?.judge; const url = l.contact?.value || l.trace?.url; if (!jd || !url || seen.has(url) || j.perPage.length >= maxTraces) continue; seen.add(url); j.perPage.push(page(url, l.title, l.fundingType, l.bucket || null, jd)); }
  for (const a of runs) for (const t of a.traces || []) { if (!t.judge || !t.url || seen.has(t.url) || j.perPage.length >= maxTraces) continue; seen.add(t.url); j.perPage.push(page(t.url, t.title, a.objective, t.verdict === 'unread' ? 'unread' : 'discarded', t.judge, { drop: t.drop || null, note: t.note || null })); }
  return j;
}
