/* ─────────────────────────────────────────────────────────────────────────────
   Orquestador de búsqueda: evalúa → reflexiona → plantea estrategia → reintenta (hasta 2 intentos extra).
   · Evalúa los resultados ya rankeados con métricas objetivas (cuántos accionables, con email, con persona…).
   · Reflexiona con OpenJev/Jev (System One: preguntas noul/choice/score sobre un estado pequeño y público).
     Sin OpenJev/Jev, la misma decisión sale de reglas deterministas.
   · Plantea una estrategia nueva (términos adyacentes, financiadores con nombre, geografía, rondas recientes,
     contactos) y escribe consultas nuevas: con el modelo de la flota si está, si no con plantillas.
   · Ejecuta el intento con el buscador disponible (motor v2 verificado o APIs de búsqueda) y/o Hunter,
     vuelve a rankear y decide si parar. Nunca borra resultados; solo añade.
   · Respeta el tiempo de la corrida: no empieza un intento si no queda margen.
   ───────────────────────────────────────────────────────────────────────────── */
import { chatJSON, fleetReady } from '../analysis/fleet.mjs';
import { candidate, evidence, norm, safeUrl } from './core.mjs';
import { jevConfigured, systemOne } from './jev.mjs';
import { hostKind, verifyOpportunity, compactVerification } from './verify.mjs';

export const ORCHESTRATOR = 'Search orchestrator';
export const STRATEGIES = {
  named_funders: 'Search for specific, named funders and programs (official names) similar to the best results so far.',
  adjacent_terms: 'Broaden the topic with adjacent sectors and synonyms the venture also fits.',
  geography: 'Search country- and region-specific funders and programs for the target geography.',
  recent_deals: 'Search recent rounds, awards and announcements in the sector to find who is actively funding now.',
  find_contacts: 'Stop searching the web; find decision-makers and emails at the organizations already found.',
};
const GAPS = {
  too_few: 'Too few actionable candidates overall.',
  low_relevance: 'Many results do not match the venture or the requested funding type.',
  missing_contacts: 'Relevant candidates exist but most have no email or named contact.',
  stale_or_closed: 'Many opportunities are closed, expired or undated.',
  none: 'No material gap; the results are good enough to start outreach.',
};
const clamp = (value, min, max, fallback) => { const n = Number(value); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback; };
const clip = (value, max = 160) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);

/* 1 · Evaluar: métricas objetivas sobre el ranking actual. */
export function metricsOf(ranked = []) {
  const live = ranked.filter((l) => l.bucket !== 'discarded');
  const top = ranked.filter((l) => l.bucket === 'top');
  const email = (list) => list.filter((l) => l.contact?.type === 'email').length;
  const rate = (n, d) => (d ? Math.round((n / d) * 100) / 100 : 0);
  const providers = new Set(live.flatMap((l) => (l.foundBy || []).map((f) => f.provider)).filter(Boolean));
  return {
    total: ranked.length,
    actionable: live.length,
    top: top.length,
    radar: ranked.filter((l) => l.bucket === 'radar').length,
    discarded: ranked.filter((l) => l.bucket === 'discarded').length,
    withEmail: email(live),
    emailRate: rate(email(live), live.length),
    topEmailRate: rate(email(top), top.length),
    withPerson: live.filter((l) => l.person).length,
    open: live.filter((l) => l.status === 'open').length,
    closed: ranked.filter((l) => l.status === 'closed').length,
    avgFit: rate(live.reduce((s, l) => s + (Number(l.fit) || 0), 0), live.length),
    providers: providers.size,
  };
}

/** Umbrales para dar la búsqueda por suficiente (configurables). */
const targets = (env) => ({ minTop: clamp(env.ORCHESTRATOR_MIN_TOP, 1, 200, 12), minEmailRate: clamp(env.ORCHESTRATOR_MIN_EMAIL_RATE, 0, 1, 0.35) });

