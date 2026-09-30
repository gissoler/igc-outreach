/* ─────────────────────────────────────────────────────────────────────────────
   Rúbrica de matching de convocatorias (grants). El código decide; ningún modelo.

   Caso que la motivó (30/09): Grants.gov 344715 = NSF 23-525 «Oceanographic
   Facilities and Equipment Support» (ALN 47.050 Geosciences) quedó como match de un
   proyecto de Alzheimer/armonización de datos porque la puntuación contaba palabras
   sueltas («research», «infrastructure», «data», «science»). La regla correcta era
   rechazar y no preparar ninguna propuesta.

   Rúbrica (sobre campos OFICIALES: título, alcance/synopsis, programa ALN, agencia):
     1. Anclas: términos específicos del proyecto (sector, producto, términos de búsqueda)
        sin palabras genéricas. Las frases completas («mental health», «data
        harmonization») valen más que tokens sueltos. Las palabras amplias («health»,
        «disease», «digital») solo cuentan dentro de una frase completa.
     2. Campo: el Assistance Listing (ALN/CFDA) y la agencia dicen qué financia la
        convocatoria (47.050 = Geociencias, 93.xxx = Salud…). Se compara con el
        campo del proyecto.
     3. Veredicto:
        · mismatch  → se descarta y NO se genera borrador:
            - ninguna ancla ni frase del proyecto en el título ni en el alcance; o
            - el campo oficial es otro y no hay ancla en el título ni frase completa.
        · weak      → radar («revisar el alcance oficial»): solo 1 ancla suelta en el alcance,
                      o el campo oficial es otro aunque el título coincida.
        · match     → puede ser prioridad (sigue sujeta a elegibilidad y fechas).
   ───────────────────────────────────────────────────────────────────────────── */
import { norm } from './core.mjs';

/** Palabras que aparecen en casi cualquier convocatoria: nunca prueban encaje temático. */
export const GENERIC = new Set(`
  research researcher researchers infrastructure open science sciences scientific data program programs programme support supports
  development develop developing project projects grant grants funding fund funds award awards opportunity opportunities application
  applications national international federal state public private new innovative innovation innovations technology technologies
  technical services service system systems center centers centre network networks community communities capacity training education
  activities activity equipment facilities facility operations operation management initiative initiatives resources resource
  collaborative collaboration partnership partnerships institution institutions organization organizations based level high advanced
  including related through within across other these those their which will with from that this under into more most year years
  program-based platform platforms solution solutions tool tools approach approaches study studies analysis outcomes impact
  improve improving improvement quality access use using user users people population populations women men children youth adults
  agency agencies department office foundation foundations nonprofit profit company companies startup startups small business businesses
  early stage stages pre seed global world worldwide local regional area areas field fields sector sectors industry industries
  market markets product products experience experiences next steps step care medical
  the and for with toward towards into onto over about between among via per any all each both can may must should would could
  our your its they them you are was were been being has have had not but also than then such very well
  los las del con para por que una uno sus entre sobre hacia desde como mas sin`.split(/\s+/).filter(Boolean));

/** Amplias: pesan solo como parte de una frase completa del proyecto (p. ej. «mental health»). */
export const BROAD = new Set(['health', 'healthcare', 'disease', 'diseases', 'digital', 'clinical', 'patient', 'patients', 'wellness',
  'wellbeing', 'being', 'well', 'behavioral', 'environmental', 'social', 'human', 'life', 'biological', 'computing', 'engineering']);

const stem = (t) => (/(ss|is|us|ics)$/.test(t) ? t : t.replace(/s$/, ''));
const tokensOf = (text) => norm(text).split(' ').map(stem).filter((t) => t.length > 2);

