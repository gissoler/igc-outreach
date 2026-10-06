/* ─────────────────────────────────────────────────────────────────────────────
   Elegibilidad del solicitante, decidida por el CÓDIGO contra el brief.
   · applicantProfile(brief): quién postula. Por defecto (anotado): startup con fines de lucro que busca
     fondos no dilutivos; el brief puede cambiarlo (entityType, country/domicile, "incorporated outside …").
   · checkApplicant(pageText, profile, {modelQuote}): busca en la página las frases de elegibilidad
     (y la cita del modelo si es literal), extrae tipo de entidad, fines de lucro, estudiantes/afiliación,
     país y etapa, y decide yes | no | unclear con la cita. Si la cita dice estudiantes/universidades/
     sin ánimo de lucro y nada admite empresas → no. Sin frase de elegibilidad → unclear (nunca "yes").
   ───────────────────────────────────────────────────────────────────────────── */
import { flat } from './dates.mjs';

const lower = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();

/* ── Países y regiones (código → patrón) ── */
const PLACES = [
  ['US', /\b(united states|u\.\s?s\.(?:\s?a\.)?|usa|us-based|us based|american|us citizens?|us entities|incorporated in the us|in the us\b|(?:alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington state|west virginia|wisconsin|wyoming))\b/i],
  ['EU', /\b(european union|eu member states?|across europe|in europe\b|european (?:start-?ups|companies|smes)|member states? of the (?:eu|european union)|eu-based|established in (?:an? )?(?:eu|member state)|horizon europe associated countries|associated countries|eu countries|in the eu\b|europe(?:an)?-based)\b/i],
  ['UK', /\b(united kingdom|uk-based|uk-registered|uk registered|in the uk\b|england|scotland|wales|northern ireland|british)\b/i],
  ['CA', /\b(canada|canadian)\b/i], ['CH', /\b(switzerland|swiss)\b/i], ['AU', /\b(australia|australian)\b/i], ['IN', /\b(india|indian)\b/i],
  ['IL', /\b(israel|israeli)\b/i], ['SG', /\b(singapore|singaporean)\b/i], ['DE', /\b(germany|german)\b/i], ['FR', /\b(france|french)\b/i],
  ['ES', /\b(spain|spanish|españa|espana|extremadura|arag[oó]n|catalonia|andalusia)\b/i], ['IT', /\b(italy|italian|lombardy|lombardia)\b/i], ['GR', /\b(greece|greek|central macedonia)\b/i], ['NL', /\b(netherlands|dutch)\b/i], ['PT', /\b(portugal|portuguese)\b/i],
  ['SE', /\b(sweden|swedish)\b/i], ['DK', /\b(denmark|danish)\b/i], ['FI', /\b(finland|finnish)\b/i], ['NO', /\b(norway|norwegian)\b/i], ['RO', /\b(romania|romanian)\b/i], ['NORDIC', /\b(nordic(?: countries)?|nordforsk(?: member)?)\b/i], ['CO', /\b(colombia|colombian[oa]?s?)\b/i], ['CL', /\b(chile|chilean[oa]?s?)\b/i], ['MX', /\b(mexico|méxico|mexican[oa]?s?)\b/i],
  ['BR', /\b(brazil|brasil|brazilian)\b/i], ['JP', /\b(japan|japanese)\b/i], ['KR', /\b(korea|korean)\b/i], ['NZ', /\b(new zealand)\b/i], ['IE', /\b(ireland|irish)\b/i],
  ['LATAM', /\b(latin america(?:n)?|latam|am[eé]rica latina)\b/i], ['AFRICA', /\b(africa(?:n)?)\b/i],
  // Restricciones regionales sin país concreto (convocatorias en cascada de la UE, fondos regionales)
  ['REGIONAL', /\b(respective regions|participating (?:regions|countries|member states)|eligible (?:regions|countries))\b/i],
];
const EU_MEMBERS = new Set(['DE', 'FR', 'ES', 'IE', 'IT', 'NL', 'BE', 'PT', 'AT', 'SE', 'DK', 'FI', 'PL', 'CZ', 'GR', 'HU', 'RO', 'BG', 'HR', 'SK', 'SI', 'LT', 'LV', 'EE', 'LU', 'MT', 'CY']);
const LATAM = new Set(['CO', 'CL', 'MX', 'BR', 'AR', 'PE', 'UY', 'EC', 'PY', 'BO', 'VE', 'CR', 'PA', 'GT', 'DO']);
// Siglas en mayúsculas ("US", "EU", "UK"): solo con mayúsculas, para no confundir "us" (nosotros).
const ACRONYMS = [['US', /\b(?:US|U\.S\.|USA|U\.S\.A\.)(?![a-z])/], ['EU', /\bEU\b/], ['UK', /\bUK\b/]];
const placesIn = (text) => [...new Set([...PLACES.filter(([, rx]) => rx.test(text)).map(([code]) => code), ...ACRONYMS.filter(([, rx]) => rx.test(text)).map(([code]) => code)])];
const covers = (code, country) => code === country || (code === 'EU' && EU_MEMBERS.has(country)) || (code === 'LATAM' && LATAM.has(country));