/** Reflexión sin modelo: la misma forma de salida que la de OpenJev. */
export function ruleAssessment(m, { env = process.env, grantsOnly = false, tried = [] } = {}) {
  const t = targets(env);
  const contactsMatter = !grantsOnly;
  let gap = 'none';
  if (m.top < Math.ceil(t.minTop / 2)) gap = 'too_few';
  else if (m.actionable && m.avgFit < 0.3) gap = 'low_relevance';
  else if (contactsMatter && m.emailRate < t.minEmailRate) gap = 'missing_contacts';
  else if (grantsOnly && m.closed > m.open) gap = 'stale_or_closed';
  else if (m.top < t.minTop) gap = 'too_few';
  const sufficient = gap === 'none';
  const order = {
    too_few: ['named_funders', 'adjacent_terms', 'geography', 'recent_deals'],
    low_relevance: ['named_funders', 'geography', 'adjacent_terms'],
    missing_contacts: ['find_contacts', 'named_funders'],
    stale_or_closed: ['recent_deals', 'named_funders', 'geography'],
    none: ['find_contacts'],
  }[gap];
  const strategy = order.find((s) => !tried.includes(s)) || order[0];
  return { sufficient, confidence: sufficient ? 0.7 : 0.6, gap, strategy, quality: Math.round(Math.min(4, (m.top / t.minTop) * 2 + m.emailRate * 2)), by: 'rules' };
}

/* 2 · Reflexionar con OpenJev / Jev. Estado mínimo: nada de notas privadas, contactos ni identidad del usuario. */
export function reflectionState(brief, ranked, m, { tried = [], queries = [], env = process.env } = {}) {
  return {
    objective: {
      venture: clip(brief.venture || brief.company, 120), industry: clip(brief.industry, 160), stage: clip(brief.stage, 60),
      geography: clip(brief.geography, 100), funding_types: (brief.fundingTypes || []).slice(0, 5),
    },
    results: m,
    targets: { priority_candidates: targets(env).minTop, share_with_email: targets(env).minEmailRate },
    sample: ranked.filter((l) => l.bucket !== 'discarded').slice(0, 12).map((l) => ({
      name: clip(l.person || l.org, 80), organization: clip(l.org, 80), type: l.fundingType, kind: l.kind, status: l.status,
      has_email: l.contact?.type === 'email', score: Number(l.score) || 0, why: clip(l.why?.[0], 140),
    })),
    strategies_already_tried: tried,
    recent_queries: queries.slice(-15).map((q) => clip(q, 120)),
  };
}
export function reflectionQuestions(tried = []) {
  const options = Object.fromEntries(Object.entries(STRATEGIES).filter(([k]) => !tried.includes(k) || k === 'find_contacts'));
  return {
    sufficient: { type: 'noul', instructions: 'Are these results good enough for the founder to start outreach today: enough relevant, actionable candidates of the requested funding type, most with a contact channel?', criteria: { true: 'Enough relevant, current, contactable candidates; another search round would add little.', false: 'Too few, off-target, stale or uncontactable results; another search round is worth it.' } },
    gap: { type: 'choice', instructions: 'What is the main weakness of these results?', criteria: GAPS },
    strategy: { type: 'choice', instructions: 'Which search strategy should the next attempt use to fix that weakness? Prefer one not tried yet.', criteria: Object.keys(options).length >= 2 ? options : STRATEGIES },
    quality: { type: 'score', instructions: 'Rate the overall usefulness of these results for fundraising outreach.', criteria: ['Useless', 'Weak', 'Usable with gaps', 'Good', 'Excellent'] },
  };
}
export async function reflect(brief, ranked, { env = process.env, fetcher = fetch, signal, tried = [], queries = [], grantsOnly = false, jev = systemOne } = {}) {
  const m = metricsOf(ranked);
  const rules = ruleAssessment(m, { env, grantsOnly, tried });
  if (!jevConfigured(env) && jev === systemOne) return { ...rules, metrics: m };
  try {
    const { answers, model, provider } = await jev(reflectionState(brief, ranked, m, { tried, queries, env }), reflectionQuestions(tried), { env, fetcher, signal, timeoutMs: env.ORCHESTRATOR_JEV_TIMEOUT_MS || 25000 });
    const suff = clamp(answers?.sufficient?.noul, 0, 1, 0);
    const gap = GAPS[answers?.gap?.choice] ? answers.gap.choice : rules.gap;
    let strategy = STRATEGIES[answers?.strategy?.choice] ? answers.strategy.choice : rules.strategy;
    if (tried.includes(strategy) && strategy !== 'find_contacts') strategy = rules.strategy;
    // El modelo puede decir "suficiente", pero no por debajo de la mitad del objetivo de accionables.
    const sufficient = suff >= 0.6 && gap === 'none' ? m.top >= Math.ceil(targets(env).minTop / 2) : suff >= 0.75 && rules.sufficient;
    return { sufficient, confidence: suff, gap, strategy, quality: clamp(answers?.quality?.score, 0, 4, rules.quality), by: provider || 'OpenJev', model, metrics: m };
  } catch (error) {
    return { ...rules, metrics: m, warning: `${error.message}; rules used instead.` };
  }
}

