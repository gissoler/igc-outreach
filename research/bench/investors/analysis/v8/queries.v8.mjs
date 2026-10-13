// V8 (PROMPT-v10): consultas del diagnóstico de alcanzabilidad, generadas por plantilla desde el perfil del caso.
// La misma plantilla para p01–p12: no se escriben a mano ni se ajustan a un oro. Ninguna consulta lleva el nombre del oro
// (lo comprueba investors.v8.test.mjs). Los oros se leen de cases/ solo para medir; no se modifican.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { esc, clean, STAGE, list, region, regionAnd, stage, listQueries } from '../../list-discovery.v8.mjs';
export { listQueries };
export const INV = resolve(import.meta.dirname, '../..');
export const CASES_A = ['p01', 'p02', 'p03', 'p04', 'p05', 'p06'];   // elección de variantes
export const CASES_B = ['p07', 'p08', 'p09', 'p10', 'p11', 'p12'];   // confirmación (el motor no los ha visto)
// Formas del nombre del oro para buscarlo en el texto (variantes c y d). El dominio sale de cases/ (official_url).
export const GOLD_ALIASES = {
  p01: ['Magma Partners'], p02: ['Lightrock'], p03: ['Celesta Capital', 'Celesta'], p04: ['Golden Ventures'], p05: ['World Fund'], p06: ['eCAPITAL'],
  p07: ['Novastar Ventures', 'Novastar'], p08: ['Ventures Platform'], p09: ['A91 Partners', 'A91'], p10: ['Endiya Partners', 'Endiya'], p11: ['Clime Capital', 'SEACEF'], p12: ['SGInnovate']
};
export const host = u => { try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ''); } catch { return null; } };
export const sameSite = (u, dom) => { const h = host(u); return !!h && (h === dom || h.endsWith(`.${dom}`)); };
export const nameIn = (text, aliases) => aliases.some(a => new RegExp(`(^|[^\\p{L}\\p{N}])${esc(a)}([^\\p{L}\\p{N}]|$)`, 'iu').test(text ?? ''));

export function loadCase(c) {
  const kase = JSON.parse(readFileSync(resolve(INV, `cases/inv-case-syn-${c}.json`), 'utf8'));
  const prof = JSON.parse(readFileSync(resolve(INV, `cases/profiles/inv-case-syn-${c}.json`), 'utf8'));
  const f = Object.fromEntries(Object.entries(prof.fields).map(([k, v]) => [k, v && typeof v === 'object' && 'value' in v ? v.value : v]));
  const a = kase.anchors[0];
  return { case: c, fields: f, gold: { domain: host(a.official_url), aliases: GOLD_ALIASES[c] } };
}
const TYPE = { generalist_vc: 'venture capital', specialist_vc: 'specialist venture capital', growth_investor: 'growth investor', climate_vc: 'climate venture capital', impact_investor: 'impact investor', hardtech_vc: 'hardware deep tech venture capital' };
const deName = (f, s) => clean(String(s ?? '').replace(new RegExp(esc(String(f.name ?? '').replace(/\s*\(SYN\)\s*/, '')), 'g'), 'the company').replace(/\(SYN\)/g, ''));
const firstSentence = s => (String(s ?? '').match(/^.*?[.!?](\s|$)/)?.[0] ?? String(s ?? '')).trim();

/** Variante base y b (mismas consultas): 3 consultas cortas por plantilla. */
export const shortQueries = f => [
  clean(`${stage(f)} venture capital ${f.sector} ${region(f)}`),
  clean(`venture capital firm investing in ${list(f.subsectors)[0]} startups ${region(f)}`),
  clean(`${stage(f)} VC fund ${list(f.subsectors).slice(0, 2).join(' ')} ${region(f)}`)
];
/** Variante e: 3 consultas largas que copian el lenguaje del brief (producto, descripción, ronda). */
export const longQueries = f => [
  clean(`${stage(f)} investor for a startup building ${deName(f, f.product)} in ${regionAnd(f)}`),
  clean(`venture capital firm that invests in companies like this: ${deName(f, firstSentence(f.description))}`),
  clean(`${list(f.accepted_investor_types).map(t => TYPE[t] ?? t.replace(/_/g, ' '))[0]} investing in ${f.sector} companies (${list(f.subsectors).join(', ')}) in ${regionAnd(f)} at ${stage(f)}, round of about USD ${Math.round((f.capital_sought_usd ?? 0) / 1e5) / 10} million`)
];
/** Variante c, paso 1: empresas del mismo sector, etapa y geografía (Exa category company). */
export const companyQuery = f => clean(`${stage(f)} startup ${deName(f, f.product)} ${region(f)}`);
/** Variante c, paso 2: consulta de inversiones por empresa. */
export const investorsOfQuery = (f, company) => clean(`${company} ${stage(f)} funding round investors`);
/** Nombre de empresa desde un resultado: parte del título antes de un separador; si no hay título, el dominio. */
export function companyName(row) {
  const t = clean(String(row.title ?? '').split(/\s[|–—:·-]\s|\s\|\s|:\s/)[0]);
  if (t && t.length <= 40 && t.split(' ').length <= 5) return t;
  const h = host(row.url) ?? ''; return h.split('.')[0];
}
