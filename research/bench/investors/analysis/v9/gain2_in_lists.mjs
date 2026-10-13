// V9 (g)+(b) (solo relectura): de las firmas etiquetadas gain>=2 de cada caso, cuántas nombran las páginas de listas (texto
// completo v8 p01–p06 y texto Exa del diagnóstico p01–p12), cuántas salen como candidato del extractor determinista y en qué puesto.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadLabels, investorGain, INV } from '../v7/common.mjs';
import { diagListRows, v8ListPages, loadCase, CASES_A, CASES_B, closeAll } from './data.v9.mjs';
import { rankListNames, nameKey, pageCites } from '../../list-names.v9.mjs';
const L = loadLabels();
const pool = c => JSON.parse(readFileSync(resolve(INV, `gold/v3/pool/inv-case-syn-${c}.json`), 'utf8'));
const strip = n => String(n).replace(/\s*\(.*?\)\s*/g, ' ').trim();
const out = [];
for (const c of [...CASES_A, ...CASES_B]) {
  const k = loadCase(c), names = new Map(pool(c).map(p => [p.stable_id, strip(p.name)]));
  const g2 = [...L.values()].filter(l => l.case_id === `inv-case-syn-${c}` && investorGain(l) >= 2).map(l => ({ id: l.stable_id, name: names.get(l.stable_id) ?? l.stable_id, gold: l.stable_id === `inv:domain:${k.gold.domain}` }));
  for (const src of ['diag', ...(CASES_A.includes(c) ? ['full'] : [])]) {
    const pages = src === 'diag' ? [...new Map(diagListRows(c).map(r => [r.url, { url: r.url, text: `${r.title}\n${r.text}` }])).values()] : v8ListPages(c);
    const kts = pages.map(p => ` ${nameKey(p.text)} `);
    const ranked = rankListNames(pages, { extraGeneric: [k.fields.sector, ...(k.fields.subsectors ?? []), ...(k.fields.target_markets ?? [])] });
    const per = g2.map(f => { const fk = nameKey(f.name); const pg = kts.filter(t => pageCites(t, fk)).length; const ri = ranked.findIndex(r => r.key === fk || r.key.startsWith(`${fk} `)); return { ...f, pages: pg, rank: ri < 0 ? null : ri + 1 }; });
    out.push({ case: c, src, gain2: g2.length, named: per.filter(p => p.pages).length, candidate: per.filter(p => p.rank).length, ranks: per.filter(p => p.rank).map(p => `${p.name}${p.gold ? '*' : ''}:${p.rank}/${p.pages}p`).join(', '), not_named: per.filter(p => !p.pages).map(p => p.name + (p.gold ? '*' : '')).join(', ') });
  }
}
for (const r of out) console.log(`${r.case} ${r.src} g2=${r.gain2} nombradas=${r.named} candidatas=${r.candidate}\n   ${r.ranks}\n   no: ${r.not_named}`);
closeAll();