/** Perfil del solicitante a partir del brief. Lo que no dice el brief queda como default anotado. */
export function applicantProfile(brief = {}) {
  const text = lower([brief.entityType, brief.organization, brief.company, brief.venture, brief.description, brief.oneLiner, brief.geography, brief.constraints, brief.domicile, brief.country].filter(Boolean).join(' · '));
  const explicit = lower(brief.entityType || '');
  let entity = 'for_profit_startup'; let entitySource = 'default (for-profit startup seeking non-dilutive funding)';
  if (/non-?profit|ngo|charity|foundation|sin animo|sin fines|ong\b/.test(explicit || '')) { entity = 'nonprofit'; entitySource = 'brief.entityType'; }
  else if (/universit|academic|research lab|research institute/.test(explicit || '')) { entity = 'academic'; entitySource = 'brief.entityType'; }
  else if (explicit) { entitySource = 'brief.entityType'; }
  else if (/\b(non-?profit organi[sz]ation|registered charity|501\(c\)|we are a (?:non-?profit|foundation|university))\b/.test(text)) { entity = 'nonprofit'; entitySource = 'brief text'; }
  const geo = String([brief.country, brief.domicile, brief.geography].filter(Boolean).join(' · '));
  const outsideMatch = /(?:incorporated|based|registered|domiciled)\s+outside\s+(?:of\s+)?(?:the\s+)?([^)·;]+)/i.exec(geo);
  const outside = outsideMatch ? placesIn(outsideMatch[1]) : [];
  const insideMatch = /(?:incorporated|based|registered|domiciled)\s+in\s+(?:the\s+)?([^)·;,]+)/i.exec(geo);
  const country = brief.country ? (placesIn(brief.country)[0] || null) : insideMatch ? (placesIn(insideMatch[1])[0] || null) : null;
  return {
    entity, forProfit: entity === 'for_profit_startup', entitySource,
    country, outside, countrySource: brief.country ? 'brief.country' : insideMatch ? 'brief.geography' : outside.length ? 'brief.geography (outside …)' : 'unknown (brief does not say where the company is incorporated)',
    state: usStateOf([brief.state, brief.city, brief.geography, brief.domicile].filter(Boolean).join(', ')),
    stage: [brief.stage, brief.round].filter(Boolean).join(' / ') || 'unknown',
    early: /idea|prototype|pre-?seed|preclinical|seed/i.test(`${brief.stage || ''} ${brief.round || ''}`),
  };
}

