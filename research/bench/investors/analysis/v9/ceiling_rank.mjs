// V9 (solo relectura): puesto del oro con tres órdenes posibles y techo por cupo K de resoluciones.
import { diagListRows, v8ListPages, loadCase, CASES_A, CASES_B, closeAll } from './data.v9.mjs';
import { rankVariant } from '../../list-names.v9.mjs';
import { isGold } from './ceiling_lists.mjs';
const Ks = [8, 16, 32, 64, 128];
const srcPages = (c, src) => {
  const diag = [...new Map(diagListRows(c).map(r => [r.url, { url: r.url, text: `${r.title}\n${r.text}` }])).values()].filter(p => p.text.length > 50);
  if (src === 'diag') return diag;
  const full = v8ListPages(c);
  if (src === 'full') return full;
  const m = new Map(diag.map(p => [p.url, p])); for (const p of full) m.set(p.url, p); return [...m.values()];   // union: página completa si existe
};
const res = [];
for (const src of ['diag', 'full', 'union']) for (const mode of ['pages', 'firm_pages', 'position']) {
  const cases = src === 'diag' ? [...CASES_A, ...CASES_B] : CASES_A;
  const rows = cases.map(c => { const k = loadCase(c); const r = rankVariant(srcPages(c, src), mode, { extraGeneric: [k.fields.sector, ...(k.fields.subsectors ?? []), ...(k.fields.target_markets ?? [])] }); const i = r.findIndex(x => isGold(c, x.key)); return { c, n: r.length, rank: i < 0 ? null : i + 1 }; });
  const a = rows.filter(r => CASES_A.includes(r.c)), b = rows.filter(r => CASES_B.includes(r.c));
  res.push({ src, mode, A_ranks: a.map(r => `${r.c}:${r.rank ?? '—'}/${r.n}`).join(' '), ...Object.fromEntries(Ks.map(K => [`A≤${K}`, a.filter(r => r.rank && r.rank <= K).length])), B_ranks: b.map(r => `${r.c}:${r.rank ?? '—'}/${r.n}`).join(' '), ...Object.fromEntries(Ks.map(K => [`B≤${K}`, b.length ? b.filter(r => r.rank && r.rank <= K).length : '']))});
}
for (const r of res) console.log(`${r.src}/${r.mode}\n  A ${r.A_ranks}\n  A K8..128: ${Ks.map(K => r[`A≤${K}`]).join(' ')}${r.B_ranks ? `\n  B ${r.B_ranks}\n  B K8..128: ${Ks.map(K => r[`B≤${K}`]).join(' ')}` : ''}`);
closeAll();
