/* ─────────────────────────────────────────────────────────────────────────────
   V15 · Etapa de expedientes: de los ítems cosechados a hallazgos juzgados.
     1. expedientes por convocatoria (dossier.mjs) y suficiencia documental;
     2. filtro determinista con metadatos oficiales (vencidas, cerradas) — no gasta juez;
     3. orden por tema (BM25 del brief) + preselección del modelo en UNA llamada; cuotas por vía
        (temáticas, mecanismos generales, fundaciones/web) para no anclarse en el primer hallazgo;
     4. juez por expediente; elegibilidad separada: lo que PIDE la convocatoria vs lo que el brief CONFIRMA;
     5. estado y fecha: la próxima fecha para solicitudes NUEVAS del NIH sale del texto oficial por código;
     6. embudo y una línea de estado honesta.
   ───────────────────────────────────────────────────────────────────────────── */
import { auditPage } from '../judge/audit.v13.mjs';
import { literalIn } from '../verify.mjs';
import { daysBetween } from '../dates.mjs';
import { buildDossiers, canonicalUrl, evidenceText, mechanismOf, nihNextDue, officialStatus } from './dossier.mjs';
import { scoreDocs } from './terms.mjs';
import { DOSSIER_CRITERION_HELP, dossierJudgePrompt, shortlistPrompt } from './prompts.mjs';

const noopTrace = { event: () => null };
const pool = async (items, n, fn) => { const out = new Array(items.length); let i = 0; await Promise.all(Array.from({ length: Math.min(Math.max(1, n), items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } })); return out; };
const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const validJudgment = (raw, ids) => Boolean(raw && typeof raw === 'object' && typeof raw.page_type === 'string' && Array.isArray(raw.dates) && raw.criteria && ids.every((id) => ['yes', 'no', 'unknown'].includes(raw.criteria[id]?.verdict)));

/** Qué hechos del solicitante confirma el brief. Sin confirmar = la elegibilidad queda condicionada, nunca «sí». */
export function applicantFacts(brief = {}) {
  const all = `${brief.entityType || ''} | ${brief.geography || ''} | ${brief.constraints || ''} | ${brief.stage || ''}`.toLowerCase();
  const said = (rx) => rx.test(all);
  const entityDeclared = Boolean(String(brief.entityType || '').trim()) && !/unknown|not confirmed|unconfirmed|tbd/i.test(brief.entityType);
  const entityUnknown = !entityDeclared || said(/entity type[^.|]*\b(unknown|not confirmed|unconfirmed)\b/) || said(/\b(unknown|not confirmed)\b[^.|]*entity type/);
  const countryDeclared = Boolean(String(brief.country || brief.state || '').trim());
  const countryUnknown = !countryDeclared || said(/country[^.|]*\b(unknown|not confirmed|unconfirmed)\b/);
  const piUnknown = said(/\b(pi|principal investigator)\b[^.|]*\b(unknown|not confirmed)\b/) || said(/\b(unknown|not confirmed)\b[^.|]*\b(pi|principal investigator)\b/) || said(/entity type, pi/);
  return { entity: entityUnknown ? null : brief.entityType, country: countryUnknown ? null : brief.country || brief.state, piUnknown, missing: [...(entityUnknown ? ['entity type'] : []), ...(countryUnknown ? ['country'] : []), ...(piUnknown ? ['principal investigator / affiliation'] : [])] };
}

/** Puerta del solicitante sobre el juicio (antes de auditar): un sí/no que depende de hechos no confirmados pasa a
 *  «unknown» y queda como CONDICIÓN con su cita. Así una lista de tipos admitidos no se convierte en «IGC cumple». */
export function gateApplicant(judgment, facts, text) {
  const j = structuredClone(judgment); const conditions = [];
  const gate = (id, unknownFact, label) => {
    const c = j.criteria?.[id]; if (!c || !unknownFact || c.verdict === 'unknown') return;
    const quote = typeof c.quote === 'string' && literalIn(c.quote, text) ? c.quote : null;
    conditions.push({ criterion: id, kind: c.verdict === 'yes' ? 'requirement_published' : 'restriction', quote, reason: clip(c.reason, 240), fact: label });
    j.criteria[id] = { ...c, verdict: 'unknown', reason: `${c.reason || ''} [code: the brief does not confirm the applicant's ${label}; the judge said ${c.verdict}]`.trim() };
  };
  gate('eligibility', facts.entity === null || facts.country === null, facts.missing.join(', ') || 'facts');
  gate('entity_type', facts.entity === null, 'entity type');
  gate('region', facts.country === null, 'country');
  return { judgment: j, conditions };
}

