/* ─────────────────────────────────────────────────────────────────────────────
   ¿Esta página ES la convocatoria (con vía para postular)? Lo decide el CÓDIGO con señales de la URL y del
   texto; el tipo que dice el modelo solo suma. Informes, blogs, noticias, anuncios de cohorte, eventos/talleres
   y directorios nunca son una convocatoria, aunque el modelo diga "program".
   ───────────────────────────────────────────────────────────────────────────── */
import { flat } from './dates.mjs';

const PATH = [
  ['report', /\/(impact-?reports?|annual-?reports?|reports?|publications?|white-?papers?|case-stud(?:y|ies))(\/|$|-)|impact-report|annual-report|\/doi\/(?:abs\/|full\/|pdf\/)?10\.\d{4,}|pubmed\.ncbi|policy-?briefs?|fact-?sheets?|white-?papers?/i],
  ['blog', /\/(blogs?|posts?|stories|story|insights?|articles?|magazine|perspectives?|opinion|voices|podcasts?)(\/|$)|\/20\d{2}\/\d{2}\/(?:\d{2}\/)?[a-z0-9-]{8,}/i],   // incluye /2026/06/02/slug (WordPress)
  ['news', /\/(news|newsroom|press|press-releases?|media-releases?|media-cent(?:er|re)|mediacentre|updates\/news|noticias|actualidad|comunicados?|announcements?|alerts?)(\/|$)/i],
  ['event', /\/(events?|event-calendar|webinars?|workshops?|courses?|trainings?|eventos?|talleres?|agenda)(\/|$)/i],
  ['directory', /\/(directory|database|companies|portfolio|members|listings?|rankings?|top-\d+|current-research|grant-making-agencies|learn-grants)(\/|$)/i],
  ['award', /sbir\.gov\/awards?\/\d+|\/awards?\/\d{4,}(\/|$)/i],        // registro de un premio ya concedido
  ['internal', /tracked-?changes|\/(?:board-?(?:meetings?|packets?)|minutes|agendas?)(\/|$)|concept-?(?:proposal|plan)[^/]*\.pdf/i],
  ['trial', /\/(?:clinicaltrials?|clinical-trials?|studies|study)\/[^/]*(?:study|trial|participants?|nct\d)|\/NCT\d{8}/i],
  ['job', /\/(careers?|jobs?|job-openings?|vacancies|employment|work-with-us|join-our-team)(\/|$)/i],
];
const TEXT = [
  ['report', /\b(impact report|annual report|this (?:policy )?brief (?:was authored|outlines|proposes|argues|describes|highlights)|policy brief|suggested reference:|a new proposal to (?:drive|fund|create|establish)|we(?:'|’)re proud to share (?:the|our)|this report (?:highlights|reflects|describes)|highlights the (?:network|program)(?:'|’)s progress|informe (?:de impacto|anual))\b/i],
  ['cohort', /\b(announce[sd]? the (?:\d{4} )?(?:members|winners|finalists|cohort|awardees|recipients|grantees|selected)|meet the (?:\d{4} )?(?:cohort|winners|finalists|awardees|grantees)|(?:members|companies|startups|teams) (?:selected|chosen) for (?:the|its|our)|welcomes? (?:its|the) (?:new |\d{4} )?cohort|congratulations to (?:the|our))\b/i],
  ['event', /\b(register for this (?:short )?course|join us for (?:a|an|our) (?:webinar|workshop|info session|event)|webinar recording|workshop schedule|session 1\b|orientation session|info(?:rmation)? session on|save the date|anmeldung zum workshop|inscr[ií]bete al taller)\b/i],
  ['news', /\b(press release|for immediate release|\(\s*(?:PR ?Newswire|Business Wire|GLOBE NEWSWIRE)\s*\)|today announced|announced today|ha anunciado hoy)\b/i],
  ['directory', /\b(top \d+ (?:grants|funds|investors|accelerators)|list of (?:grants|funders|investors|accelerators|programs)|(?:\d+|dozens of) (?:grants|funding opportunities) (?:for|to))\b/i],
];
/** Vía para postular: cómo postular, formulario, portal, plazo, LOI, llamada a propuestas… */
export const APPLY_RX = /\b(how to apply|apply (?:now|here|online|by|before|via|through|at|today)|application (?:form|portal|deadline|process|guidelines|window|period|site|requirements|instructions)s?|applications? (?:are|is|will be) (?:now )?(?:open|accepted|due|reviewed)|submit (?:an? |your )?(?:application|proposal|letter of intent|loi|pitch)|letters? of intent|call for (?:proposals|applications|submissions|projects)|requests? for (?:proposals|applications)|RFP|RFA|NOFO|funding opportunity announcement|solicitation|deadlines?|cut-?off(?: dates?)?|eligibility|who (?:can|may|should) apply|eligible (?:applicants|organizations|entities)|postula(?:ci[oó]n|r|ciones)|c[oó]mo (?:postular|aplicar|participar)|convocatoria|bases (?:de la convocatoria|y condiciones)|t[ée]rminos de referencia|inscripciones|appel [àa] (?:projets|candidatures)|candidatez|ausschreibung|bewerbung|bekanntmachung|f[öo]rderaufruf|antragstellung|einreichungsfrist|stichtag|date limite|edital|inscri[çc][õo]es|bando)\b/i;