/* 3 · Plantear: consultas nuevas para la estrategia elegida. */
const OBJ_WORDS = {
  investment: 'venture capital fund invests pre-seed seed',
  grant: 'grant funding open call apply',
  debt: 'venture debt lender startups',
  partnering: 'corporate partnership pilot program startups',
  sponsorship: 'startup sponsorship in-kind program',
};
const regions = (geo) => {
  const g = String(geo || '').trim();
  if (!g || /global|world|any|todo|mundial/i.test(g)) return ['United States', 'Europe', 'United Kingdom', 'Latin America'];
  return g.split(/[,;/]| and | y /i).map((x) => x.trim()).filter(Boolean).slice(0, 4);
};
const focusOf = (b) => String(b.industry || b.product || '').split(/[,;]/)[0].trim().split(/\s+/).slice(0, 5).join(' ');

export function templateQueries(strategy, brief, { terms = [], ranked = [], year = new Date().getFullYear(), n = 8 } = {}) {
  const focus = focusOf(brief); const types = (brief.fundingTypes || ['investment']).filter((t) => OBJ_WORDS[t]);
  const words = (t) => OBJ_WORDS[t] || OBJ_WORDS.investment;
  const termList = terms.map((t) => (typeof t === 'string' ? t : t?.term)).filter(Boolean);
  const bestOrgs = [...new Set(ranked.filter((l) => l.bucket === 'top' && !l.person).map((l) => clip(l.org, 60)).filter((x) => x && !/\.[a-z]{2,}$/.test(x)))].slice(0, 4);
  const out = [];
  for (const t of types) {
    if (strategy === 'adjacent_terms') for (const term of termList.slice(0, 4)) out.push({ query: `${term} ${words(t)} ${year}`, objective: t });
    if (strategy === 'geography') for (const region of regions(brief.geography)) out.push({ query: `${focus} ${words(t)} ${region} ${year}`, objective: t });
    if (strategy === 'recent_deals') out.push(
      { query: t === 'grant' ? `${focus} startups awarded grant ${year}` : `${focus} startup raised ${brief.stage || 'seed'} round led by ${year}`, objective: t },
      { query: t === 'grant' ? `${focus} innovation challenge winners ${year} funding` : `${focus} ${brief.stage || 'seed'} funding announcement investors ${year}`, objective: t });
    if (strategy === 'named_funders') {
      for (const org of bestOrgs) out.push({ query: `${t === 'grant' ? 'programs' : 'funds'} similar to ${org} ${focus}`, objective: t });
      out.push({ query: `list of ${focus} ${t === 'grant' ? 'grant programs foundations' : t === 'investment' ? 'venture capital firms and angel networks' : words(t)} ${year}`, objective: t },
        { query: `${focus} ${t === 'grant' ? 'foundation program officer grants' : 'investor portfolio thesis'} ${brief.stage || ''}`.trim(), objective: t });
    }
  }
  const seen = new Set();
  return out.filter((q) => !seen.has(norm(q.query)) && seen.add(norm(q.query))).slice(0, n);
}