const STATE_RANK = { open: 0, upcoming: 1, forecast: 2, unknown: 3 };
const TOPIC_RANK = { yes: 0, unknown: 1, no: 2 };

/**
 * deps: { model(prompt, role, validate, ref, call) → valor o null, trace, env }
 * input: { items, brief, today, terms, ids, objective, reserved }
 */
export async function runDossierStage({ items = [], brief, today, terms, ids, objective = 'grant', model, trace = noopTrace, env = process.env, upgrade = null, nihFetch = null } = {}) {
  upgrade ||= nihFetch ? (d) => nihFetch(d.id) : null;
  const t0 = Date.now(); const cap = Number(env.ENGINE_DOSSIER_JUDGE_MAX) || 24; const capTopical = Number(env.ENGINE_DOSSIER_TOPICAL) || 14;
  const capMech = Number(env.ENGINE_DOSSIER_MECHANISMS) || 4; const capWeb = Number(env.ENGINE_DOSSIER_WEB) || 6; const concurrency = Number(env.ENGINE_DOSSIER_JUDGE_CONCURRENCY ?? env.ENGINE_AGENT_JUDGE_CONCURRENCY) || 8;
  // Un catálogo es fuente de descubrimiento, nunca candidato: se excluye por URL aunque otra vía (el agente) lo haya leído.
  const hubUrls = new Set(items.filter((x) => x.hub).map((x) => canonicalUrl(x.url)));
  const usable = items.filter((x) => !x.hub && !hubUrls.has(canonicalUrl(x.url)));
  let dossiers = buildDossiers(usable);
  // Fichas pobres: se intenta completarlas con la fuente oficial (NIH Guide por número, detalle del registro) antes de rendirse.
  if (upgrade) {
    const stubs = dossiers.filter((d) => !d.sufficiency.evaluable && d.id);
    const extra = (await Promise.all(stubs.slice(0, Number(env.ENGINE_DOSSIER_UPGRADE_MAX) || 12).map((d) => upgrade(d).catch(() => [])))).flat().filter(Boolean);
    if (extra.length) dossiers = buildDossiers([...usable, ...extra]);
    trace.event('dossier_upgrade', { stubs: stubs.length, tried: Math.min(stubs.length, Number(env.ENGINE_DOSSIER_UPGRADE_MAX) || 12), added_docs: extra.length });
  }
  const funnel = { items: items.length, by_source: {}, catalogs: items.filter((x) => x.hub).length, dossiers: dossiers.length, not_evaluable: 0, expired: 0, closed_registry: 0, scored: 0, shortlist: null, judged: 0, judge_failed: 0, dropped: {}, kept: 0, pertinent: 0, open: 0, forecast: 0, conditional: 0, ready: 0 };
  for (const x of items) funnel.by_source[x.source] = (funnel.by_source[x.source] || 0) + 1;

  // 2 · Filtro determinista.
  const live = [];
  for (const d of dossiers) {
    if (!d.sufficiency.evaluable) { funnel.not_evaluable++; trace.event('dossier', { key: d.key, id: d.id, url: d.url, decision: 'not_evaluable', why: d.sufficiency.why, docs: d.sufficiency.docs }); continue; }
    const st = officialStatus(d, today); d.official = st;
    if (st.state === 'expired' || st.state === 'closed') { funnel[st.state === 'expired' ? 'expired' : 'closed_registry']++; trace.event('dossier', { key: d.key, id: d.id, url: d.url, decision: 'drop', reason: st.state, why: st.why, decided_by: 'code' }); continue; }
    live.push(d);
  }
  // 3 · Orden por tema y preselección.
  const textFor = (d) => `${d.meta?.purpose || ''} ${d.docs.map((x) => String(x.text || '').slice(0, 2500)).join(' ')}`;
  const scores = scoreDocs(live.map((d) => ({ title: d.title, text: textFor(d) })), terms.weights);
  live.forEach((d, i) => { d.score = scores[i].score; d.matched = scores[i].matched; d.mechanism = mechanismOf(d); d.lane = d.mechanism.parent ? 'mechanism' : d.sources.every((s) => s === 'web' || s === 'agent') ? 'web' : 'official'; });
  funnel.scored = live.length;
  live.sort((a, b) => b.score - a.score);
  const lanes = { official: live.filter((d) => d.lane === 'official'), mechanism: live.filter((d) => d.lane === 'mechanism'), web: live.filter((d) => d.lane === 'web') };
  const screenN = Number(env.ENGINE_DOSSIER_SCREEN_MAX) || 48;
  const screen = [...lanes.official.slice(0, screenN), ...lanes.web.slice(0, 16)];
  const fits = new Map();
  if (model && screen.length && String(env.ENGINE_DOSSIER_SHORTLIST ?? '1') !== '0') {
    const rows = screen.map((d) => ({ id: d.id, title: d.title, agency: d.agency, mechanism: d.mechanism.label, purpose: d.meta?.purpose || String(d.docs[0]?.text || '').slice(0, 400) }));
    const halves = rows.length > 26 ? [rows.slice(0, Math.ceil(rows.length / 2)), rows.slice(Math.ceil(rows.length / 2))] : [rows];
    let offset = 0; const outs = await Promise.all(halves.map((part) => { const at = offset; offset += part.length; return model(shortlistPrompt({ brief, rows: part, today }), 'judge', (raw) => ({ ok: Array.isArray(raw?.items), value: raw }), null, { maxTokens: Number(env.ENGINE_DOSSIER_SHORTLIST_MAX_TOKENS) || 3000, timeoutMs: Number(env.ENGINE_DOSSIER_SHORTLIST_TIMEOUT_MS) || 60_000 }).then((v) => ({ v, at })); }));
    for (const { v, at } of outs) for (const it of v?.items || []) { const d = screen[at + Number(it.n) - 1]; if (d && ['direct', 'possible', 'unrelated'].includes(it.fit)) fits.set(d.key, it.fit); }
    funnel.shortlist = { screened: screen.length, answered: fits.size, direct: [...fits.values()].filter((x) => x === 'direct').length, possible: [...fits.values()].filter((x) => x === 'possible').length, unrelated: [...fits.values()].filter((x) => x === 'unrelated').length };
    trace.event('dossier_shortlist', { ...funnel.shortlist, items: screen.map((d) => ({ key: d.key, id: d.id, score: d.score, fit: fits.get(d.key) || null })) });
  }
  const fitRank = (d) => ({ direct: 0, possible: 1 }[fits.get(d.key)] ?? (fits.size ? (fits.get(d.key) === 'unrelated' ? 3 : 2) : 1));
  const pick = (list, n) => list.filter((d) => fits.get(d.key) !== 'unrelated').sort((a, b) => fitRank(a) - fitRank(b) || b.score - a.score).slice(0, n);
  let selected = [...pick(lanes.official, capTopical), ...lanes.mechanism.slice(0, capMech), ...pick(lanes.web, capWeb)];
  if (selected.length < cap) { const rest = live.filter((d) => !selected.includes(d) && fits.get(d.key) !== 'unrelated').slice(0, cap - selected.length); selected = [...selected, ...rest]; }
  selected = selected.slice(0, cap);
  for (const d of live) if (!selected.includes(d)) trace.event('dossier', { key: d.key, id: d.id, url: d.url, decision: 'not_selected', lane: d.lane, score: d.score, fit: fits.get(d.key) || null });

  // 3b · Texto oficial completo del NIH para lo seleccionado: el registro (Simpler/Grants.gov) suele traer un resumen o un
  // pronóstico viejo; el aviso de la guía trae alcance, elegibilidad y fechas reales (runs-v7: 5 «pronósticos» con fecha estimada pasada).
  if (nihFetch) {
    const need = selected.filter((d) => d.id && /^(PA|PAR|PAS|RFA|NOT)-/.test(d.id) && !d.docs.some((x) => x.source === 'nih_guide' && x.textKind === 'full'));
    const capUp = Number(env.ENGINE_DOSSIER_NIH_FETCH_MAX) || 24;
    const got = await pool(need.slice(0, capUp), Number(env.ENGINE_DOSSIER_NIH_FETCH_CONCURRENCY) || 6, async (d) => ({ d, items: await nihFetch(d.id).catch(() => []) }));
    let added = 0;
    for (const { d, items: extra } of got) {
      if (!extra?.length) continue; added++;
      const [nd] = buildDossiers([...d.docs, ...extra]);
      Object.assign(d, { ...nd, key: d.key, score: d.score, matched: d.matched, lane: d.lane, mechanism: mechanismOf(nd) });
    }
    trace.event('dossier_upgrade', { stage: 'nih_full_text', needed: need.length, tried: Math.min(need.length, capUp), added });
    for (let i = selected.length - 1; i >= 0; i--) {
      const d = selected[i]; const st = officialStatus(d, today); d.official = st;
      if (st.state === 'expired' || st.state === 'closed') { funnel[st.state === 'expired' ? 'expired' : 'closed_registry']++; trace.event('dossier', { key: d.key, id: d.id, url: d.url, decision: 'drop', reason: st.state, why: st.why, decided_by: 'code' }); selected.splice(i, 1); }
    }
  }

  // 4 · Juez por expediente.
  const facts = applicantFacts(brief); const termList = [...terms.weights.entries()].filter(([, w]) => w >= 0.8).map(([t]) => t).slice(0, 12);
  const judged = await pool(selected, concurrency, async (d) => {
    const text = evidenceText(d, { terms: termList });
    const prompt = dossierJudgePrompt({ objective, brief, dossier: d, text, today, criteriaIds: ids });
    const raw = await model(prompt, 'judge', (r) => ({ ok: validJudgment(r, ids), value: r }), d.id || d.key, { maxTokens: Number(env.ENGINE_DOSSIER_JUDGE_MAX_TOKENS) || 2600 });
    return { d, text, raw };
  });
  const findings = []; const decisions = [];
  for (const { d, text, raw } of judged) {
    funnel.judged++;
    if (!raw) { funnel.judge_failed++; trace.event('dossier', { key: d.key, id: d.id, url: d.url, decision: 'judge_failed' }); continue; }
    const { judgment, conditions } = gateApplicant(raw, facts, text);
    const audit = auditPage({ objective, page: { url: d.url, title: d.title, text }, today, compilation: null, judgment, failure: { compiler: 'not_used_in_dossier_mode' }, blind: true, criteriaIds: ids });
    const out = classify({ d, audit, conditions, facts, today, text });
    decisions.push({ key: d.key, id: d.id, ...out.decision });
    trace.event('decision', { page_ref: d.id || d.key, by: 'judge', verdict: out.drop ? 'drop' : out.tier === 'main' ? 'keep' : 'verify', reason: out.drop || (out.tier === 'main' ? 'audited' : 'conditional'), page_type: audit.pageType?.judge || 'other', dates: audit.dates?.judge || [], criteria: audit.criteria, days_left: out.daysLeft, next_action: null });
    trace.event('dossier', { key: d.key, id: d.id, url: d.url, decision: out.drop ? 'drop' : out.tier, reason: out.drop, decided_by: 'judge', lane: d.lane, score: d.score, fit: fits.get(d.key) || null, state: out.state, deadline: out.deadline, deadline_source: out.deadlineSource, topic: audit.criteria.topic_fit?.verdict, conditions: conditions.map((c) => c.criterion), sources: d.sources, sufficiency: d.sufficiency.level });
    if (out.drop) { funnel.dropped[out.drop] = (funnel.dropped[out.drop] || 0) + 1; continue; }
    findings.push(toFinding({ d, audit, out, conditions, objective, facts }));
  }
  findings.sort((a, b) => (a.tier === 'main' ? 0 : 1) - (b.tier === 'main' ? 0 : 1) || TOPIC_RANK[a.fit.topic] - TOPIC_RANK[b.fit.topic] || STATE_RANK[a.status] - STATE_RANK[b.status] || String(a.deadline || '9999').localeCompare(String(b.deadline || '9999')) || b.dossier.score - a.dossier.score);
  funnel.kept = findings.length; funnel.pertinent = findings.filter((f) => f.fit.topic === 'yes').length;
  funnel.open = findings.filter((f) => f.status === 'open' || f.status === 'upcoming').length; funnel.forecast = findings.filter((f) => f.status === 'forecast').length;
  funnel.conditional = findings.filter((f) => f.conditions.length).length; funnel.ready = findings.filter((f) => f.tier === 'main').length;
  funnel.ms = Date.now() - t0;
  return { findings, funnel, decisions, facts, statusLine: statusLine(funnel, facts) };
}

