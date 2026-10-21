/* ─────────────────────────────────────────────────────────────────────────────
   V15 · Inversionistas · Sector del brief para verificar tesis (sin modelo).
   La tesis de un fondo no repite las palabras técnicas del brief («binding prediction», «retrosynthesis»): habla de
   «drug discovery», «therapeutics», «AI», «obesity». Aquí se arma, SOLO desde el brief, el vocabulario con el que
   el código acepta una frase de tesis:
     · términos del brief (exact terms, industry, product), sin palabras de ruta («investor», «licensing»…);
     · familias sectoriales activadas por el brief (cada una declara su vocabulario y si es específica o amplia).
   Una frase es tesis ESPECÍFICA si nombra un término del brief o el vocabulario específico de una familia («drug discovery»,
   «obesity», «speech»); si solo nombra familias amplias («biotech», «AI», «life sciences»), aunque sean varias, es AMPLIA.
   Funciones puras.
   ───────────────────────────────────────────────────────────────────────────── */
import { contentTokens, exactTerms } from '../dossier/terms.mjs';

/** Palabras de ruta o de financiación: describen lo que se busca, no el sector. Nunca prueban una tesis. */
const ROUTE = new Set(['investor', 'investors', 'investment', 'invest', 'venture', 'ventures', 'vc', 'capital', 'fund', 'funds', 'funding', 'corporate', 'partnership', 'partnering', 'partner', 'licensing', 'license', 'collaboration', 'codevelopment', 'co', 'development', 'seed', 'angel', 'firm', 'startup', 'company']
  .map((w) => contentTokens(w)[0] || w));
/** Palabras demasiado genéricas para unir una tesis a este brief. */
const GENERIC = new Set(['disease', 'drug', 'discovery', 'health', 'medical', 'clinical', 'data', 'model', 'system', 'software', 'tool', 'technology', 'solution', 'service', 'pharma', 'biotech', 'science', 'life', 'patient', 'prediction', 'assessment', 'remote', 'design', 'detection', 'signal', 'protein', 'target', 'small', 'molecule', 'molecular', 'binding', 'evaluation', 'route', 'multi', 'agent', 'experimental', 'potential', 'approximately', 'interesting', 'related',
  // cubiertas por familias (solas no unen una tesis a ESTE brief: «we invest in AI» no es una tesis de descubrimiento de fármacos)
  'ai', 'digital', 'therapeutic', 'therapeutics', 'computational', 'receptor', 'detecting', 'recording', 'prioritization', 'transformer', 'generative', 'virtual', 'synthesis', 'screening', 'biomarker', 'platform', 'research', 'stage']
  .map((w) => contentTokens(w)[0] || w));