export async function strategyQueries(strategy, brief, { terms = [], ranked = [], asked = [], env = process.env, fetcher = fetch, signal, chat = chatJSON, n = 8 } = {}) {
  const base = templateQueries(strategy, brief, { terms, ranked, n });
  const role = fleetReady(env, 'engine') ? 'engine' : fleetReady(env, 'chat') ? 'chat' : null;
  if (strategy === 'find_contacts' || (chat === chatJSON && !role)) return { queries: base, planned: false };
  try {
    const found = ranked.filter((l) => l.bucket !== 'discarded').slice(0, 20).map((l) => clip(l.person ? `${l.person} (${l.org})` : l.org, 80));
    const { json } = await chat({
      system: 'You are a senior fundraising researcher planning the next web searches. Reply only JSON.',
      user: `Venture: ${clip(brief.venture || brief.company, 120)} · ${clip(brief.industry, 160)} · stage ${clip(brief.stage, 40)} · geography ${clip(brief.geography, 80)} · looking for ${(brief.fundingTypes || []).join(', ')}.\nStrategy for this attempt: ${STRATEGIES[strategy]}\nAlready found: ${found.join('; ') || 'nothing useful yet'}.\nQueries already run:\n${asked.slice(-30).join('\n')}\n\nWrite ${n} NEW web search queries for this strategy. Use official names of real funders/programs when you know them, specific countries, and current year. Do not repeat earlier queries. Return {"queries":[{"query":"...","objective":"${(brief.fundingTypes || ['investment'])[0]}"}]}.`,
      name: 'orchestrator_plan', role: role || 'chat',
    }, { env, fetcher, signal });
    const types = new Set(brief.fundingTypes || []);
    const seen = new Set(asked.map(norm));
    const planned = (Array.isArray(json?.queries) ? json.queries : []).map((q) => ({ query: clip(q?.query ?? q, 200), objective: types.has(q?.objective) ? q.objective : (brief.fundingTypes || ['investment'])[0] }))
      .filter((q) => q.query.length >= 8 && !seen.has(norm(q.query)) && seen.add(norm(q.query)));
    return planned.length >= 3 ? { queries: [...planned, ...base.filter((b) => !seen.has(norm(b.query)))].slice(0, n), planned: true } : { queries: base, planned: false };
  } catch { return { queries: base, planned: false }; }
}