/** Estado, fecha, descarte y nivel de un expediente juzgado. */
const LOI_REQUIRED = /(?:letters? of intent|LOIs?)[^.]{0,80}\b(?:is|are) (?:required|mandatory)\b|must (?:first )?submit (?:a|an) (?:letter of intent|LOI)|(?:letter of intent|LOI) \(required\)|by invitation only|invited (?:to submit )?(?:a )?full (?:application|proposal)s? only/i;
const LOI_OPTIONAL = /(?:letters? of intent|LOIs?)[^.]{0,80}\b(?:is|are) (?:not required|not mandatory|optional|encouraged|requested but not required)\b/i;
export function classify({ d, audit, conditions, facts, today, text = '' }) {
  let state = audit.state; let deadline = audit.deadline; let deadlineQuote = audit.deadlineQuote; let deadlineSource = audit.deadline ? 'judge' : null;
  const nih = nihNextDue(d, today);
  // Un aviso ACTIVO de la guía del NIH no es un pronóstico aunque el juez lo lea así; uno del registro en «forecasted» sí lo es.
  const nihActive = d.docs.some((x) => x.source === 'nih_guide' && x.textKind === 'full') && /^(active|published)/.test(String(d.meta?.status || '').toLowerCase());
  if (d.official?.state === 'forecast') state = 'forecast';
  else if (nih && (state !== 'forecast' || nihActive)) { state = nih.date >= today ? 'open' : state; deadline = nih.date; deadlineQuote = nih.quote || (nih.standard ? 'Standard dates apply' : deadlineQuote); deadlineSource = nih.source; }
  if (state === 'open' && d.meta?.opens && d.meta.opens > today) state = 'upcoming';
  const judgeDrop = audit.dropReason && audit.dropReason !== 'closed' ? audit.dropReason : null;
  // Carta de intención obligatoria y ya vencida: la propuesta completa sigue abierta solo para quien envió la carta (AARGA, RD-04).
  const lois = (audit.dates?.judge || []).filter((x) => x.role === 'loi_deadline' && x.verified && !x.estimated && x.date);
  const loiClosed = lois.length > 0 && lois.every((x) => x.date < today) && LOI_REQUIRED.test(text) && !LOI_OPTIONAL.test(text) && (state === 'open' || state === 'upcoming');
  const drop = state === 'closed' ? 'closed' : loiClosed ? 'loi_closed' : judgeDrop;
  const topic = audit.criteria.topic_fit?.verdict || 'unknown';
  const dateBlockers = /deadline|application dates|before today|Forecast notice|not open yet|not as a call/i;
  const blockers = (audit.blockers || []).filter((b) => !(deadline && state === 'open' && dateBlockers.test(b)) && !/Compiler unavailable/.test(b));
  if (state === 'forecast') {
    if (!blockers.some((b) => /Forecast/.test(b))) blockers.push('Forecast: applications are not being solicited yet');
    if (d.meta?.forecastClose && d.meta.forecastClose < today) blockers.push(`Registry forecast is out of date: its estimated close date ${d.meta.forecastClose} has passed and no published notice was found; check the agency before planning`);
  }
  if (facts.missing.length) { for (let i = blockers.length - 1; i >= 0; i--) if (/^Eligibility not confirmed/.test(blockers[i])) blockers.splice(i, 1); blockers.push(`Applicant facts not confirmed in the brief: ${facts.missing.join(', ')}`); }
  const tier = !drop && state === 'open' && topic === 'yes' && audit.criteria.eligibility?.verdict === 'yes' && blockers.length === 0 ? 'main' : 'verify';
  const daysLeft = deadline && (state === 'open' || state === 'upcoming') ? daysBetween(today, deadline) : null;
  const nextLoi = lois.filter((x) => x.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0] || null;
  return { state, deadline: state === 'open' || state === 'upcoming' ? deadline : null, deadlineQuote, deadlineSource, loiDeadline: nextLoi?.date || null, loiQuote: nextLoi?.quote || null, estimatedDeadline: audit.estimatedDeadline || null, drop, topic, blockers, tier, daysLeft,
    decision: { state, deadline, deadline_source: deadlineSource, drop, topic, tier, conditions: conditions.map((c) => ({ criterion: c.criterion, kind: c.kind, quote: clip(c.quote, 200) })) } };
}