/* Assistance Listing (ALN/CFDA) → campo. Prefijos de dos dígitos por agencia; NSF por directorado. */
const ALN_FIELDS = [
  [/^47\.041/, 'Engineering', 'engineering'], [/^47\.049/, 'Mathematical and physical sciences', 'physical'],
  [/^47\.050/, 'Geosciences', 'geo'], [/^47\.070/, 'Computer and information science', 'computing'],
  [/^47\.074/, 'Biological sciences', 'bio'], [/^47\.075/, 'Social, behavioral and economic sciences', 'social'],
  [/^47\.076/, 'STEM education', 'education'], [/^47\.079/, 'International science and engineering', 'general'],
  [/^47\.083/, 'Integrative activities', 'general'], [/^47\.084/, 'Technology, innovation and partnerships', 'innovation'],
  [/^12\.420/, 'Military medical research (CDMRP)', 'health'], [/^93\./, 'Health and human services', 'health'],
  [/^64\./, 'Veterans affairs', 'health'], [/^10\./, 'Agriculture', 'agriculture'], [/^11\.4[0-9]{2}/, 'Oceans and atmosphere (NOAA)', 'geo'],
  [/^11\./, 'Commerce', 'commerce'], [/^12\./, 'Defense', 'defense'], [/^14\./, 'Housing', 'housing'], [/^15\./, 'Interior and natural resources', 'environment'],
  [/^16\./, 'Justice', 'justice'], [/^17\./, 'Labor', 'labor'], [/^19\./, 'Diplomacy and international exchange', 'international'],
  [/^20\./, 'Transportation', 'transportation'], [/^43\./, 'Space (NASA)', 'space'], [/^45\./, 'Arts and humanities', 'arts'],
  [/^59\./, 'Small business', 'innovation'], [/^66\./, 'Environmental protection', 'environment'], [/^81\./, 'Energy', 'energy'],
  [/^84\./, 'Education', 'education'], [/^97\./, 'Homeland security', 'security'], [/^98\./, 'International development', 'international'],
];
export function alnField(aln) {
  const code = String(aln || '').match(/\d{2}\.\d{3}/)?.[0];
  if (!code) return null;
  const hit = ALN_FIELDS.find(([rx]) => rx.test(code));
  return hit ? { code, label: hit[1], domain: hit[2] } : { code, label: `ALN ${code}`, domain: 'unknown' };
}

/** Campos del proyecto, deducidos del brief. */
const BRIEF_DOMAINS = [
  ['health', /health|medic|clinic|patient|disease|alzheimer|dementia|mental|psych|therap|drug|pharma|neuro|care|wellbeing|well-being|wellness|cancer|cardio/],
  ['bio', /biolog|biotech|genom|molecul|protein|cell|neuro|microbio/],
  ['social', /behavio|social|psych|wellbeing|well-being|wellness|community|equity/],
  ['computing', /\bai\b|artificial intelligence|machine learning|software|data|platform|digital|app\b|algorithm/],
  ['education', /educat|school|learning|student|teach|training/],
  ['environment', /climate|environment|carbon|water|biodivers|conservation/],
  ['agriculture', /agricultur|farm|crop|food|livestock/],
  ['energy', /energy|battery|solar|grid|hydrogen/],
  ['geo', /ocean|marine|geolog|atmospher|earth science|seismic/],
  ['engineering', /engineer|manufactur|robot|material/],
  ['space', /space|satellite|orbit/],
  ['arts', /\bart\b|arts|museum|humanit|culture/],
];
export function briefDomains(brief = {}) {
  const text = norm(`${brief.industry} ${brief.product} ${brief.description} ${brief.oneLiner || ''} ${brief.criteria || ''}`);
  const set = new Set(BRIEF_DOMAINS.filter(([, rx]) => rx.test(text)).map(([d]) => d));
  if (set.size) set.add('general').add('innovation'); // programas transversales (SBIR, TIP, internacional) no son un campo ajeno
  return set;
}
// Campos cercanos que no cuentan como ajenos.
const NEAR = { health: ['bio', 'social', 'veterans'], bio: ['health'], social: ['health', 'education'], computing: ['engineering', 'innovation'], environment: ['geo', 'agriculture', 'energy'], geo: ['environment'] };

/** Frases y anclas específicas del proyecto (sin genéricas). */
export function topicAnchors(brief = {}, terms = []) {
  const phrases = new Set();
  const anchors = new Set();
  const sources = [brief.industry, brief.product, brief.criteria, ...(terms || []).map((t) => (typeof t === 'string' ? t : t?.term))]
    .flatMap((s) => String(s || '').split(/[,;|\n]/)).map((s) => s.trim()).filter(Boolean);
  for (const s of sources) {
    const toks = tokensOf(s).filter((t) => !GENERIC.has(t));
    const specific = toks.filter((t) => !BROAD.has(t));
    specific.forEach((t) => anchors.add(t));
    // Frase = 2–4 palabras con al menos una no genérica: «mental health», «data harmonization».
    const all = tokensOf(s);
    if (all.length >= 2 && all.length <= 4 && all.some((t) => !GENERIC.has(t))) phrases.add(all.join(' '));
  }
  // La descripción libre NO aporta anclas: sus palabras («understand», «individuals»…) coinciden con cualquier texto.
  return { phrases: [...phrases], anchors: [...anchors] };
}