/* 4 · Resultados de búsqueda (APIs) → candidatos. Son pistas: el ranking y la revisión humana deciden. */
const OPPORTUNITY_WORDS = /(apply|application|grant|funding|call for|open call|prize|challenge|competition|accelerator|fellowship|award)/i;
export function searchRowsToLeads(rows, brief, { objective = 'investment', query = '' } = {}) {
  const own = [brief.organization, brief.company, brief.venture].map((x) => norm(x).split(' ')[0]).filter((t) => t && t.length >= 3);
  return (rows || []).flatMap((r) => {
    const url = safeUrl(r?.url);
    if (!url || hostKind(url) !== 'other') return [];
    const host = new URL(url).hostname.replace(/^www\./, '');
    if (own.some((t) => norm(host).startsWith(t))) return [];
    const fromPage = String(r.markdown || '').trim();
    const text = `${r.title || ''} ${r.description || ''} ${fromPage.slice(0, 3000)}`;
    if (objective === 'grant' && !OPPORTUNITY_WORDS.test(text)) return [];
    const quote = clip(fromPage ? fromPage.slice(0, 700) : r.description || r.title, 700);
    if (!quote) return [];
    const providers = (r.providers || [r.provider]).filter(Boolean);
    // Grants sin modelo: el código verifica la página que trajo el buscador (tipo, plazo contra hoy, elegibilidad).
    // Nunca "open" por defecto; sin texto de página queda «a verificar».
    const check = objective === 'grant' ? verifyOpportunity({}, { url, title: r.title, text: fromPage }, { brief, codeOnly: true }) : null;
    return [candidate({
      externalId: `orchestrator:${objective}:${url}`,
      org: host,
      title: clip(r.title || host, 300),
      kind: objective === 'grant' ? 'opportunity' : 'research',
      fundingType: objective,
      status: check && fromPage ? check.status : 'unknown',
      ...(check && fromPage && check.deadline ? { deadline: check.deadline } : {}),
      ...(check ? { codeCheck: compactVerification(fromPage ? check : { ...check, tier: 'verify', verdict: 'watch', drop: null, reasons: [], blockers: ['Only a search snippet: the page was not opened'] }), trace: { query, family: 'search APIs (no AI model)', queries: [{ query, family: objective }], providers, fetchedVia: fromPage ? 'search' : 'snippet', textChars: fromPage.length, read: null, verify: { tier: fromPage ? check.tier : 'verify', drop: fromPage ? check.drop : null, reasons: fromPage ? check.reasons : [], blockers: check.blockers, flags: check.flags, checks: check.checks, pageType: check.pageType, dates: check.dates, eligibility: { decision: check.eligibility.decision, reason: check.eligibility.reason, quote: check.eligibility.quote } }, today: check.today } } : {}),
      contact: { type: 'source', value: url, provenance: `Found by ${providers.join(' + ') || 'web search'} (orchestrator)` },
      evidence: [evidence(`${ORCHESTRATOR} · ${providers.join('+') || 'search'}`, url, quote, objective === 'grant' ? 'opportunity' : 'search_snippet', undefined, Boolean(fromPage))],
      searchText: text.slice(0, 4000),
      risks: ['Found in an extra search attempt: confirm mandate, timing and eligibility'],
      missing: [...(fromPage ? [] : ['Only a search snippet; open the page']), ...(objective === 'grant' ? ['Deadline not confirmed'] : ['No decision-maker named yet'])],
      foundBy: [{ provider: ORCHESTRATOR, term: providers.join(', '), objective, query, dimension: 'orchestrator' }],
    })];
  });
}

/* 4b · Confirmar pistas: un resultado que solo trae snippet se descarta en el ranking ("search lead").
   Se abre la página (descarga directa → Jina → Firecrawl) y, si habla del tema y de financiar, se añade una cita
   LITERAL de la página como evidencia verificada. Si no, la pista queda como estaba (y se descarta como antes). */