function toFinding({ d, audit, out, conditions, objective, facts }) {
  const c = audit.criteria;
  const eligible = conditions.length ? 'conditional' : c.eligibility?.verdict === 'yes' ? 'yes' : c.eligibility?.verdict === 'no' ? 'no' : 'unclear';
  const conditionText = conditions.map((x) => `${x.kind === 'restriction' ? 'Restriction' : 'Requirement'} (${x.criterion}): ${x.quote ? `“${clip(x.quote, 220)}”` : clip(x.reason, 200)}`);
  return {
    objective, url: d.url, title: d.title, name: d.title, call_id: d.id, query: d.docs[0]?.query || 'dossier', family: 'dossier', providers: d.sources, model: null, keep: true, drop: null,
    status: out.state, deadline: out.deadline, daysLeft: out.daysLeft, deadlineSource: out.deadlineSource, ...(out.loiDeadline ? { loiDeadline: out.loiDeadline } : {}), ...(out.state === 'forecast' ? { forecast: true, estimatedDeadline: out.estimatedDeadline } : {}),
    eligible, nonDilutive: c.non_dilutive?.verdict || 'unknown', amount: null, pageType: { type: audit.pageType?.judge || 'other' }, read_contract: 'dossier',
    quotes: { identity: d.title, ...(out.deadlineQuote ? { deadline: out.deadlineQuote } : {}), ...(out.loiQuote ? { loi: out.loiQuote } : {}), ...(c.topic_fit?.quote ? { topic: c.topic_fit.quote } : {}), ...(conditions[0]?.quote ? { eligible: conditions[0].quote } : c.eligibility?.quote ? { eligible: c.eligibility.quote } : {}) },
    tier: out.tier, verdict: out.tier === 'main' ? 'apply' : 'watch', flags: audit.flags || [], blockers: out.blockers, conditions: conditionText,
    fit: { topic: out.topic, reason: clip(c.topic_fit?.reason, 300), applicant_missing: facts.missing },
    mechanism: d.mechanism?.label || null, lane: d.lane,
    dossier: { id: d.id, key: d.key, sources: d.sources, urls: d.urls.slice(0, 6), sufficiency: d.sufficiency.level, score: d.score },
    reasons: [], trace: { queries: [...new Set(d.docs.map((x) => x.query).filter(Boolean))].map((q) => ({ query: q, family: 'dossier' })) },
  };
}

