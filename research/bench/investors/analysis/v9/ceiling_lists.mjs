// V9 paso 1 (solo relectura, sin red ni LLM): oro nombrado y oro como candidato en páginas de listas, puesto del oro al
// ordenar por número de páginas que citan a cada firma, y firmas distintas por caso. Fuentes: diag (texto Exa ≤10k, p01–p12)
// y full (páginas completas abiertas por v8, p01–p06).
import { diagListRows, v8ListPages, loadCase, nameIn, CASES_A, CASES_B, closeAll } from './data.v9.mjs';
import { rankListNames, nameKey } from '../../list-names.v9.mjs';
// Nombres con los que el oro resolvería a SU dominio (p11: el gestor tiene otro dominio, no cuenta).
export const GOLD_NAMES_V9 = { p01: ['Magma Partners'], p02: ['Lightrock'], p03: ['Celesta Capital', 'Celesta'], p04: ['Golden Ventures'], p05: ['World Fund'], p06: ['eCAPITAL'],
  p07: ['Novastar Ventures', 'Novastar'], p08: ['Ventures Platform'], p09: ['A91 Partners', 'A91'], p10: ['Endiya Partners', 'Endiya'], p11: ['SEACEF', 'South East Asia Clean Energy Fund'], p12: ['SGInnovate'] };
export const isGold = (c, key) => GOLD_NAMES_V9[c].map(nameKey).some(a => key === a || key.startsWith(`${a} `));
const extraGeneric = k => [k.fields.sector, ...(k.fields.subsectors ?? []), ...(k.fields.target_markets ?? [])].filter(Boolean);
export function caseCeiling(c, source) {
  const k = loadCase(c);
  const pages = source === 'diag' ? diagListRows(c).map(r => ({ url: r.url, text: `${r.title}\n${r.text}` })).filter(p => p.text.length > 50) : v8ListPages(c);
  const uniq = [...new Map(pages.map(p => [p.url, p])).values()];
  const named = uniq.filter(p => nameIn(p.text, GOLD_NAMES_V9[c])).length;
  const ranked = rankListNames(uniq, { extraGeneric: extraGeneric(k) });
  const gi = ranked.findIndex(r => isGold(c, r.key)), g = gi >= 0 ? ranked[gi] : null;
  const tieBest = g ? ranked.findIndex(r => r.pages === g.pages) + 1 : null, tieWorst = g ? ranked.filter(r => r.pages >= g.pages).length : null;
  const multi = ranked.filter(r => r.pages >= 2).length;
  return { case: c, source, pages: uniq.length, pages_named: named, names: ranked.length, names_2plus: multi, gold_candidate: !!g, gold_name: g?.name ?? null, gold_pages: g?.pages ?? 0, gold_rank: gi >= 0 ? gi + 1 : null, gold_tie: g ? `${tieBest}-${tieWorst}` : null, gold_how: g?.how ?? null, top: ranked.slice(0, 12).map(r => `${r.name}(${r.pages})`) };
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const rows = [...[...CASES_A, ...CASES_B].map(c => caseCeiling(c, 'diag')), ...CASES_A.map(c => caseCeiling(c, 'full'))];
  for (const r of rows) console.log([r.case, r.source, r.pages, r.pages_named, r.names, r.names_2plus, r.gold_candidate ? 'C' : '-', r.gold_name, r.gold_pages, r.gold_rank, r.gold_tie, r.gold_how].join('\t'), '\n   ', r.top.join(' · '));
  closeAll();
}