const INTENT = /(invest|fund|portfolio|backs?\b|capital|grant|award|prize|challenge|apply|application|accelerat|program|lend|loan|financ|sponsor|partner)/i;
export function pageQuote(text, brief, { max = 600 } = {}) {
  const tokens = [...new Set(norm(`${brief.industry || ''} ${brief.product || ''}`).split(' ').filter((t) => t.length > 3))];
  const sentences = String(text || '').replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/).filter((x) => x.length >= 40 && x.length <= 900);
  const scored = sentences.map((x, i) => ({ x, i, topic: tokens.filter((t) => norm(x).includes(t)).length, intent: INTENT.test(x) }))
    .filter((r) => r.topic && r.intent).sort((a, b) => b.topic - a.topic || a.i - b.i);
  if (!scored.length) return '';
  const best = scored[0];
  const next = sentences[best.i + 1] && (best.x.length + sentences[best.i + 1].length) < max ? ` ${sentences[best.i + 1]}` : '';
  return `${best.x}${next}`.slice(0, max);
}
export async function confirmFromPages(leads, brief, { read, max = 12, concurrency = 4, signal } = {}) {
  const todo = leads.filter((l) => !l.person && !(l.evidence || []).some((e) => e.verified) && safeUrl(l.contact?.value || l.evidence?.[0]?.url)).slice(0, max);
  let confirmed = 0; let i = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, async () => {
    while (i < todo.length) {
      const lead = todo[i++];
      if (signal?.aborted) return;
      const url = safeUrl(lead.contact?.value || lead.evidence?.[0]?.url);
      const page = await read(url).catch(() => null);
      const quote = page?.text ? pageQuote(page.text, brief) : '';
      if (!quote) continue;
      lead.evidence = [...(lead.evidence || []), evidence(`Page read · ${new URL(url).hostname.replace(/^www\./, '')}`, page.url || url, quote, lead.kind === 'opportunity' ? 'opportunity' : 'profile')];
      if (lead.fundingType === 'grant' && lead.kind === 'opportunity') {
        // Página abierta: el código re-verifica plazo, tipo de página y elegibilidad sobre el texto completo.
        const check = verifyOpportunity({}, { url: page.url || url, title: page.title, text: page.text }, { brief, codeOnly: true });
        lead.codeCheck = compactVerification(check);
        lead.status = check.status; lead.deadline = check.deadline || null;
        if (lead.trace) lead.trace = { ...lead.trace, fetchedVia: `opened (${page.via || 'direct'})`, textChars: page.text.length, verify: { tier: check.tier, drop: check.drop, reasons: check.reasons, blockers: check.blockers, flags: check.flags, checks: check.checks, pageType: check.pageType, dates: check.dates, eligibility: { decision: check.eligibility.decision, reason: check.eligibility.reason, quote: check.eligibility.quote } } };
      }
      lead.searchText = `${lead.searchText || ''} ${quote}`.slice(0, 4000);
      lead.missing = (lead.missing || []).filter((m) => !/snippet/i.test(m));
      if (page.title && /\.[a-z]{2,}$/.test(lead.org || '')) lead.org = String(page.title).split(/[|·–—-]/)[0].trim().slice(0, 90) || lead.org;
      confirmed++;
    }
  }));
  return { leads, confirmed, tried: todo.length };
}

