// Resolución de entidades de fondos, personas y startups para la capa de análisis.
// Es un port fiel de backend/src/warmpath/normalize.py (norm_org, jaro_winkler) y de los umbrales de
// backend/src/warmpath/resolve.py (AUTO_MERGE = 0.92, REVIEW_LOW = 0.60), para que Node y Python
// produzcan los mismos ids. Los tests de paridad usan los mismos casos que backend/tests/test_units.py.
import { createHash } from 'node:crypto';

export const AUTO_MERGE = 0.92;
export const REVIEW_LOW = 0.6;

const ORG_STOP = new Set(['lp', 'l p', 'llc', 'l l c', 'inc', 'incorporated', 'corp', 'corporation', 'ltd', 'limited',
  'co', 'company', 'gp', 'plc', 'sa', 'sas', 'gmbh', 'bv', 'ag', 'the', 'fund', 'funds',
  'partners fund', 'opportunity', 'opportunities', 'annex', 'side', 'car', 'spv', 'series',
  'feeder', 'parallel', 'offshore', 'onshore', 'master', 'holdings', 'a', 'b', 'c']);
// Palabras genéricas que no identifican a un fondo; se quitan solo para la clave de coincidencia.
const GENERIC = new Set(['ventures', 'venture', 'capital', 'partners', 'vc', 'management', 'investments', 'investment', 'group', 'advisors', 'equity', 'fondo', 'inversiones', 'asset', 'labs']);

const stripAccents = (s) => String(s).normalize('NFKD').replace(/[̀-ͯ]/g, '');
export const normText = (s) => stripAccents(s ?? '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** 'Acme Ventures Fund III, L.P.' -> 'acme ventures' (igual que norm_org de Python). */
export function normOrg(name) {
  let raw = stripAccents(String(name ?? '')).toLowerCase();
  raw = raw.replace(/\bl\.\s?l\.\s?c\.?|\bl\.\s?p\.?(?=\W|$)/g, ' ');
  let s = normText(raw);
  s = s.replace(/\b(i{1,3}|iv|v|vi{0,3}|ix|x|xi{0,3})\b/g, ' ').replace(/\b\d+\b/g, ' ');
  return s.split(/\s+/).filter((t) => t && !ORG_STOP.has(t)).join(' ');
}

// Alias verificables de uso común. Ampliar solo con alias que aparezcan en la propia fuente o en la web del fondo.
export const FUND_ALIASES = {
  'a16z': 'andreessen horowitz',
  'a16z bio health': 'andreessen horowitz',
  'a16z bio': 'andreessen horowitz',
  'gc': 'general catalyst',
  'kv': 'khosla ventures',
  'nea': 'new enterprise associates',
  'yc': 'y combinator',
  'gv': 'gv',
  'google ventures': 'gv',
  'lsvp': 'lightspeed venture partners',
  'lightspeed': 'lightspeed venture partners',
  'sequoia': 'sequoia capital',
  'kaszek ventures': 'kaszek',
  'softbank latin america fund': 'softbank',
  'softbank vision fund': 'softbank',
};

/** Clave de coincidencia de fondo: alias → norm_org → sin palabras genéricas (si queda algo distintivo). */
export function fundKey(name) {
  const n = normOrg(name);
  if (!n) return '';
  if (FUND_ALIASES[n]) return normOrg(FUND_ALIASES[n]);
  const core = n.split(' ').filter((t) => !GENERIC.has(t)).join(' ');
  const key = core.length >= 3 ? core : n;
  return FUND_ALIASES[key] ? normOrg(FUND_ALIASES[key]) : key;
}
export const fundId = (name) => { const k = fundKey(name); return k ? `f:nm:${k.replace(/ /g, '-')}` : ''; };
export const startupKey = (name) => normOrg(name);
export const personKey = (name) => normText(String(name ?? '').replace(/\b(dr|mr|mrs|ms|prof|phd|md|mba|jr|sr)\b\.?/gi, ' '));

/** Jaro-Winkler puro (mismo algoritmo que normalize.jaro_winkler). */
export function jaroWinkler(a, b) {
  if (a === b) return a ? 1 : 0;
  const la = a.length, lb = b.length;
  if (!la || !lb) return 0;
  const rng = Math.max(0, Math.floor(Math.max(la, lb) / 2) - 1);
  const am = new Array(la).fill(false), bm = new Array(lb).fill(false);
  let m = 0;
  for (let i = 0; i < la; i++) {
    const lo = Math.max(0, i - rng), hi = Math.min(i + rng + 1, lb);
    for (let j = lo; j < hi; j++) if (!bm[j] && b[j] === a[i]) { am[i] = bm[j] = true; m++; break; }
  }
  if (!m) return 0;
  let t = 0, k = 0;
  for (let i = 0; i < la; i++) if (am[i]) { while (!bm[k]) k++; if (a[i] !== b[k]) t++; k++; }
  t /= 2;
  const jaro = (m / la + m / lb + (m - t) / m) / 3;
  let pref = 0;
  for (let i = 0; i < Math.min(4, la, lb); i++) { if (a[i] !== b[i]) break; pref++; }
  return jaro + pref * 0.1 * (1 - jaro);
}

/** ¿Es el mismo fondo? 'auto' (se fusiona), 'review' (cola humana) o 'no'. */
export function matchFunds(a, b) {
  const ka = fundKey(a), kb = fundKey(b);
  if (!ka || !kb) return { decision: 'no', score: 0 };
  if (ka === kb) {
    // 'Kaszek' ~ 'Kaszek Ventures' se fusiona; 'Magma Partners' ~ 'Magma Capital' (palabras genéricas distintas) va a revisión.
    const ga = normOrg(a).split(' ').filter((t) => GENERIC.has(t)), gb = normOrg(b).split(' ').filter((t) => GENERIC.has(t));
    const aliased = FUND_ALIASES[normOrg(a)] || FUND_ALIASES[normOrg(b)];
    if (aliased || !ga.length || !gb.length || ga.join() === gb.join()) return { decision: 'auto', score: 1, method: 'normalized key/alias' };
    return { decision: 'review', score: 0.9, method: 'same root, different generic suffix' };
  }
  const score = jaroWinkler(ka, kb);
  const sameFirst = ka.split(' ')[0] === kb.split(' ')[0];
  if (score >= AUTO_MERGE && sameFirst && Math.min(ka.length, kb.length) >= 6) return { decision: 'auto', score, method: 'jaro-winkler' };
  if (score >= REVIEW_LOW + 0.25) return { decision: 'review', score, method: 'jaro-winkler' };
  return { decision: 'no', score };
}

/** Agrupa nombres de fondos en entidades canónicas. Devuelve {canonical: Map(name→id), review: [...]}. */
export function resolveFundNames(names) {
  const ids = new Map();
  const reps = []; // {id, key, label}
  const review = [];
  for (const name of [...new Set(names.map((n) => String(n || '').trim()).filter(Boolean))]) {
    let hit = reps.find((r) => matchFunds(r.label, name).decision === 'auto');
    if (!hit) {
      for (const r of reps) { const m = matchFunds(r.label, name); if (m.decision === 'review') review.push({ left: r.label, right: name, score: Math.round(m.score * 1000) / 1000 }); }
      let id = fundId(name) || `f:h:${createHash('sha1').update(name).digest('hex').slice(0, 10)}`;
      if (reps.some((r) => r.id === id)) id = `f:nm:${normOrg(name).replace(/ /g, '-')}`;
      hit = { id, label: name };
      reps.push(hit);
    }
    ids.set(name, hit.id);
  }
  return { ids, review };
}
