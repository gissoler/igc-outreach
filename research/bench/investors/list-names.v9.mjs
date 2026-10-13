// V9: extractor determinista de nombres de firmas en páginas de listas (tablas, encabezados, líneas cortas, listas con comas,
// enlaces, y nombres con sufijo de firma en el texto). Sin LLM y sin conocer ningún nombre: los nombres son pistas; una firma
// solo cuenta si su sitio oficial pasa el extractor con cita literal (regla sin cambios).
const SUFFIX = '(?:Ventures?|Capital|Partners|Fund|VC|Investments?|Equity|Labs|Holdings|Group|Management|Investors|Advisors|Accelerator|Asset Management)';
const FIRM_IN_PROSE = new RegExp(`\\b((?:[A-Z0-9][\\p{L}0-9&'’.\\-]*|[a-z]+[A-Z][\\p{L}0-9]*)(?:[ \\t]+(?:[A-Z0-9][\\p{L}0-9&'’.\\-]*|de|da|do|of|&|[a-z]+[A-Z][\\p{L}0-9]*)){0,4}[ \\t]+${SUFFIX})\\b`, 'gu');
// Tipo de inversor que las tablas de agregadores pegan al nombre ("X VC Fund", "X Angel").
const TYPE_TAIL = /\s+(?:VC Fund|PE Fund|Corporate VC|Corporate Venture|Family Office|Angel Network|Angel Group|Angel|Accelerator|Incubator|Micro VC|Venture Capital|Private Equity|Investment Bank|Government|University|Investor)$/i;
const GENERIC = new Set(('investor investors relevant deals geography stage stages focus round size home about contact portfolio team news blog insights press careers login sign up show more read more view profile '
  + 'the a an and or of in for to with by on at from top best list lists directory database guide report startup startups company companies firm firms fund funds vc vcs venture ventures capital partners '
  + 'seed pre-seed preseed series growth early late stage angel angels accelerator accelerators incubator round rounds funding investment investments investing financing deal deals total amount '
  + 'type website headquarters founded year headcount number location locations sector sectors industry industries country countries region regions market markets name names rank ranking '
  + 'more less new all other others overview summary faq faqs privacy terms cookies cookie policy subscribe newsletter menu search filters filter sort table description profile profiles '
  + 'january february march april may june july august september october november december jan feb mar apr jun jul aug sep sept oct nov dec united states kingdom america europe asia africa latin '
  + 'north south east west central middle llc ltd inc gmbh plc sa bv ag pte co corp corporation limited unknown n/a none').split(/\s+/));