const officialText = (lead) => {
  const ev = lead.evidence || [];
  const scope = ev.filter((e) => ['scope', 'opportunity', 'title', 'program', 'eligibility_scope', 'description'].includes(e.field)).map((e) => e.quote).join(' ');
  return { title: String(lead.title || ''), scope: `${scope} ${String(lead.searchText || '').slice(0, 6000)}` };
};

/**
 * Aplica la rúbrica a una convocatoria. Devuelve
 * { verdict: 'match'|'weak'|'mismatch', anchorsInTitle, anchorsInScope, phrases, genericOnly, field, reasons, summary }.
 */
export function grantMatch(lead, brief = {}, terms = []) {
  const { phrases, anchors } = topicAnchors(brief, terms);
  const { title, scope } = officialText(lead);
  const titleToks = new Set(tokensOf(title));
  const scopeNorm = ` ${tokensOf(scope).join(' ')} `;
  const scopeToks = new Set(tokensOf(scope));
  const anchorsInTitle = anchors.filter((a) => titleToks.has(stem(a)));
  const anchorsInScope = anchors.filter((a) => scopeToks.has(stem(a)));
  const phraseHits = phrases.filter((p) => scopeNorm.includes(` ${p} `) || ` ${[...titleToks].join(' ')} `.includes(` ${p} `));
  const genericOnly = [...scopeToks].filter((t) => GENERIC.has(t) && sourcesMention(t, brief, terms)).slice(0, 6);
  const field = alnField(lead.facts?.aln || lead.aln || (lead.evidence || []).find((e) => e.field === 'program')?.quote);
  const mine = briefDomains(brief);
  const fieldForeign = Boolean(field && !['unknown', 'general', 'innovation'].includes(field.domain) && mine.size
    && !mine.has(field.domain) && ![...mine].some((d) => (NEAR[d] || []).includes(field.domain)));

  const reasons = [];
  let verdict = 'match';
  const noTopic = !anchorsInTitle.length && !phraseHits.length && !anchorsInScope.length;
  if (noTopic) {
    verdict = 'mismatch';
    reasons.push(genericOnly.length ? `Only generic words matched (${genericOnly.slice(0, 4).join(', ')}); none of your topic terms appear in the official title or scope.` : 'None of your topic terms appear in the official title or scope.');
  }
  if (fieldForeign && !anchorsInTitle.length && !phraseHits.length) {
    verdict = 'mismatch';
    reasons.push(`The official program funds ${field.label} (ALN ${field.code}), a different field from yours.`);
  } else if (fieldForeign) {
    if (verdict === 'match') verdict = 'weak';
    reasons.push(`Official program area is ${field.label} (ALN ${field.code}); confirm your project fits its scope.`);
  }
  if (verdict === 'match' && !anchorsInTitle.length && !phraseHits.length && anchorsInScope.length < 3) {
    verdict = 'weak';
    reasons.push(`Your topic appears only in passing in the scope (${anchorsInScope.join(', ')}); review the official objective.`);
  }
  const summary = verdict === 'mismatch'
    ? `Off-topic: ${reasons[0]}`
    : verdict === 'weak'
      ? `Weak match: ${reasons[0] || 'review the official scope.'}`
      : `Matches ${[...phraseHits, ...anchorsInTitle].slice(0, 3).join(', ') || anchorsInScope.slice(0, 3).join(', ')} in the official call.`;
  return { verdict, anchorsInTitle, anchorsInScope, phrases: phraseHits, genericOnly, field, reasons, summary };
}

function sourcesMention(token, brief, terms) {
  const text = ` ${tokensOf(`${brief.industry} ${brief.product} ${brief.description} ${(terms || []).map((t) => (typeof t === 'string' ? t : t?.term)).join(' ')}`).join(' ')} `;
  return text.includes(` ${token} `);
}