/** Familias: `when` se prueba contra el texto del brief; `vocab` contra la frase de la página. `broad`: familia amplia. */
export const FAMILIES = [
  { id: 'drug_discovery', when: /\b(drug|molecul\w*|compound|binding|ligand|chemi\w*|retrosynth\w*|docking|admet|medicinal|therapeut\w*|small[- ]molecule)\b/i,
    specific: [/\bdrug discovery\b/i, /\bsmall[- ]molecules?\b/i, /\bmedicinal chemistry\b/i, /\bcomputational (?:chemistry|biology|drug)/i, /\bdrug design\b/i, /\bmolecular design\b/i, /\bchemistry\b/i],
    broad: [/\btherapeutics?\b/i, /\bbiotech(?:nology)?\b/i, /\blife[- ]sciences?\b/i, /\bpharmaceuticals?\b/i, /\bdrug development\b/i, /\bnew medicines\b/i, /\bbiopharma\w*\b/i] },
  { id: 'ai', when: /\b(ai|artificial intelligence|machine learning|deep learning|transformer|neural|multi-agent|generative)\b/i,
    specific: [], broad: [/\bAI\b/, /\bartificial intelligence\b/i, /\bmachine learning\b/i, /\bdeep learning\b/i, /\btechbio\b/i, /\bcomputation(?:al)?\b/i, /\bdata[- ]driven\b/i] },
  { id: 'metabolic', when: /\b(obes\w*|metabolic|glp-?1|gip|incretin|diabet\w*|cardiometabolic)\b/i,
    specific: [/\bobes(?:ity|e)\b/i, /\bmetabolic\b/i, /\bcardiometabolic\b/i, /\bdiabet(?:es|ic)\b/i, /\bendocrin\w*/i, /\bincretins?\b/i, /\bGLP-?1\b/i], broad: [] },
  { id: 'neuro', when: /\b(alzheimer\w*|dementia|neuro\w*|brain|cognit\w*|cns)\b/i,
    specific: [/\bneuroscience\b/i, /\bneurolog\w*/i, /\bneurodegenerat\w*/i, /\bCNS\b/, /\bcentral nervous system\b/i, /\bbrain(?: health)?\b/i, /\bdementia\b/i, /\balzheimer\w*/i, /\bneuropsychiatr\w*|\bpsychiatr\w*/i, /\bneuroinflammat\w*/i], broad: [] },
  { id: 'cannabinoid', when: /\b(cannabinoid\w*|cb1|cb2|cannabis|endocannabinoid)\b/i,
    specific: [/\bcannabinoids?\b/i, /\bcannabis\b/i, /\bendocannabinoid\w*/i], broad: [] },
  { id: 'digital_health', when: /\b(audio|voice|speech|digital|wearable|sensor|biomarker|remote)\b/i,
    specific: [/\bdigital biomarkers?\b/i, /\bvoice\b/i, /\bspeech\b/i, /\bdigital therapeutics\b/i],
    broad: [/\bdigital health\b/i, /\bhealth ?tech\b/i, /\bmedtech\b/i, /\bmedical devices?\b/i, /\bdiagnostics?\b/i, /\bhealthcare\b/i, /\bhealth care\b/i] },
  { id: 'genomics', when: /\b(genom\w*|genetic\w*|gwas|omics)\b/i,
    specific: [/\bgenomics?\b/i, /\bgenetics?\b/i, /\bprecision medicine\b/i, /\bmulti-?omics\b/i], broad: [] },
];

/** Sector del brief: tokens propios (con raíz) y familias activas. */
export function sectorOf(brief = {}) {
  const briefText = [brief.industry, brief.product, brief.oneLiner, ...exactTerms(brief)].filter(Boolean).join(' ');
  const tokens = new Set();
  for (const t of contentTokens(`${brief.industry || ''} ${exactTerms(brief).join(' ')} ${brief.product || ''}`)) if (t.length >= 2 && !ROUTE.has(t) && !GENERIC.has(t)) tokens.add(t);
  const families = FAMILIES.filter((f) => f.when.test(briefText)).map((f) => f.id);
  return { tokens, families, text: briefText };
}