export const nameKey = s => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
/** Limpia un nombre propuesto: iniciales de avatar, numeración, tipo pegado, puntuación final. Devuelve null si no parece nombre. */
export function cleanName(raw, { extraGeneric = [] } = {}) {
  let s = String(raw ?? '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`#>]+/g, ' ').replace(/\s+/g, ' ').trim();
  s = s.replace(/^(?:\d{1,3}[.)]\s+|#\d+\s+|[-•·]\s+)/, '');            // "4. X", "#6 X", "- X"
  s = s.replace(/^([A-Z0-9]{2})\s+(?=\S)/, (m, ini, off, str) => { const rest = str.slice(m.length); return nameKey(rest).replace(/\s/g, '').startsWith(nameKey(ini)) ? '' : m; });   // iniciales de avatar: "QU Quanta …"
  for (let i = 0; i < 2; i++) s = s.replace(TYPE_TAIL, '');
  s = s.replace(/\s*[|:–—-]\s*$/, '').replace(/[.,;:!?)]+$/, '').replace(/^[(\s]+/, '').trim();
  if (s.length < 2 || s.length > 60) return null;
  const words = s.split(' ');
  if (words.length > 6) return null;
  if (!/[A-Z0-9]/.test(s[0]) && !/^[a-z]+[A-Z]/.test(s)) return null;    // empieza en mayúscula o en minúscula seguida de mayúsculas ("xYZ")
  if (/https?:|www\.|@|\$|%|\d{4}-\d{2}|,|;/.test(s)) return null;
  const k = nameKey(s), toks = k.split(' ').filter(Boolean), gen = new Set([...GENERIC, ...extraGeneric.map(nameKey).flatMap(x => x.split(' '))]);
  if (!toks.length || toks.every(t => gen.has(t) || /^\d+$/.test(t) || t.length === 1)) return null;
  if (toks.length === 1 && toks[0].length < 3) return null;
  return s;
}
/** Nombres de firma candidatos de una página. Devuelve [{name, key, how, raw}] sin repetir clave. */
export function extractListNames(text, opts = {}) { return extractListNamesRaw(text, opts); }
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** ¿La página nombra la clave? (comparación por clave normalizada con límites de palabra) */
export const pageCites = (pageKeyText, key) => new RegExp(`(^| )${esc(key)}( |$)`).test(pageKeyText);
/**
 * Ordena los nombres de varias páginas por número de páginas distintas que los citan (desc), luego por primer puesto de aparición.
 * pages: [{url, text}]. Devuelve [{name, key, pages, first}].
 */
export function rankListNames(pages, opts = {}) {
  const keyed = pages.map(p => ({ url: p.url, kt: ` ${nameKey(p.text)} ` }));
  const all = new Map(); let order = 0;
  pages.forEach((p, pi) => { for (const c of extractListNames(p.text, opts)) if (!all.has(c.key)) all.set(c.key, { ...c, first: order++, page: pi }); });
  const ranked = [...all.values()].map(c => ({ ...c, pages: new Set(keyed.filter(k => pageCites(k.kt, c.key)).map(k => k.url)).size }));
  ranked.sort((a, b) => b.pages - a.pages || a.first - b.first);
  return ranked;
}

const SUFFIX_RE = new RegExp(`\\b${SUFFIX}\\b`, 'i');
/** Filtro "parece firma": sufijo de firma, o viene de una estructura de lista (fila de tabla, lista de inversores, encabezado numerado). */
export const firmLike = c => SUFFIX_RE.test(c.name) || c.how === 'table' || c.how === 'investors_list' || (c.how === 'heading' && /^\s*#*\s*\d{1,3}[.)]/.test(c.raw ?? ''));
/**
 * Variantes de orden para medir techos. mode: 'pages' (páginas que citan), 'position' (mejor puesto dentro de una página, entre
 * nombres que parecen firma), 'firm_pages' (solo los que parecen firma, por páginas). Devuelve la lista ordenada.
 */
export function rankVariant(pages, mode, opts = {}) {
  const keyed = pages.map(p => ` ${nameKey(p.text)} `), all = new Map();
  pages.forEach((p, pi) => {
    let pos = 0;
    for (const c of extractListNamesRaw(p.text, opts)) {
      if (mode !== 'pages' && !firmLike(c)) continue;
      pos++;
      const cur = all.get(c.key);
      if (!cur) all.set(c.key, { ...c, best: pos, first: all.size });
      else if (pos < cur.best) cur.best = pos;
    }
  });
  const r = [...all.values()].map(c => ({ ...c, pages: keyed.filter(t => pageCites(t, c.key)).length }));
  if (mode === 'position') r.sort((a, b) => a.best - b.best || b.pages - a.pages || a.first - b.first);
  else r.sort((a, b) => b.pages - a.pages || a.first - b.first);
  return r;
}
/** Como extractListNames pero conserva el texto crudo (para saber si un encabezado estaba numerado). */
export function extractListNamesRaw(text, opts = {}) {
  const out = new Map(), t = String(text ?? '');
  const add = (raw, how) => { const n = cleanName(raw, opts); if (!n) return; const k = nameKey(n); if (!out.has(k)) out.set(k, { name: n, key: k, how, raw }); };
  const lines = t.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\|/.test(l)) { const cells = l.split('|').map(c => c.trim()).filter(Boolean); if (cells.length >= 2 && !/^-{3,}$/.test(cells[0])) add(cells[0], 'table'); continue; }
    const h = l.match(/^#{1,6}\s+(.+)$/); if (h) { add(h[1], 'heading'); continue; }
    if (l.split(/\s+/).length <= 6 && !/[.!?]$/.test(l)) add(l, 'line');
    const inv = l.match(/^(?:investors?|backers?|backed by|lead investors?|notable investors?)\s*[:\-]?\s*(.+)$/i);
    if (inv && inv[1].includes(',')) for (const p of inv[1].split(/,|\band\b/)) add(p, 'investors_list');
    if (/^investors?$/i.test(l) && lines[i + 1]?.includes(',')) for (const p of lines[i + 1].split(/,|\band\b/)) add(p, 'investors_list');
    for (const m of l.matchAll(/\[([^\]]{2,60})\]\((?:https?:)?[^)]*\)/g)) add(m[1], 'link');
    for (const m of l.matchAll(FIRM_IN_PROSE)) add(m[1], 'prose');
  }
  return [...out.values()];
}
