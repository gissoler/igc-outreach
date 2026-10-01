/* ────────────────────────────────────────────────────────────────────────
   Verificación en código de un inversor o fondo (objetivo `investment`).
   El modelo extrae; el código decide. Lo que el modelo dice de `official`, `eligible` o `how_to_apply` no basta:
     · página propia del inversor (no nota de prensa, blog, informe, directorio ni plataforma de sindicatos)
     · tesis: una frase LITERAL de la página que une inversión + sector del brief, y otra con etapa (pre-seed/seed…)
     · geografía: si la página restringe a una región donde la empresa no está constituida → no elegible
     · vía para contactar o postular: una frase literal con verbo de acción (no un menú de navegación)
     · actividad reciente: un año reciente escrito en la página
   Sin algo de esto el inversor queda «a verificar» con el bloqueo a la vista; nunca `apply`.
   ──────────────────────────────────────────────────────────────────────── */
import { classifyPage } from './pageType.mjs';
import { applicantProfile, checkApplicant } from './applicant.mjs';
import { todayIso } from './dates.mjs';
import { plain, literalIn } from './verify.mjs';

const PLATFORM = /(^|\.)(angellist\.com|wellfound\.com|republic\.co|seedinvest\.com|wefunder\.com|crowdcube\.com|seedrs\.com|gust\.com|f6s\.com|dealroom\.co|tracxn\.com|cbinsights\.com|openvc\.app|signal\.nfx\.com|vcsheet\.com|visible\.vc)$/i;
export const NEWSHOST = /(^|\.)(prnewswire\.com|businesswire\.com|globenewswire\.com|prweb\.com|accesswire\.com|techcrunch\.com|venturebeat\.com|fiercehealthcare\.com|mobihealthnews\.com|finsmes\.com|eu-startups\.com|tech\.eu|axios\.com|forbes\.com|startuprise\.io|healthcaredive\.com|beckershospitalreview\.com)$/i;
const DOC_PATH = /\/wp-content\/uploads\/|\.pdf(?:$|\?)|\/reports?\/|\/whitepapers?\//i;