/* ── Frases de elegibilidad ── */
const MARKER = /\b(eligib\w*|who (?:can|may|should) apply|open to|applicants? (?:must|should|need to|are required)|we are (?:recruiting|looking for|seeking|inviting)|if you(?:'|’)re|if you are|this (?:program(?:me)?|challenge|call|prize|competition|fund(?:ing)?) is (?:for|open|designed|intended)|designed for|intended for|available (?:to|for) (?:applicants|organi[sz]ations|companies|teams|researchers)|teams? (?:must|led by|should)|must be (?:based|located|registered|incorporated|a |an )|restricted to|limited to|requisitos|pueden postular|podr[aá]n (?:participar|postular)|dirigid[oa] a|qui peut|teilnahmeberechtigt|who we fund|we fund|(?:backs|supports|invests? in|funds|selects|is (?:built|designed) for|built for|designed for|looking for) (?:[\w-]+ ){0,5}(?:founders|start-?ups|companies|entrepreneurs|smes|ventures|teams))\b/i;
const HEADING = /\b(eligible (?:organi[sz]ations|applicants|entities|institutions|individuals)|eligibility(?: criteria| requirements| information)?|are you eligible\??|who (?:can|may|should) apply\??|who is eligible\??|requisitos|qui(?:é|e)n puede (?:postular|participar)|elegibilidad)\b/gi;

const COMPANY = /\b(compan(?:y|ies)|business(?:es)?|start-?ups?|smes?|small (?:and medium[- ]sized )?(?:business(?:es)?|enterprises?)|small business concerns?|for-?profits?|for profit|enterprises?|firms?|entrepreneurs?|founders?|ventures?|industry|commercial (?:entities|organi[sz]ations)|biotechnology companies|empresas?|emprendedor(?:es|as)?|emprendimientos?|pymes?|entreprises?|unternehmen)\b/i;
const STUDENT_MOD = /\b(student|students|faculty|university|campus|alumni|youth|young people)[- ](?:led |run |)?(?:founders?|entrepreneurs?|teams?|start-?ups?|ventures?|companies)\b/i;
const TYPES = {
  student: /\b(students?|undergraduates?|graduate students?|grad students|ph\.?d\.? (?:students|candidates)|doctoral (?:students|candidates)|postdocs?|postdoctoral|trainees|alumni|faculty|estudiantes|alumnos|(?:currently )?enrolled)\b/i,
  academic: /\b(universit(?:y|ies)|academic (?:institutions?|medical cent(?:er|re)s?|organi[sz]ations?)|colleges?|higher education institutions?|institutions of higher education|IHEs?|research (?:institutes?|institutions?|organi[sz]ations?)|universidades|instituciones acad[eé]micas)\b/i,
  nonprofit: /\b(non-?profits?|not-for-profit|501\s*\(c\)\s*\(3\)|charit(?:y|ies|able organi[sz]ations?)|NGOs?|civil society organi[sz]ations?|community-based organi[sz]ations?|sin (?:[aá]nimo|fines) de lucro|ONGs?|fundaciones)\b/i,
  government: /\b(government agencies|governmental (?:entities|organi[sz]ations)|municipalit(?:y|ies)|local authorities|public (?:bodies|entities|institutions|sector organi[sz]ations)|state agencies|tribal governments)\b/i,
  researcher: /\b(researchers?|investigators?|scientists?|clinicians?|principal investigators?)\b/i,
};
const NEGATED = /\b(not (?:be )?eligible|ineligible|excluded|cannot apply|may not apply|are not allowed|no (?:se )?(?:admiten|aceptan))\b/i;
const EXCLUDE_FP = /\b((?:for-?profit|commercial) (?:entities|organi[sz]ations|companies|businesses|firms|applicants) (?:are|is) (?:not |in)eligible|(?:are|is) not (?:open|available) to (?:for-?profit|commercial|compan|business)|not open to (?:for-?profit|commercial|compan|business)|(?:only|exclusively) (?:for |open to |available to )?(?:non-?profits?|universities|academic|students|registered charities|faculty)|must be (?:a |an )?(?:registered )?(?:non-?profit|charity|501|university|student|faculty member)|for-?profit (?:entities|organi[sz]ations|companies) (?:may|can)not|no (?:se )?(?:admiten|aceptan) empresas|excluding for-?profit)\b/i;
const INCLUDE_FP = /\b((?:for-?profit|small business(?:es)?|compan(?:y|ies)|start-?ups?|smes?|businesses|enterprises|industry)\b[^.]{0,40}\b(?:are|is) (?:also |both )?eligible|open to (?:all )?(?:compan|start-?ups?|businesses|for-?profit|entrepreneurs|founders|innovators|smes|early-stage)|unrestricted|any type of entity|open to any (?:type of )?(?:entity|organi[sz]ation|applicant)|(?:existing )?companies and (?:new )?start-?ups|for-?profit (?:organi[sz]ations|entities|companies)|small business concerns?|empresas (?:emergentes )?(?:pueden|son elegibles)|start-?ups? (?:and|or) (?:smes|scale-?ups|companies))\b/i;
const COUNTRY_RULE = /\b((?:in|from) (?:the )?(?:nordforsk|nordic)\b[^.;]{0,60}|(?:must|should|need to) be (?:legally )?(?:based|located|registered|incorporated|resident|domiciled|established|headquartered) in|(?:based|located|registered|incorporated|resident|domiciled|established|headquartered) in|citizens? (?:or permanent residents? )?of|permanent residents? of|residents? of|(?:only|exclusively) (?:open to|for|available to) (?:applicants|companies|organi[sz]ations|residents|teams) (?:from|in)|applicants? from|led by (?:u\.?s\.?|us) citizens|substantive role in|with a (?:presence|base) in|(?:start-?ups?|companies|smes|applicants|teams|organi[sz]ations) (?:across|in|from)|plan to (?:develop|establish|relocate) (?:their|the) business in|non-domestic \(non-u\.?s\.?\) entities[^.;]{0,60}not eligible)\b[^.;]{0,90}/gi;
const STRONG_COUNTRY = /\b(?:must be (?:legally )?(?:established|based|registered|incorporated|located|headquartered) in|beneficiaries (?:must be )?established in|only (?:companies|applicants|organi[sz]ations|smes) (?:established|based|registered) in)\b[^.;]{0,90}/gi;
const GLOBAL = /\b(worldwide|anywhere in the world|any country|all countries|globally|international applicants (?:are )?welcome|from around the world|no geographic restrictions?|incorporated anywhere|open to (?:applicants|teams|startups) from all)\b/i;
const LATE_STAGE = /\b(series [a-c](?: or later)?|post-?revenue|revenue of at least|minimum (?:annual )?revenue|at least \$?\d[\d,.]*\s*(?:k|m|million)? (?:in )?(?:revenue|arr|sales)|at least \d+ (?:full-time )?employees|(?:operating|in business) for (?:at least )?\d+ years)\b/i;

// Una frase que describe el propósito del programa ("Supports startups and small businesses…") no dice quién puede postular.
const PURPOSE = /^\W*(?:this (?:program(?:me)?|call|initiative|fund|challenge)\s+)?(?:by (?:investing|funding|supporting)|to (?:support|fund|invest)|supports?|funds?|provides?|aims? to|helps?|enables?|fosters?|invests? in|in support of|our mission|the mission)\b/i;
const APPLY_CUE = /\b(eligib\w*|apply|applicants?|open to|submit\w*)\b/i;
// Empresas que solo aparecen como socios de un consorcio: no son quien postula.
const PARTNER = /\b(partners?|partner organi[sz]ations?|may (?:also )?participate|participating as|as (?:a )?partners?|subcontract\w*|collaborators?)\b/i;
// La página remite la elegibilidad a otro documento.
const DEFER = /\b(see (?:the )?(?:full )?(?:program )?(?:solicitation|guidelines|call text|call document|notice of funding|nofo|rfa|terms and conditions)|refer to (?:the )?(?:solicitation|guidelines|call)|certain types of organi[sz]ations|eligibility (?:is|are) (?:defined|described|detailed|set out|specified) in)\b/i;

// Frases que son navegación (enlaces markdown, índices con puntos): no dicen quién puede postular.
const NAV = /\]\(https?:|\.{6,}|^\W*\[/;
function sentencesOf(s) {
  // Frases con marcadores + el bloque que sigue a un encabezado de elegibilidad
  const parts = s.split(/(?<=[.!?;])\s+|\s+(?=-\s)|\s+•\s+/).map((x) => x.trim()).filter((x) => x.length >= 12 && x.length <= 700 && !NAV.test(x));
  // Primero el bloque bajo un encabezado de elegibilidad (listas tipo NIH "Eligible Organizations"), luego frases con marcador.
  const out = [];
  for (const m of s.matchAll(HEADING)) {
    const block = s.slice(m.index, m.index + 1200);
    for (const x of block.split(/(?<=[.!?;])\s+/).slice(0, 6)) if (x.length >= 12 && !NAV.test(x) && !out.includes(x.trim())) out.push(x.trim());
    if (out.length >= 12) break;
  }
  for (const x of parts) if (MARKER.test(x) && !out.includes(x)) out.push(x);
  return out.slice(0, 30);
}

/**
 * @param pageText  texto de la página (no confiable)
 * @param profile   applicantProfile(brief)
 * @param modelQuote cita de elegibilidad del modelo (solo se usa si es literal: el llamador lo comprueba)
 * @returns {{ decision:'yes'|'no'|'unclear', reason, quote, types, countries, flags, sentences }}
 */
export function checkApplicant(pageText, profile = applicantProfile({}), { modelQuote = '' } = {}) {
  const s = flat(pageText);
  const sents = sentencesOf(s);
  if (modelQuote && !sents.includes(modelQuote)) sents.unshift(flat(modelQuote));
  const flags = [];
  const found = { company: null, partner: null, student: null, academic: null, nonprofit: null, government: null, researcher: null };
  let exclude = null; let include = null; let global = null; let late = null;
  const countries = [];
  for (const x of sents) {
    if (!exclude && EXCLUDE_FP.test(x)) exclude = x;
    if (!include && INCLUDE_FP.test(x)) include = x;
    if (COMPANY.test(x) && !STUDENT_MOD.test(x) && !NEGATED.test(x) && !((PURPOSE.test(x) || /\b(?:in support of this mission|relaunching|strengthens? the)\b/i.test(x)) && !APPLY_CUE.test(x))) {
      if (PARTNER.test(x) && !INCLUDE_FP.test(x)) { if (!found.partner) found.partner = x; } else if (!found.company) found.company = x;
    }
    if (STUDENT_MOD.test(x) && !found.student) found.student = x;
    for (const [t, rx] of Object.entries(TYPES)) if (!found[t] && rx.test(x)) found[t] = x;
    if (!global && GLOBAL.test(x)) global = x;
    if (!late && LATE_STAGE.test(x)) late = x;
    for (const m of x.matchAll(COUNTRY_RULE)) for (const code of placesIn(m[0])) if (!countries.some((c) => c.code === code)) countries.push({ code, quote: x });
  }
  // Restricciones de país fuertes en cualquier parte de la página (no solo en las frases de elegibilidad)
  for (const m of s.matchAll(STRONG_COUNTRY)) {
    const sent = s.slice(Math.max(0, s.lastIndexOf('. ', m.index) + 1), Math.min(s.length, m.index + 220)).trim();
    // "must be legally established in the following regions: Central Macedonia, Greece; Lombardy, Italy; …": los lugares vienen después.
    const scope = /\b(?:following|these|below|listed)\b/i.test(m[0]) || /:\s*$/.test(m[0]) ? s.slice(m.index, m.index + 700) : m[0];
    for (const code of placesIn(scope)) if (!countries.some((c) => c.code === code)) countries.push({ code, quote: sent });
  }
  const types = Object.fromEntries(Object.entries(found).filter(([, v]) => v).map(([k]) => [k, true]));
  const out = (decision, reason, quote) => ({ decision, reason, quote: quote ? String(quote).slice(0, 400) : '', types, countries: countries.map((c) => c.code), flags, sentences: sents.slice(0, 4).map((x) => x.slice(0, 300)) });
  if (!sents.length) return out('unclear', 'The page does not say who can apply', '');

  // 1) Equipos liderados por estudiantes; exclusión explícita de empresas / fines de lucro
  const studentLed = sents.find((x) => /\b(?:must be|are|be) student-?led\b|\bstudent-?led (?:teams?|start-?ups?|ventures?)\b/i.test(x));
  if (studentLed && profile.forProfit && !include) return out('no', 'Only for student-led teams', studentLed);
  if (exclude && profile.forProfit) return out('no', 'The page excludes for-profit companies', exclude);
  // 2) Solo estudiantes / universidades / ONG / gobierno y nada que admita empresas
  const companyOk = Boolean(include || (found.company && !(DEFER.test(s) && !APPLY_CUE.test(found.company))));
  const defers = (s.match(/[^.!?]*\b(?:see (?:the )?(?:full )?(?:program )?(?:solicitation|guidelines|call text|call document|notice of funding|nofo|rfa|terms and conditions)|refer to (?:the )?(?:solicitation|guidelines|call)|certain types of organi[sz]ations|eligibility (?:is|are) (?:defined|described|detailed|set out|specified) in)[^.!?]*[.!?]?/i) ?? [])[0]?.trim();
  // "Small business concern" (SBIR/STTR) es una definición federal de EE. UU. que exige propiedad estadounidense: para una empresa constituida fuera no se puede dar por elegible.
  if (profile.forProfit && profile.outside?.includes('US') && /\bsmall business concerns?\b|\bSBIR\b|\bSTTR\b/i.test(s) && !exclude) {
    const q = sents.find((x) => /small business concern/i.test(x)) || sents.find((x) => /\bSBIR|STTR\b/.test(x)) || sents[0];
    flags.push('us_small_business_concern');
    return out('unclear', 'Small business concern (SBIR/STTR) is a US federal definition that requires US ownership; the venture is incorporated outside the US', q);
  }
  const restricted = ['student', 'academic', 'nonprofit', 'government'].filter((t) => found[t]);
  if (profile.forProfit && !companyOk && found.partner) return out('unclear', 'Companies appear only as partners, not as the applicants who lead the proposal', found.partner);
  if (profile.forProfit && !companyOk && restricted.length) return out('no', `Only for ${restricted.join(' / ')} applicants; nothing admits a for-profit startup`, found[restricted[0]]);
  if (profile.forProfit && found.student && STUDENT_MOD.test(found.student) && !include) return out('no', 'Only for student-led teams', found.student);
  // 3) País
  if (countries.length && !global) {
    const codes = countries.map((c) => c.code);
    const q = countries[0].quote;
    if (profile.outside.length && codes.every((c) => profile.outside.some((o) => covers(o, c)))) return out('no', `Restricted to ${codes.join('/')}; the venture is incorporated outside ${profile.outside.join('/')}`, q);
    if (profile.country && !codes.some((c) => covers(c, profile.country))) return out('no', `Restricted to ${codes.join('/')}; the venture is in ${profile.country}`, q);
    if (!profile.country) flags.push(`country_restricted:${codes.join('/')}`);
  }
  // 4) Etapa
  if (late && profile.early) flags.push('stage_requirement');
  if (!companyOk) return out('unclear', defers ? 'The page defers eligibility to another document (solicitation or guidelines)' : found.researcher ? 'Addressed to researchers; does not say companies can apply' : 'Eligibility does not say whether a for-profit startup can apply', defers || found.researcher || sents[0]);
  if (flags.some((f) => f.startsWith('country_restricted'))) return out('unclear', `Companies can apply, but only from ${countries.map((c) => c.code).join('/')}; the brief does not say where the venture is incorporated`, countries[0].quote);
  if (flags.includes('stage_requirement')) return out('unclear', 'Companies can apply, but there is a stage/revenue requirement to check', late);
  return out('yes', 'The eligibility statement admits companies/startups', include || found.company);
}

/* ── Pantalla previa: solo individuos y otro estado ──────────────────────────────────────────────
   Dos descartes que el título o el dominio ya prueban, sin esperar a leer la página:
   · becas para una persona (postdoctoral, fellowship, K/F awards, scholarship…) cuando quien postula es una empresa;
   · programa de gobierno de OTRO estado (cirm.ca.gov, *.ny.gov…) cuando el brief dice dónde está la empresa.
   El motivo cita el título o el dominio, para que se pueda comprobar. */
const US_STATES = { al: 'alabama', ak: 'alaska', az: 'arizona', ar: 'arkansas', ca: 'california', co: 'colorado', ct: 'connecticut', de: 'delaware', fl: 'florida', ga: 'georgia', hi: 'hawaii', id: 'idaho', il: 'illinois', in: 'indiana', ia: 'iowa', ks: 'kansas', ky: 'kentucky', la: 'louisiana', me: 'maine', md: 'maryland', ma: 'massachusetts', mi: 'michigan', mn: 'minnesota', ms: 'mississippi', mo: 'missouri', mt: 'montana', ne: 'nebraska', nv: 'nevada', nh: 'new hampshire', nj: 'new jersey', nm: 'new mexico', ny: 'new york', nc: 'north carolina', nd: 'north dakota', oh: 'ohio', ok: 'oklahoma', or: 'oregon', pa: 'pennsylvania', ri: 'rhode island', sc: 'south carolina', sd: 'south dakota', tn: 'tennessee', tx: 'texas', ut: 'utah', vt: 'vermont', va: 'virginia', wa: 'washington', wv: 'west virginia', wi: 'wisconsin', wy: 'wyoming' };
/** Código de estado de EE. UU. que nombra un texto («Potomac, Maryland, USA», «MD»); null si no hay uno claro. */
export function usStateOf(text) {
  const t = lower(text).replace(/[^a-z ]+/g, ' ');
  const names = Object.entries(US_STATES).sort((a, b) => b[1].length - a[1].length);
  for (const [code, name] of names) if (new RegExp(`\\b${name}\\b`).test(t)) return code;
  const ab = /(?:^|,)\s*([A-Za-z]{2})\s*(?:,|$|\d)/.exec(String(text || '').trim());
  return ab && US_STATES[ab[1].toLowerCase()] ? ab[1].toLowerCase() : null;
}
const FEDERAL_2LETTER = new Set(['va']);   // www.va.gov es federal, no Virginia
const INDIVIDUAL_TITLE = /\b(?:post-?doctoral|pre-?doctoral|doctoral (?:fellowship|dissertation)|graduate research fellowship|(?:research |career |travel )?fellowships?|fellows? program|scholarships?|career development award|mentored (?:research )?(?:scientist )?(?:career )?(?:development )?award|training grants?|[KF]\d{2}\b)/i;
const SMALL_BUSINESS_TITLE = /\b(?:sbir|sttr|small business|for-?profit|compan(?:y|ies)|industry)\b/i;
/** @returns {{ code, reason }|null} */
export function screenCall({ url = '', title = '' } = {}, profile = {}) {
  if (profile.forProfit !== false && INDIVIDUAL_TITLE.test(title) && !SMALL_BUSINESS_TITLE.test(title)) {
    const m = INDIVIDUAL_TITLE.exec(title)[0];
    return { code: 'individual_only', reason: `The title ("${String(title).slice(0, 110)}") is an award for an individual (${m}), not for a company` };
  }
  if (profile.state) {
    let host = ''; try { host = new URL(url).hostname.toLowerCase(); } catch { /* sin URL */ }
    const m = /^(?:[a-z0-9-]+\.)+([a-z]{2})\.gov$/.exec(host) || /\.state\.([a-z]{2})\.us$/.exec(host);
    const code = m && US_STATES[m[1]] && !FEDERAL_2LETTER.has(m[1]) && !/^www\.[a-z]{2}\.gov$/.test(host) ? m[1] : null;
    if (code && code !== profile.state) return { code: 'other_state', reason: `${host} is a ${US_STATES[code]} state program; the applicant is in ${US_STATES[profile.state]}` };
  }
  return null;
}