/* 5 · Bucle: hasta N intentos adicionales. */
export async function orchestrate({ leads, brief, terms = [], rank, runSearch, findContacts = null, env = process.env, fetcher = fetch, signal, deadline = Infinity, live = () => {}, jev, chat, now = () => Date.now() } = {}) {
  const maxAttempts = clamp(env.ORCHESTRATOR_MAX_ATTEMPTS, 0, 5, 2);
  const minMs = clamp(env.ORCHESTRATOR_MIN_REMAINING_MS, 5_000, 600_000, 45_000);
  const grantsOnly = (brief.fundingTypes || []).length === 1 && brief.fundingTypes[0] === 'grant';
  let all = [...leads];
  let ranked = rank(all);
  const attempts = []; const tried = []; const asked = [];
  for (let n = 1; n <= maxAttempts; n++) {
    signal?.throwIfAborted?.();
    const view = await reflect(brief, ranked, { env, fetcher, signal, tried, queries: asked, grantsOnly, ...(jev ? { jev } : {}) });
    live({ phase: 'evaluating', status: 'running', title: `Reflection ${n}`, message: view.sufficient
      ? `${view.by}: results are enough (${view.metrics.top} priority, ${Math.round(view.metrics.emailRate * 100)}% with email). No extra search.`
      : `${view.by}: ${GAPS[view.gap] || view.gap} Next: ${STRATEGIES[view.strategy]}`, detail: { kind: 'orchestrator_reflection', attempt: n, ...view } });
    if (view.warning) live({ phase: 'warning', status: 'warning', title: 'Reflection fallback', message: view.warning });
    if (view.sufficient) { attempts.push({ attempt: n, stopped: 'sufficient', assessment: view }); break; }
    const remaining = deadline - now();
    if (remaining < minMs) { attempts.push({ attempt: n, stopped: 'time', assessment: view }); live({ phase: 'warning', status: 'warning', title: 'No time for another attempt', message: `Only ${Math.round(remaining / 1000)} s left in this run; kept what we have.` }); break; }
    const budgetMs = Math.max(5_000, Math.min(remaining - 15_000, clamp(env.ORCHESTRATOR_ATTEMPT_MS, 10_000, 600_000, 120_000)));
    const attemptSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(budgetMs)]) : AbortSignal.timeout(budgetMs);
    tried.push(view.strategy);
    const before = view.metrics;
    let added = []; let queries = []; let planned = false; let error = null;
    try {
      if (view.strategy === 'find_contacts') {
        if (findContacts) added = await findContacts(ranked, { signal: attemptSignal, wide: true });
      } else {
        ({ queries, planned } = await strategyQueries(view.strategy, brief, { terms, ranked, asked, env, fetcher, signal: attemptSignal, ...(chat ? { chat } : {}) }));
        asked.push(...queries.map((q) => q.query));
        live({ phase: 'planning', status: 'running', title: `Attempt ${n}: ${view.strategy.replace(/_/g, ' ')}`, message: `${queries.length} new ${planned ? 'model-planned' : 'template'} queries: ${queries.slice(0, 3).map((q) => `"${clip(q.query, 70)}"`).join(' · ')}${queries.length > 3 ? '…' : ''}`, detail: { kind: 'query_ledger', queries: queries.map((q) => q.query) } });
        if (queries.length) added = await runSearch(queries, { signal: attemptSignal, strategy: view.strategy });
        // Un intento que no trae emails también busca contactos de lo nuevo, si Hunter está.
        if (findContacts && view.gap === 'missing_contacts') added = [...added, ...await findContacts(rank([...all, ...added]), { signal: attemptSignal, wide: false })];
      }
    } catch (e) {
      if (signal?.aborted) throw e;
      error = e.name === 'TimeoutError' || attemptSignal.aborted ? `attempt stopped after ${Math.round(budgetMs / 1000)} s` : e.message;
    }
    all = mergeLeads(all, added);
    ranked = rank(all);
    const after = metricsOf(ranked);
    attempts.push({ attempt: n, strategy: view.strategy, gap: view.gap, by: view.by, queries: queries.map((q) => q.query), planned, added: added.length, before, after, ...(error ? { error } : {}) });
    live({ phase: 'reading', status: error ? 'warning' : 'success', title: `Attempt ${n} done`, message: `${added.length} new results · priority ${before.top} → ${after.top} · with email ${before.withEmail} → ${after.withEmail}${error ? ` (${error})` : ''}.`, resultCount: added.length, detail: { kind: 'orchestrator_attempt', attempt: n, strategy: view.strategy, before, after } });
  }
  return { leads: all, ranked, attempts };
}

/** Une candidatos nuevos sin duplicar los que ya existen (misma persona+org o mismo externalId). */
export function mergeLeads(existing, added) {
  const key = (l) => (l.person ? `p:${norm(l.person)}|${norm(l.org)}` : `o:${l.externalId || `${norm(l.org)}|${norm(l.title)}`}`);
  const map = new Map(existing.map((l) => [key(l), l]));
  for (const lead of added || []) {
    const k = key(lead);
    if (!map.has(k)) { map.set(k, lead); continue; }
    const cur = map.get(k);
    // Si lo nuevo trae email y lo existente no, se conserva el email.
    if (lead.contact?.type === 'email' && cur.contact?.type !== 'email') map.set(k, { ...cur, contact: lead.contact, evidence: [...(cur.evidence || []), ...(lead.evidence || [])], hunter: lead.hunter || cur.hunter });
  }
  return [...map.values()];
}