/** ¿Qué sector nombra esta frase? → { level: 'specific'|'broad'|null, terms: [...] } */
export function sectorMatch(sentence, sector) {
  const s = String(sentence || ''); const toks = new Set(contentTokens(s)); const terms = []; const famHit = new Set(); let specific = false;
  for (const t of sector.tokens) if (toks.has(t)) { terms.push(t); specific = true; }
  for (const f of FAMILIES) {
    if (!sector.families.includes(f.id)) continue;
    for (const rx of f.specific) { const m = rx.exec(s); if (m) { terms.push(m[0]); famHit.add(f.id); specific = true; } }
    for (const rx of f.broad) { const m = rx.exec(s); if (m) { terms.push(m[0]); famHit.add(f.id); } }
  }
  // Cruce: si el brief es IA + ciencias de la vida, una frase que junta las dos a pocas palabras («AI-life sciences», «AI-native life sciences», «TechBio»,
  // «computationally-enabled therapeutic platforms») ES la tesis de este brief. Dos familias amplias sueltas en una lista («AI, biotech, fintech») siguen siendo amplias.
  if (!specific && sector.families.includes('ai') && sector.families.includes('drug_discovery')) {
    const AI = /\b(?:AI|artificial intelligence|machine learning|deep learning|computation(?:al|ally)?)\b[-\w]*/gi; const LS = /\b(?:life[- ]sciences?|therapeutics?|therapeutic platforms?|biotech(?:nology)?|biopharma\w*|drug (?:discovery|development)|pharmaceuticals?|biology)\b/gi;
    // «AI-native life sciences» sí; «biotech and AI companies» (dos sectores en lista) no: entre las dos no puede haber coma, «and», «&», «or» ni punto y coma.
    const ais = [...s.matchAll(AI)].map((m) => [m.index, m.index + m[0].length]); const lss = [...s.matchAll(LS)].map((m) => [m.index, m.index + m[0].length]);
    const joined = (x, y) => { const [from, to] = x[1] <= y[0] ? [x[1], y[0]] : y[1] <= x[0] ? [y[1], x[0]] : [0, 0]; const gap = s.slice(from, to); return to - from <= 40 && !/[,;&]|\b(?:and|or)\b/i.test(gap); };
    const near = ais.some((a) => lss.some((l) => joined(a, l))); const techbio = /\btechbio\b/i.test(s);
    if (near || techbio) { specific = true; terms.push(techbio ? 'techbio' : 'ai × life sciences'); }
  }
  if (!terms.length) return { level: null, terms: [] };
  return { level: specific ? 'specific' : 'broad', terms: [...new Set(terms.map((t) => t.toLowerCase()))] };
}

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const stripRoute = (phrase) => clean(String(phrase).split(/\s+/).filter((w) => { const t = contentTokens(w)[0]; return !t || !ROUTE.has(t); }).join(' '));

/** Consultas cortas para encontrar inversionistas (el código las escribe; el modelo no decide qué fondo buscar). */
/** Término de sector «padre» por familia: como los fondos se describen («biotech», «obesity», «digital health»), no como el brief. */
const PARENT = { drug_discovery: 'biotech', metabolic: 'obesity biotech', neuro: 'neuroscience biotech', cannabinoid: 'cannabinoid biotech', digital_health: 'digital health', genomics: 'genomics', ai: 'AI' };
export function investorQueries(brief = {}, n = 12) {
  const exact = exactTerms(brief);
  const invest = exact.filter((t) => /\b(investor|investors|venture|vc|fund|capital|seed)\b/i.test(t));
  const topics = [...new Set(exact.map(stripRoute).filter((t) => contentTokens(t).length >= 1 && t.length >= 3))];
  if (!topics.length) { const ind = stripRoute(String(brief.industry || '').split(/\s+/).slice(0, 3).join(' ')); if (ind) topics.push(ind); }
  const [t1, t2 = topics[0]] = topics;
  const out = [
    ...invest.slice(0, 2),
    t1 && `${t1} venture capital firm`,
    t2 && `${t2} seed investors`,
    t1 && `top ${t1} venture capital firms`,
    t1 && `${t1} startup raises seed round led by`,
    t2 && `${t2} corporate venture capital`,
    ...invest.slice(2),
  ];
  // Arquetipos que las consultas por tema no traen: brazos de venture de farmacéuticas, fondos de creación de empresas, rondas con sus inversores, listas de «más activos».
  const fam = sectorOf(brief).families; const parents = [...new Set(fam.map((f) => PARENT[f]).filter(Boolean))];
  const p1 = parents.find((p) => p !== 'AI') || parents[0] || t1; const p2 = parents.find((p) => p !== p1 && p !== 'AI') || p1;
  if (fam.includes('drug_discovery') || fam.includes('metabolic') || fam.includes('neuro')) out.push('pharma corporate venture capital arms', `${p1} company creation venture fund`);
  out.push(p1 && `most active ${p1} seed investors`, t1 && `${t1} funding round investors include`, p2 && `${p2} Series A led by participation from`, p1 && `${p1} venture fund early-stage pitch founders`, p1 && `${p1} venture capital list`);
  const queries = out.filter(Boolean).map(clean);
  const seen = new Set(); return queries.filter((q) => { const k = q.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); if (!k || seen.has(k)) return false; seen.add(k); return true; }).slice(0, n);
}
