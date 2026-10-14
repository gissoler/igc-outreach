/* Inversores y socios: ¿la página es de UN financiador real? Reglas genéricas, sin nombres de fondos.
   · selfPage: la página trata de la propia empresa o producto del brief (no es un inversor).
   · shortName: el nombre de la fila es el de la organización, no una frase de la página.
   · NOT_FUNDER_TYPES: tipos de página que nunca son un financiador (artículos, informes, listas, eventos). */
export const NOT_FUNDER_TYPES = new Set(['report', 'blog', 'news', 'event', 'directory', 'cohort_announcement']);

const LEGAL = /\b(inc|llc|ltd|limited|corp|corporation|co|sas|sl|s\.l|s\.a|gmbh|bv|plc)\b\.?/gi;
const plain = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(LEGAL, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().toLowerCase();
const initials = (s) => { const w = String(s || '').split(/[^\p{L}\p{N}]+/u).filter((x) => /^[A-Z]/.test(x) && !/^(For|And|Of|The|De|La|El)$/.test(x)); return w.length >= 3 ? w.slice(0, 3).map((x) => x[0]).join('') : ''; };

export function selfPage(page = {}, brief = {}) {
  const title = plain(page.title); const text = plain(String(page.text || '').slice(0, 20000)); const head = `${title} ${plain(String(page.text || '').slice(0, 600))}`;
  let host = ''; try { host = new URL(page.url).hostname.replace(/^www\./, '').split('.').slice(0, -1).join('').replace(/[^a-z0-9]/g, ''); } catch { /* sin URL */ }
  const names = [brief.company, brief.venture, brief.organization, brief.product].map((x) => plain(String(x || '').split(/\s+(?:for|para)\s+/i)[0])).filter((n) => n.length >= 4 && n.split(' ').length <= 5);
  for (const n of new Set(names)) {
    if (host && host === n.replace(/ /g, '')) return { self: true, why: `host = ${n}` };
    if (new RegExp(`(^| )${n}( |$)`).test(head)) return { self: true, why: `title or opening mentions ${n}` };
  }
  for (const raw of [brief.product, brief.venture, brief.company]) {
    const ini = initials(String(raw || '').split(/\s+(?:for|para)\s+/i)[0]); if (ini.length < 3) continue;
    const re = new RegExp(`\\b${ini}\\b`, 'g'); const n = (String(page.text || '').match(re) || []).length;
    if (new RegExp(`\\b${ini}\\b`).test(String(page.title || '')) || n >= 3) return { self: true, why: `product acronym ${ini} (${n}×)` };
  }
  return { self: false, why: '' };
}

/** «IGC Pharma, Inc. is a clinical-stage biotech…» → «IGC Pharma, Inc.»; si no queda un nombre razonable, la etiqueta del dominio. */
export function shortName(about, url = '') {
  const s = String(about || '').replace(/\s+/g, ' ').trim();
  if (s && s.length <= 70 && !/\b(?:is|are|was)\s+(?:a|an|the)\b/i.test(s)) return s;
  const cut = s.split(/\s+(?:is|are|was)\s+(?:a|an|the)\b|,\s+(?:a|an|the)\s|\s[-–—|:]\s|;\s/i)[0].trim();
  if (cut.length >= 3 && cut.length <= 70) return cut;
  try { const h = new URL(url).hostname.replace(/^www\./, '').split('.'); const label = h.length >= 3 && h.at(-1).length === 2 && h.at(-2).length <= 3 ? h.at(-3) : h.at(-2); return label ? label[0].toUpperCase() + label.slice(1) : s.slice(0, 70); } catch { return s.slice(0, 70); }
}
