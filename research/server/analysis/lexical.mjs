// Similitud léxica (TF-IDF + coseno) y BM25: respaldo cuando la flota no está disponible y
// componente de la búsqueda híbrida. Bilingüe (inglés/español), sin dependencias.
const STOP = new Set('a an and are as at be by for from has have in into is it its of on or that the this to was were will with de del la las el los en y o u un una para por con que se su sus al lo como más mas'.split(' '));
export const tokens = (text) => String(text || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter((t) => t.length > 1 && !STOP.has(t));

export function tfidfIndex(docs) {
  const df = new Map();
  const tfs = docs.map((d) => { const tf = new Map(); for (const t of tokens(d)) tf.set(t, (tf.get(t) || 0) + 1); for (const t of tf.keys()) df.set(t, (df.get(t) || 0) + 1); return tf; });
  const n = docs.length;
  const idf = (t) => Math.log((n + 1) / ((df.get(t) || 0) + 1)) + 1;
  const vec = (tf) => { const v = new Map(); let norm = 0; for (const [t, c] of tf) { const w = (1 + Math.log(c)) * idf(t); v.set(t, w); norm += w * w; } norm = Math.sqrt(norm) || 1; for (const [t, w] of v) v.set(t, w / norm); return v; };
  const vecs = tfs.map(vec);
  return {
    vectors: vecs,
    query(text) { const tf = new Map(); for (const t of tokens(text)) tf.set(t, (tf.get(t) || 0) + 1); return vec(tf); },
    sim(a, b) { let s = 0; const [x, y] = a.size < b.size ? [a, b] : [b, a]; for (const [t, w] of x) s += w * (y.get(t) || 0); return s; },
  };
}

export function bm25Index(docs, { k1 = 1.2, b = 0.75 } = {}) {
  const toks = docs.map(tokens);
  const avg = toks.reduce((n, t) => n + t.length, 0) / Math.max(1, toks.length);
  const df = new Map();
  for (const t of toks) for (const w of new Set(t)) df.set(w, (df.get(w) || 0) + 1);
  const N = toks.length;
  return {
    search(query) {
      const q = [...new Set(tokens(query))];
      return toks.map((t, i) => {
        const tf = new Map(); for (const w of t) tf.set(w, (tf.get(w) || 0) + 1);
        let s = 0;
        for (const w of q) { const f = tf.get(w) || 0; if (!f) continue; const idf = Math.log(1 + (N - df.get(w) + 0.5) / (df.get(w) + 0.5)); s += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * t.length / avg)); }
        return { index: i, score: s };
      }).filter((r) => r.score > 0).sort((a, b) => b.score - a.score);
    },
  };
}

/** Reciprocal Rank Fusion de varias listas [{index}] ordenadas. */
export function rrf(lists, k = 60) {
  const s = new Map();
  for (const list of lists) list.forEach((r, rank) => s.set(r.index, (s.get(r.index) || 0) + 1 / (k + rank + 1)));
  return [...s.entries()].map(([index, score]) => ({ index, score })).sort((a, b) => b.score - a.score);
}