const flat = plain;   // misma forma que usa literalIn: toda cita sale de aquí y es literal en la página
const sentencesOf = (t) => flat(t).split(/(?<=[.!?])\s+(?=[A-Z0-9“"'(])/).map((x) => x.trim()).filter((x) => x.length >= 25 && x.length <= 350 && !/!\s|https?:\/\//.test(x));

const INVEST = /\b(invest(?:s|ed|ing|ment|ments|or|ors)?|back(?:s|ed|ing)?|fund(?:s|ed|ing)?|portfolio|venture|capital|check size|first check|lead(?:s|ing)? (?:rounds?|seed)|partner with founders|support(?:s|ing)? (?:early[- ]stage )?founders)\b/i;
const INVEST_STRONG = /\b(invest(?:s|ed|ing|ment|ments|or|ors)?|back(?:s|ed|ing)? (?:founders|startups|companies|teams|entrepreneurs)|portfolio|our focus|we focus|fund(?:s|ing)? (?:founders|startups|companies)|first check|check size)\b/i;
const STAGE = /\b(pre-?seed|seed(?:[- ]stage)?|early[- ]stage|first[- ]check|angel|series a|idea[- ]stage)\b/i;
const LATE_ONLY = /\b(growth[- ]stage|growth equity|late[- ]stage|series [c-f]\b|pre-?ipo|buyouts?)\b/i;
const ACTION = /\b(pitch us|submit (?:a |your |an )?(?:pitch|deck|company|startup|application|proposal)|apply (?:for funding|to (?:us|our)|now|here|today)|get in touch (?:with us|to|at|via)|contact us (?:at|to|if|via|with|by)|reach out (?:to us|at|via)|send (?:us )?(?:your )?(?:deck|pitch)|email (?:us|your (?:deck|pitch))|how to (?:pitch|apply|reach)|(?:pitch|invest|info|hello|founders|submissions)@[\w.-]+)/i;
const RECENT_YEAR = /\b(20(?:25|26))\b/;

/** Términos del sector a partir del brief. Con salud mental/bienestar se añaden sinónimos de uso común en tesis de fondos. */
export function sectorTerms(brief = {}) {
  const base = `${brief.industry || ''} ${brief.product || ''}`.toLowerCase();
  const terms = new Set();
  if (/mental|wellness|well-?being|behavio|psych|neuro/.test(base)) for (const t of ['mental health', 'mental wellness', 'behavioral health', 'behavioural health', 'digital health', 'healthtech', 'health tech', 'wellbeing', 'well-being', 'wellness', 'neuro', 'psychiatr', 'psycholog', 'digital therapeutics', 'therapeutics']) terms.add(t);
  else if (/health|medic|bio|pharma/.test(base)) for (const t of ['digital health', 'healthtech', 'health tech', 'healthcare', 'life sciences', 'biotech']) terms.add(t);
  const GENERIC = new Set(['health', 'digital', 'platform', 'technology', 'technologies', 'services', 'solutions', 'software', 'global', 'online', 'mobile']);
  for (const w of String(brief.industry || '').toLowerCase().split(/[^a-z]+/)) if (w.length >= 5 && !GENERIC.has(w)) terms.add(w);
  return [...terms];
}

/** ¿Alguna restricción geográfica explícita excluye a la empresa? Reusa el lector de países de applicant.mjs. */
function geographyCheck(text, profile) {
  const r = checkApplicant(text, profile);
  if (r.decision === 'no' && /^Restricted to|country|region/i.test(r.reason)) return { verdict: 'no', quote: r.quote, reason: r.reason };
  const open = /\b(invest(?:s|ing)? (?:globally|worldwide|around the world|across the world|in any country|in all countries|anywhere)|(?:we are|we're|is) an? (?:global|international|borderless) (?:fund|investor|firm|venture)|(?:globally|worldwide|around the world|any country|all countries)\b[^.]{0,40}\b(?:founders|startups|companies)|\b(?:founders|startups|companies)\b[^.]{0,40}\b(?:globally|worldwide|around the world|in any country|from any country))/i.exec(flat(text));
  if (open) return { verdict: 'open', quote: sentencesOf(text).find((s) => s.toLowerCase().includes(open[0].toLowerCase())) || open[0] };
  return { verdict: 'unknown', quote: '' };
}

/**
 * @param page   {url, title, text}
 * @param opts   {today, brief, profile, out}   out = lectura del modelo (solo se usa para el tipo de página declarado)
 * @returns hecho verificado: {drop, tier, verdict, eligible, official, quotes, checks, blockers, flags, reasons}
 */
export function verifyInvestor(out, page, { today, brief, profile } = {}) {
  const text = String(page?.text || ''); const url = String(page?.url || '');
  const host = (() => { try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } })();
  const now = todayIso(today);
  const prof = profile || applicantProfile(brief || {});
  const flags = []; const checks = []; const blockers = []; const reasons = [];
  const check = (name, ok, detail, quote = '') => checks.push({ check: name, ok, detail, ...(quote ? { quote: String(quote).slice(0, 300) } : {}) });
  const sents = sentencesOf(text);

  // 1) Página propia del inversor
  const platform = PLATFORM.test(host); const newsHost = NEWSHOST.test(host); const doc = DOC_PATH.test(url);
  const pt = classifyPage({ url, title: page?.title, text, modelKind: out?.kind, modelPageType: out?.page_type });
  const notInvestor = newsHost || ['news', 'blog', 'report'].includes(pt.type);
  check('page', !notInvestor && !platform && !doc, notInvestor ? `Not the investor's page (${newsHost ? 'news/press host' : pt.type})` : platform ? 'Hosted on a syndicate/listing platform' : doc ? 'A document (PDF or report), not the investor\'s page' : 'Investor\'s own page');
  if (notInvestor) reasons.push(`not_investor_page:${newsHost ? 'news' : pt.type}`);
  if (platform) blockers.push('Hosted on a platform: confirm on the investor\'s own site');
  if (doc) blockers.push('A document, not the investor\'s own page');

  // 2) Tesis: sector del brief + inversión, y etapa
  const terms = sectorTerms(brief || {});
  const hasTerm = (s) => terms.some((t) => new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(s));
  const thesis = sents.find((s) => INVEST_STRONG.test(s) && hasTerm(s));
  const stage = sents.find((s) => INVEST.test(s) && STAGE.test(s));
  const lateOnly = !stage && sents.find((s) => INVEST.test(s) && LATE_ONLY.test(s));
  check('thesis', Boolean(thesis), thesis ? 'The page ties the investor\'s focus to the venture\'s sector' : 'No sentence on the page ties investing to the venture\'s sector', thesis || '');
  check('stage', Boolean(stage), stage ? 'The page mentions early-stage / pre-seed / seed investing' : lateOnly ? 'The page points to later stages' : 'The page does not state a stage', stage || lateOnly || '');
  if (!thesis) blockers.push('Focus on the venture\'s sector not stated on the page');
  if (!stage) blockers.push(lateOnly ? `Stage looks later than the venture's (${round(prof, brief)}): "${lateOnly.slice(0, 120)}"` : 'Investment stage not stated on the page');
  if (lateOnly) flags.push('stage_mismatch');

  // 3) Geografía frente al brief
  const geo = geographyCheck(text, prof);
  check('geography', geo.verdict !== 'no', geo.verdict === 'no' ? `Invests only where the venture is not incorporated: ${geo.reason}` : geo.verdict === 'open' ? 'The page says it invests globally' : 'Geography not stated on the page', geo.quote);
  if (geo.verdict === 'no') reasons.push('not_eligible');
  else if (geo.verdict === 'unknown') blockers.push('Geography not stated: confirm the fund invests in companies incorporated outside the US/EU');

  // 4) Vía para contactar o postular: frase con verbo de acción, no un menú
  const pathSent = sents.find((s) => ACTION.test(s));
  const pm = pathSent && ACTION.exec(pathSent);
  const path = pathSent ? pathSent.slice(Math.max(0, pm.index - 60), Math.min(pathSent.length, pm.index + pm[0].length + 100)).trim() : '';
  check('contact_path', Boolean(path), path ? 'The page says how to pitch or get in touch' : 'No pitch or contact instruction found (a menu item is not one)', path || '');
  if (!path) blockers.push('No way to pitch or contact found on the page');

  // 5) Actividad reciente: un año reciente escrito en la página
  const yr = sents.find((s) => RECENT_YEAR.test(s) && /\b(invest\w*|portfolio|raised|led|lead|closed|announc\w*|fund|round|cohort|backed|joins?|new)\b/i.test(s));
  check('recent_activity', Boolean(yr), yr ? 'The page mentions 2025/2026' : 'No recent year on the page', yr || '');
  if (!yr) blockers.push('No sign of recent activity (no 2025/2026 on the page)');

  // 6) Elegibilidad del modelo: solo un «no» con cita literal se respeta
  const mq = typeof out?.quotes?.eligible === 'string' ? out.quotes.eligible.trim() : '';
  const modelNo = String(out?.eligible) === 'no' && mq && flat(text).toLowerCase().includes(flat(mq).toLowerCase());
  if (modelNo) reasons.push('not_eligible');
  if (String(out?.eligible) === 'yes') flags.push('model_eligibility_not_used');

  const official = !platform && !notInvestor && !doc && Boolean(out?.official) && !/^(aggregator|social)$/.test(String(out?.kind || ''));
  if (!official && !reasons.length) reasons.push('not_official');
  const eligible = reasons.includes('not_eligible') ? 'no' : thesis && stage && geo.verdict !== 'unknown' ? 'yes' : 'unclear';
  const drop = reasons[0] || null;
  const tier = drop ? 'drop' : blockers.length ? 'verify' : 'main';
  const verdict = tier === 'drop' ? 'skip' : tier === 'main' ? 'apply' : 'watch';
  const quotes = { ...(thesis ? { eligible: thesis } : {}), ...(path ? { how_to_apply: path } : {}), ...(stage ? { stage } : {}), ...(yr ? { recent: yr } : {}) };
  return { keep: !drop, drop, status: 'unknown', deadline: null, official, eligible, nonDilutive: 'unknown', verdict, tier, flags: [...new Set(flags)], quotes, daysLeft: null, today: now, checks, reasons, blockers, investor: true };
}

const round = (prof, brief) => String(brief?.round || brief?.stage || 'early');
