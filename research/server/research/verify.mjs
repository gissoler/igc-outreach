/* ─────────────────────────────────────────────────────────────────────────────
   Verificación en código de lo que el modelo lee de una página de convocatoria.
   Regla de oro: el modelo EXTRAE, el código DECIDE.
     · la fecha límite la elige el código sobre el texto COMPLETO de la página (dates.mjs): fases (LOI,
       pre-propuesta, propuesta por invitación), varios cortes, rangos, "rolling", ediciones anteriores;
       la cita de la fecha es un trozo literal de la página y la fecha de hoy la pone el código
     · el estado (abierta / cerrada / próxima) se calcula contra HOY, nunca lo dice el modelo
     · tipo de página (pageType.mjs): informes, blogs, noticias, cohortes, eventos y directorios no son convocatorias
     · elegibilidad (applicant.mjs): quién puede postular, contrastado con el brief (startup con fines de lucro)
     · agregadores, redes sociales y blogs de listas no son fuente oficial → se descartan
   Niveles: tier 'main' (lista principal: vigencia Y elegibilidad verificadas), 'verify' (a verificar), 'drop'.
   Sin red, sin dependencias: se prueba con páginas guardadas.
   ───────────────────────────────────────────────────────────────────────────── */
import { norm } from './core.mjs';
import { datesIn as parseAllDates, deadlineDecision, daysBetween, todayIso } from './dates.mjs';
import { classifyPage } from './pageType.mjs';
import { applicantProfile, checkApplicant } from './applicant.mjs';

/** Todas las fechas completas (con año) de un texto, como YYYY-MM-DD (formatos y idiomas de dates.mjs). */
export const datesIn = parseAllDates;