/* Títulos que delatan una guía o un índice, no una convocatoria concreta. Un identificador de convocatoria en el título
   (PAR-25-383, RFA-RM-27-012, HHS-2027-…, DE-FOA-…) los exime: ahí el título sí nombra un llamado. */
const HAS_CALL_ID = /\b(?:[A-Z]{2,6}-){1,4}[A-Z0-9]*\d{2,}[A-Z0-9-]*\b/;
const TITLE_JOB = /\b(?:program|project|research|grants?) (?:officer|manager|coordinator|associate)\b.*\||\b(?:we(?:'|’)re hiring|job opening|open position|careers? at)\b|^(?:senior|assistant|associate|chief|vice president|director)\b.{0,80}\b(?:officer|director|manager|coordinator|specialist)\b/i;
const TITLE_EXPIRED = /^\s*(?:\[?expired\]?|closed|archived|inactive)\b[\s:\-–—]/i;
const TITLE_MEETING = /\b(?:meetings?|workshops?|webinars?|conferences?|symposi(?:um|a)|stakeholder)\b/i;
const TITLE_GUIDE = /^(?:guidance\b|(?:top|best)\b.{0,40}\b(?:grants|funding|programs|funders|investors|campaigns)|understanding|what (?:is|are)|guide to|a guide to|the (?:complete|ultimate|essential|beginner'?s) guide|navigating|ask the expert|faq\b|frequently asked|top \d+|best \d+)|\b(?:ultimate|complete|beginner'?s) guide\b|\bask the expert\b|(?<!application )\bguide\b|\bexplained\b|\bfrequently asked questions\b/i;
const TITLE_HUB = /^(?:funding|grants?(?: (?:&|and) funding)?)\s*(?:[|\-–—:])|\b(?:funding opportunities|funding resources|grant opportunities|funding calls|active opportunities|current opportunities|open (?:funding )?calls|funding programs|funding sources|find funding|solicitations)\b|\bexplore .{0,40}opportunities\b|\bfunding announcements?\b|^about\b|^types of (?:grants|funding|awards)\b|\b(?:interest|priority) areas\b|^(?:research|grants?) (?:&|and) (?:funding|grants?)\b|^funding (?:&|and) grants?\b/i;

const TITLE_HUB_SECTION = /^types of\b[^|]{0,60}\b(?:grants?|funding|awards?|programs?)\b|\b(?:areas? of interest|program areas|interest areas)\b|\bdirectorate for\b|\bdivision of\b|^(?:[A-Za-z&.]{1,12} ){1,2}grants?$/i;
const SECTION_PATH = /^\/(?:[a-z]{2}\/)?(?:research-programs|funding-opportunities|grants-funding)\/?$/i;
const MODEL_NOT_CALL = { news: 'news', deal_news: 'news', directory: 'directory', company: 'company', investor: 'investor', lender: 'lender', report: 'report', blog: 'blog', event: 'event', cohort: 'cohort', cohort_announcement: 'cohort' };

/**
 * @returns {{ type, isCall, reason, applyQuote, signals }}
 *   type: call | report | blog | news | event | cohort | directory | company | investor | lender | program_page | unknown
 */
export function classifyPage({ url = '', title = '', text = '', modelKind = '', modelPageType = '' } = {}) {
  const s = flat(text); const head = `${title} ${s.slice(0, 1500)}`;
  const signals = [];
  let path = '';
  try { path = new URL(url).pathname; } catch { /* sin URL válida */ }
  for (const [type, rx] of PATH) if (rx.test(path)) signals.push({ type, from: 'url' });
  for (const [type, rx] of TEXT) { const m = rx.exec(type === 'report' || type === 'cohort' || type === 'news' ? head : s); if (m) signals.push({ type, from: 'text', quote: m[0] }); }
  const mk = String(modelPageType || modelKind || '').toLowerCase().trim().split(/[\s|(]/)[0];
  if (MODEL_NOT_CALL[mk]) signals.push({ type: MODEL_NOT_CALL[mk], from: 'model' });
  const apply = APPLY_RX.exec(s);
  const applyQuote = apply ? s.slice(Math.max(0, s.lastIndexOf('. ', apply.index) + 1, apply.index - 100), Math.min(s.length, apply.index + 140)).trim() : '';
  const count = (t) => signals.filter((x) => x.type === t).length;
  const by = (t, from) => signals.some((x) => x.type === t && x.from === from);

  // Reglas duras (en este orden): informe, anuncio de cohorte, evento/taller, noticia/blog, directorio.
  if (by('report', 'text') || (by('report', 'url') && !apply)) return { type: 'report', isCall: false, reason: 'Report (impact/annual report), not a call', applyQuote, signals };
  if (by('cohort', 'text') || by('cohort', 'model')) return { type: 'cohort', isCall: false, reason: 'Announces a selected cohort/winners, not an open call', applyQuote, signals };
  if (by('event', 'url') || count('event') >= 2 || (by('event', 'model') && count('event') >= 1)) return { type: 'event', isCall: false, reason: 'Event, workshop or course page, not a funding call', applyQuote, signals };
  // Convocatoria que el propio título marca como vencida, premio ya concedido y ofertas de empleo: nunca son un llamado abierto.
  if (TITLE_EXPIRED.test(title)) return { type: 'expired', isCall: false, reason: 'The title marks the call as expired or closed', applyQuote, signals };
  if (by('internal', 'url')) return { type: 'internal_doc', isCall: false, reason: 'Internal or board document (concept, minutes), not the call', applyQuote, signals };
  if (by('trial', 'url')) return { type: 'trial_listing', isCall: false, reason: 'Patient-recruitment listing for a clinical trial, not a funding call', applyQuote, signals };
  if (by('award', 'url')) return { type: 'award_record', isCall: false, reason: 'Record of an award already granted, not an open call', applyQuote, signals };
  if (by('job', 'url') || TITLE_JOB.test(title)) return { type: 'job', isCall: false, reason: 'Job posting, not a funding call', applyQuote, signals };
  if (!HAS_CALL_ID.test(title) && TITLE_MEETING.test(title) && title.length < 140 && !/\b(?:grants?|awards?|funding|request for applications)\b/i.test(title)) return { type: 'event', isCall: false, reason: 'Meeting, workshop or summary page, not a funding call', applyQuote, signals };
  // Portada de un sitio (ruta «/»): no es una convocatoria, aunque hable de becas.
  if (path === '/' && !HAS_CALL_ID.test(title) && !apply) return { type: 'home', isCall: false, reason: 'Site home page with no way to apply, not a call', applyQuote, signals };
  // Páginas índice del financiador: «Types of NINDS Small Business Grants», «Program Areas of Interest», «Directorate for …», «VA Grants»,
  // o la raíz de una sección (/grants, /en/research-programs). Los llamados concretos son los leads, no estas páginas.
  if (!HAS_CALL_ID.test(title) && title.length < 220 && TITLE_HUB_SECTION.test(title)) return { type: 'directory', isCall: false, reason: 'Funder section or index page, not a specific call', applyQuote, signals };
  if (!HAS_CALL_ID.test(title) && SECTION_PATH.test(path)) return { type: 'directory', isCall: false, reason: 'Top-level section of a funder site, not a specific call', applyQuote, signals };
  // Guías, explicaciones e índices de oportunidades: el título lo delata aunque el texto mencione «eligibility» o «deadlines».
  if (!HAS_CALL_ID.test(title) && TITLE_GUIDE.test(title)) return { type: 'blog', isCall: false, reason: 'Guide or explainer, not the call itself', applyQuote, signals };
  if (!HAS_CALL_ID.test(title) && title.length < 120 && TITLE_HUB.test(title)) return { type: 'directory', isCall: false, reason: 'Index of funding opportunities; the individual calls are the leads', applyQuote, signals };
  // Una convocatoria publicada bajo /news/ o /announcements/ del propio financiador: solo con vía para postular y sin otras señales
  // de noticia; el verificador la deja «a verificar» (nunca en la lista principal) si además tiene un plazo vigente.
  if (by('news', 'url') && apply && !by('news', 'text') && !by('news', 'model') && count('news') === 1) return { type: 'news', soft: true, isCall: false, reason: 'Call posted as a news/announcement page', applyQuote, signals };
  if (by('news', 'url') || by('news', 'model') || (by('news', 'text') && !by('blog', 'url'))) return { type: 'news', isCall: false, reason: 'News or press release about the program, not the call itself', applyQuote, signals };
  if (by('blog', 'url') || by('blog', 'model')) return { type: 'blog', isCall: false, reason: 'Blog post or article, not the call itself', applyQuote, signals };
  if (by('directory', 'url') || by('directory', 'model') || by('directory', 'text')) return { type: 'directory', isCall: false, reason: 'Directory or list of many opportunities', applyQuote, signals };
  for (const t of ['company', 'investor', 'lender']) if (by(t, 'model')) return { type: t, isCall: false, reason: `The page is about a ${t}, not a call`, applyQuote, signals };
  if (!apply) return { type: 'program_page', isCall: false, reason: 'No way to apply on the page (no application form, deadline, eligibility or call)', applyQuote: '', signals };
  return { type: 'call', isCall: true, reason: 'Call or program page with a way to apply', applyQuote, signals };
}
