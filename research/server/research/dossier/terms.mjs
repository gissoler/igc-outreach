/* ─────────────────────────────────────────────────────────────────────────────
   V15 · Términos del brief para buscar y ordenar convocatorias (sin modelo).
   Por qué existe (RD-04, runs-v6): las semillas del registro usaban frases largas con
   palabras de relleno («Alzheimer's genomics grant») y el buscador con AND devolvía 0.
   Aquí se sacan consultas CORTAS (1–3 palabras de contenido) y pesos por término para
   ordenar un pool grande de convocatorias oficiales. No se infiere nada fuera del brief.
   ───────────────────────────────────────────────────────────────────────────── */

/** Palabras que no distinguen una convocatoria de otra (relleno de búsqueda, verbos de financiación, genéricos). */
const STOP = new Set(('a an and or the of for to in on at by with from into via per as is are be this that these those its it their our your ' +
  'grant grants funding fund funds funded call calls opportunity opportunities announcement program programs programme research ' +
  'researchers project projects application applications apply award awards support supported proposal proposals new novel ' +
  'based assisted using use including related associated identification planning platform capability claim stage early ' +
  'nofo foa rfa rfp notice solicitation competition prize prizes ' +
  'any all each other some such no not only also than then there here which who whom whose what when where why how ' +
  'can could may might must shall should will would do does did done has have had having been being was were ' +
  'intended intend identify generate remain remains without within across about after before over under up down out ' +
  'more most less least very much many few one two three first second include includes follow previously unreported ' +
  'unknown unvalidated validated status claim claims team supplied possibly').split(/\s+/));

/** Raíz ligera: minúsculas, sin posesivo ni plural regular («Alzheimer's» → alzheimer, genomics → genomic). */
export function stem(word) {
  let w = String(word || '').toLowerCase().replace(/[’']s$/, '').replace(/[’']/g, '');
  if (w.length > 5 && w.endsWith('ies')) w = `${w.slice(0, -3)}y`;
  else if (w.length > 4 && w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us') && !w.endsWith('is')) w = w.slice(0, -1);
  return w;
}

/** Tokens de contenido de un texto (con raíz), sin relleno. «AD/ADRD» → ad, adrd. */
export function contentTokens(text) {
  return String(text || '').replace(/[’']s\b/g, '').split(/[^A-Za-z0-9]+/).map(stem).filter((t) => t.length >= 2 && !STOP.has(t) && !/^\d+$/.test(t));
}

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
/** Palabras visibles (sin raíz) de una frase, sin relleno; conserva la forma original para buscar. */
function contentWords(phrase) {
  return clean(phrase).split(/\s+/).map((w) => w.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9’']+$/g, '')).filter((w) => w && !STOP.has(stem(w.replace(/[’']s$/i, ''))));
}

/** «Exact search terms: a; b; c» de constraints (formato que ya usan los perfiles del Pipeline I+D). */
export function exactTerms(brief = {}) {
  const raw = String(brief.constraints || '').match(/exact (?:search )?terms?\s*:\s*([^\n]+)/i)?.[1] || '';
  return raw.split(/[;\n]/).map((t) => clean(t.replace(/\.$/, ''))).filter((t) => t.length >= 3);
}

/**
 * Términos del brief.
 *  - `phrases`: consultas cortas para registros (máx. 3 palabras de contenido cada una).
 *  - `anchor`: primera palabra de contenido de industry (en los perfiles es el dominio: «Alzheimer», «dementia», «obesity»).
 *  - `weights`: token con raíz → peso (frases exactas e industria pesan 1; producto y descripción 0,6).
 *  - `extra`: términos del modelo (opcional) se suman con peso 0,8 y nunca reemplazan los del brief.
 */
export function briefTerms(brief = {}, { extra = [], maxPhrases = 10 } = {}) {
  const weights = new Map();
  const add = (text, w) => { for (const t of contentTokens(text)) weights.set(t, Math.max(weights.get(t) || 0, w)); };
  const exact = exactTerms(brief);
  for (const t of exact) add(t, 1);
  add(brief.industry, 1); add(brief.oneLiner, 0.8); add(brief.product, 0.6); add(brief.description, 0.4); add(brief.useOfFunds, 0.3);
  for (const t of extra) add(t, 0.8);
  const industryWords = contentWords(brief.industry);
  const anchor = industryWords[0] || contentWords(brief.oneLiner)[0] || contentWords(exact[0])[0] || '';
  const phrases = [];
  const keys = new Set();
  const push = (words) => { const q = clean(words.slice(0, 3).join(' ')); const key = contentTokens(q).join(' '); if (q.length >= 3 && key && !keys.has(key)) { keys.add(key); phrases.push(q); } };
  for (const t of exact) push(contentWords(t));
  // Industria: el ancla con cada término siguiente («Alzheimer GWAS», «Alzheimer polygenic»…).
  for (const w of industryWords.slice(1)) push([anchor, w]);
  for (const t of extra) push(contentWords(t));
  if (anchor) push([anchor]);
  return { anchor, phrases: phrases.slice(0, maxPhrases), weights, exact };
}

/** Puntaje BM25 simple de documentos ({id, text, title}) contra los pesos del brief. El IDF sale del propio pool. */
export function scoreDocs(docs, weights, { titleBoost = 2.5, k1 = 1.2, b = 0.6 } = {}) {
  const tokenized = docs.map((d) => { const title = contentTokens(d.title); const body = contentTokens(d.text); return { title, body, len: title.length * titleBoost + body.length }; });
  const N = docs.length || 1; const avg = tokenized.reduce((n, t) => n + t.len, 0) / N || 1; const df = new Map();
  for (const t of tokenized) for (const tok of new Set([...t.title, ...t.body])) if (weights.has(tok)) df.set(tok, (df.get(tok) || 0) + 1);
  return tokenized.map((t) => {
    const tf = new Map();
    for (const tok of t.title) if (weights.has(tok)) tf.set(tok, (tf.get(tok) || 0) + titleBoost);
    for (const tok of t.body) if (weights.has(tok)) tf.set(tok, (tf.get(tok) || 0) + 1);
    let score = 0; const matched = [];
    for (const [tok, f] of tf) {
      const idf = Math.log(1 + (N - (df.get(tok) || 0) + 0.5) / ((df.get(tok) || 0) + 0.5));
      score += weights.get(tok) * idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + b * (t.len / avg)))); matched.push(tok);
    }
    return { score: Math.round(score * 100) / 100, matched };
  });
}