/** Una línea que no maquilla el resultado. */
export function statusLine(f, facts) {
  const found = `${f.dossiers} convocatorias distintas (${Object.entries(f.by_source).map(([k, v]) => `${k} ${v}`).join(', ')})`;
  const judged = `${f.judged} juzgadas${f.judge_failed ? ` (${f.judge_failed} sin juicio)` : ''}`;
  const cut = [f.expired ? `${f.expired} vencidas` : '', f.closed_registry ? `${f.closed_registry} cerradas` : '', f.not_evaluable ? `${f.not_evaluable} sin texto suficiente` : ''].filter(Boolean).join(', ');
  const drops = Object.entries(f.dropped).map(([k, v]) => `${k} ${v}`).join(', ');
  const core = `${found} → ${cut ? `${cut}; ` : ''}${judged}${drops ? ` (descartes: ${drops})` : ''} → ${f.pertinent} pertinentes por tema, ${f.open} con fecha abierta, ${f.forecast} en pronóstico.`;
  const tail = f.ready ? ` ${f.ready} listas para aplicar.` : facts.missing.length ? ` Ninguna lista para aplicar: el brief no confirma ${facts.missing.join(', ')}; la elegibilidad queda condicionada.` : ' Ninguna lista para aplicar.';
  return `${core}${tail}`;
}

export { DOSSIER_CRITERION_HELP };