/** ¿La cita aparece tal cual en la página? (sin distinguir mayúsculas, espacios ni markdown) */
export function literalIn(quote, pageText) {
  const strip = (v) => norm(String(v || '').replace(/[*_`#>|\[\]()]/g, ' ')).replace(/\s+/g, ' ').trim();
  const q = strip(quote);
  return q.length >= 8 && strip(pageText).includes(q);
}

const SOCIAL = /(^|\.)(linkedin\.com|facebook\.com|instagram\.com|x\.com|twitter\.com|youtube\.com|tiktok\.com|reddit\.com|medium\.com|substack\.com|quora\.com|crunchbase\.com|pitchbook\.com|glassdoor\.com)$/i;
const AGGREGATORS = /(^|\.)(startupgrantsindia\.com|fundsforngos\.org|fundsforcompanies\.com|fundsforindividuals\.com|opportunitydesk\.org|opportunitiesforafricans\.com|grantwatch\.com|grants\.gov\.in|vestbee\.com|f6s\.com|startupticker\.ch|dealroom\.co|eu-startups\.com|tech\.eu|startus-insights\.com|growthlist\.co|startupstash\.com|beststartup\.org|grantforward\.com|instrumentl\.com|grantstation\.com|opportunities-for-youth\.org|youthop\.com|scholarshipdb\.net)$/i;
// Directorios, marketplaces y blogs de listas: nunca son la fuente oficial (lista heurística; ampliarla cuando aparezcan más).
const AGGREGATORS_EXTRA = /(^|\.)(grantedai\.com|grantcompass\.ca|founderstoday\.org|access2eic\.eu|rasph\.com|freemindgroup\.com|grants\.ai|grantify\.io|fundingforgood\.org|roundfunded\.com|hellodarwin\.com|ellty\.com|spinverse\.com|wellfound\.com|angel\.co|tracxn\.com|cbinsights\.com|seedtable\.com|failory\.com|signal\.nfx\.com|openvc\.app|visible\.vc|gust\.com)$/i;
const DIRECTORY_PATH = /^https?:\/\/(www\.)?ycombinator\.com\/(companies|library)/i;
export const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };
export const hostKind = (url) => { const h = hostOf(url); return SOCIAL.test(h) ? 'social' : AGGREGATORS.test(h) || AGGREGATORS_EXTRA.test(h) || DIRECTORY_PATH.test(String(url)) ? 'aggregator' : 'other'; };

const CLOSED_RX = /\b(applications?\s+(?:are\s+|is\s+)?closed|call\s+(?:is\s+)?closed|now\s+closed|submissions?\s+(?:are\s+)?closed|registration\s+(?:is\s+)?closed|no\s+longer\s+accepting)\b/i;
const OPEN_RX = /\b(applications?\s+(?:are\s+|is\s+)?(?:now\s+)?open|now\s+accepting|accepting\s+applications|rolling\s+(?:basis|applications?|admission)|open\s+call|apply\s+now)\b/i;
/** Dinero que hay que devolver o que pide participación: no es un grant no dilutivo. */
const DILUTIVE_RX = /\b(mission-related investments?|requires? (?:a )?return on investment|convertible (?:note|loan|equity)|in exchange for (?:an? )?(?:equity|stake)|equity (?:stake|investment) in|repayable (?:loan|advance|grant)|must be repaid|soft loans?|royalt(?:y|ies) on (?:sales|revenue)|revenue[- ]share agreement)\b/i;
const ISO_RX = /^\d{4}-\d{2}-\d{2}$/;

/** Verificación antigua para entidades (inversores, prestamistas, partners): sin fechas ni fases. */
function verifyEntity(out, page, { today } = {}) {
  const text = String(page?.text || ''); const flags = []; const kind = hostKind(page?.url);
  const q = out?.quotes && typeof out.quotes === 'object' ? out.quotes : {}; const quotes = {};
  for (const key of ['status', 'deadline', 'eligible']) {
    const v = typeof q[key] === 'string' ? q[key].trim() : '';
    if (!v || /^(null|none|n\/a|unknown)$/i.test(v)) continue;
    if (literalIn(v, text)) quotes[key] = v; else flags.push(`fake_quote:${key}`);
  }
  const official = Boolean(out?.official) && kind === 'other';
  const eligible = ['yes', 'no', 'unclear'].includes(String(out?.eligible)) ? String(out.eligible) : 'unclear';
  const nonDilutive = ['yes', 'no', 'unknown'].includes(String(out?.non_dilutive)) ? String(out.non_dilutive) : 'unknown';
  if (eligible !== 'unclear' && !quotes.eligible) flags.push('eligibility_without_quote');
  let drop = null;
  if (kind === 'social') drop = 'social_host';
  else if (kind === 'aggregator') drop = 'aggregator';
  else if (eligible === 'no' && quotes.eligible) drop = 'not_eligible';
  else if (!official) drop = 'not_official';
  return { keep: !drop, drop, status: 'unknown', deadline: null, official, eligible: eligible === 'no' && !quotes.eligible ? 'unclear' : eligible, nonDilutive, verdict: drop ? 'skip' : 'watch', tier: drop ? 'drop' : 'verify', flags, quotes, daysLeft: null, today: todayIso(today), checks: [], reasons: drop ? [drop] : [] };
}

/**
 * Convierte la salida del modelo (o nada: `out = {}` en modo solo-código) en un hecho verificado.
 * @param out   JSON del modelo {status, deadline, official, eligible, non_dilutive, kind, page_type, quotes}
 * @param page  {url, title, text}
 * @param opts  {today, brief, profile, entity, codeOnly}
 * @returns {{keep, drop, status, deadline, deadlineQuote, official, eligible, eligibility, nonDilutive, verdict, tier, flags, quotes, daysLeft, pageType, dates, checks, reasons, today}}
 */
export function verifyOpportunity(out, page, { today, brief, profile, entity = false, codeOnly = false } = {}) {
  if (entity) return verifyEntity(out, page, { today });
  const now = todayIso(today);
  const text = String(page?.text || '');
  const flags = [];
  const checks = [];
  const check = (name, ok, detail, quote = '') => checks.push({ check: name, ok, detail, ...(quote ? { quote: String(quote).slice(0, 300) } : {}) });
  const kind = hostKind(page?.url);
  const q = out?.quotes && typeof out.quotes === 'object' ? out.quotes : {};
  const quotes = {};
  for (const key of ['status', 'deadline', 'eligible', 'how_to_apply']) {
    const v = typeof q[key] === 'string' ? q[key].trim() : '';
    if (!v || /^(null|none|n\/a|unknown)$/i.test(v)) continue;
    if (literalIn(v, text)) quotes[key] = v; else flags.push(`fake_quote:${key}`);
  }
  check('host', kind === 'other', kind === 'other' ? 'Own site (not an aggregator or social network)' : `${kind} host`);

  // 1) Tipo de página
  const pageType = classifyPage({ url: page?.url, title: page?.title, text, modelKind: out?.kind, modelPageType: out?.page_type });
  check('page_type', pageType.isCall, pageType.reason, pageType.applyQuote);

  // 2) Fechas: decide el código sobre el texto completo; lo del modelo solo se contrasta
  const claimed = ISO_RX.test(String(out?.deadline || '')) ? String(out.deadline) : null;
  const dd = deadlineDecision(text, { today: now, claimed, title: page?.title, url: page?.url });
  flags.push(...dd.flags);
  if (claimed) {
    if (!quotes.deadline) flags.push('deadline_without_quote');
    else if (!datesIn(quotes.deadline).includes(claimed)) flags.push('deadline_not_in_quote');
    if (dd.deadline && claimed !== dd.deadline) flags.push('deadline_conflict');
  }
  let deadline = dd.deadline || null;
  let status = dd.status === 'rolling' ? 'open' : dd.status;
  if (dd.status === 'rolling') flags.push('rolling', 'open_without_deadline');
  if (deadline && daysBetween(now, deadline) > 365 * 3) { flags.push('deadline_implausible'); deadline = null; status = 'unknown'; }
  if (dd.inferredYear) flags.push('deadline_year_inferred');
  const modelStatus = String(out?.status || 'unknown').toLowerCase();
  if (modelStatus === 'open' && status === 'unknown') flags.push('open_claim_unsupported');
  if (modelStatus === 'not_a_call') status = 'not_a_call';
  const deadlineQuote = dd.quote || '';
  if (deadline) quotes.deadline = deadlineQuote;
  check('deadline', status === 'open' && Boolean(deadline), `${dd.reason} (today ${now})`, deadlineQuote);

  // 3) Elegibilidad del solicitante contra el brief (el "yes" del modelo nunca basta)
  const prof = profile || applicantProfile(brief || {});
  const eligibility = checkApplicant(text, prof, { modelQuote: quotes.eligible || '' });
  flags.push(...eligibility.flags);
  const modelEligible = String(out?.eligible || 'unclear');
  if (modelEligible === 'yes' && eligibility.decision !== 'yes') flags.push('model_eligibility_overruled');
  if (['yes', 'no'].includes(modelEligible) && !quotes.eligible) flags.push('eligibility_without_quote');
  // Un "no" del modelo con cita literal se respeta (es el lado seguro), y queda marcado para revisarlo en la traza.
  const modelNo = modelEligible === 'no' && Boolean(quotes.eligible);
  if (modelNo && eligibility.decision !== 'no') flags.push('model_not_eligible');
  const eligible = modelNo ? 'no' : eligibility.decision;
  if (modelNo && eligibility.decision !== 'no') { eligibility.decision = 'no'; eligibility.reason = `The AI read says not eligible: "${quotes.eligible.slice(0, 160)}"`; eligibility.quote = quotes.eligible; }
  if (eligible !== 'unclear') quotes.eligible = eligibility.quote;
  check('eligibility', eligible === 'yes', eligibility.reason, eligibility.quote);

  // 4) No dilutivo
  const nonDilutive = ['yes', 'no', 'unknown'].includes(String(out?.non_dilutive)) ? String(out.non_dilutive) : 'unknown';
  const dil = DILUTIVE_RX.exec(text);
  if (dil) flags.push('may_require_return');
  check('non_dilutive', nonDilutive !== 'no' && !dil, dil ? `Page mentions "${dil[0]}"` : nonDilutive === 'no' ? 'Model: equity or loan' : 'No sign of equity or repayment');

  // 5) Oficial: el modelo lo dice y el host no es agregador; en modo solo-código no se puede afirmar
  const official = codeOnly ? kind === 'other' : Boolean(out?.official) && kind === 'other';
  if (codeOnly) flags.push('read_without_model');
  check('official', official, codeOnly ? 'Not checked by a model read (code only)' : official ? 'Published by the program or its organizer' : 'Not the official source');

  // 6) Decisión. Orden: host → no es convocatoria según el modelo → plazo vencido (fecha explícita) → tipo de página →
  //    edición anterior/marcada cerrada → no elegible → dilutivo → no oficial.
  const closedStrong = status === 'closed' && ['deadline', 'loi', 'registration', 'closed_marker'].includes(dd.phase);
  const reasons = [];
  if (kind !== 'other') reasons.push(kind === 'social' ? 'social_host' : 'aggregator');
  if (status === 'not_a_call') reasons.push('not_a_call');
  if (closedStrong) reasons.push('closed');
  if (!pageType.isCall && !pageType.soft) reasons.push(`not_a_call:${pageType.type}`);
  if (status === 'closed' && !closedStrong) reasons.push('closed');
  if (eligible === 'no') reasons.push('not_eligible');
  if (nonDilutive === 'no') reasons.push('equity_or_loan');
  if (!official && !codeOnly) reasons.push('not_official');
  const drop = reasons[0] === 'social_host' ? 'social_host' : reasons[0] || null;

  const blockers = [
    !pageType.isCall && (pageType.soft ? 'Call posted as news: confirm on the program page' : null),
    status !== 'open' ? (status === 'upcoming' ? `Not open yet${dd.opens ? ` (opens ${dd.opens})` : ''}` : 'Deadline not verified on the page') : null,
    status === 'open' && !deadline ? 'Rolling / no dated deadline' : null,
    dd.inferredYear ? 'Deadline year inferred, not written' : null,
    eligible !== 'yes' ? `Eligibility unconfirmed: ${eligibility.reason}` : null,
    flags.some((f) => f.startsWith('fake_quote')) ? 'The model invented a quote' : null,
    flags.includes('model_date_not_in_page') ? 'The model gave a date that is not on the page' : null,
    flags.includes('deadline_conflict') ? 'Model and page disagree on the deadline' : null,
    flags.includes('closed_marker_conflict') ? 'Page also says it is closed' : null,
    flags.includes('ambiguous_deadline') ? 'Deadline written as an ambiguous dd/mm date' : null,
    dil ? `Funding may require a return ("${dil[0]}")` : null,
    codeOnly ? 'Not read by the AI model' : null,
  ].filter(Boolean);
  const tier = drop ? 'drop' : blockers.length ? 'verify' : 'main';
  const verdict = tier === 'drop' ? 'skip' : tier === 'main' ? 'apply' : 'watch';
  return {
    keep: !drop, drop, status, deadline, deadlineQuote: deadline ? deadlineQuote : '', official, eligible, eligibility, nonDilutive, verdict, tier,
    flags: [...new Set(flags)], quotes, daysLeft: deadline ? daysBetween(now, deadline) : null, today: now,
    pageType: { type: pageType.type, isCall: pageType.isCall, reason: pageType.reason, applyQuote: pageType.applyQuote, ...(pageType.soft ? { soft: true } : {}) },
    dates: { status: dd.status, phase: dd.phase, reason: dd.reason, quote: dd.quote, ...(dd.opens ? { opens: dd.opens } : {}), ...(dd.approx ? { approx: dd.approx, precision: dd.precision } : {}), claimed, milestones: dd.milestones.slice(0, 14) },
    checks, reasons, blockers,
  };
}
/** Forma compacta de una verificación para guardarla en un lead (la UI la muestra en el detalle). */
export function compactVerification(v, extra = {}) {
  return {
    verdict: v.verdict, tier: v.tier || (v.verdict === 'apply' ? 'main' : v.verdict === 'skip' ? 'drop' : 'verify'), status: v.status, eligible: v.eligible, daysLeft: v.daysLeft ?? null, flags: v.flags || [], today: v.today,
    deadlineQuote: v.deadlineQuote || '', blockers: v.blockers || [], reasons: v.reasons || (v.drop ? [v.drop] : []), ...(v.drop ? { drop: v.drop } : {}),
    ...(v.eligibility ? { eligibility: { decision: v.eligibility.decision, reason: v.eligibility.reason, quote: v.eligibility.quote, types: v.eligibility.types, countries: v.eligibility.countries } } : {}),
    ...(v.pageType ? { pageType: v.pageType } : {}),
    ...(v.dates ? { dates: { status: v.dates.status, phase: v.dates.phase, reason: v.dates.reason, quote: v.dates.quote, opens: v.dates.opens || null, milestones: (v.dates.milestones || []).slice(0, 8) } } : {}),
    ...(v.checks ? { checks: v.checks } : {}),
    ...extra,
  };
}
export { CLOSED_RX, OPEN_RX };
