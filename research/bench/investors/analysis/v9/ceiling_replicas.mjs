// V9 (solo relectura): por réplica v8 (p01–p06), páginas de lista abiertas, si nombran al oro y puesto del oro con el orden
// firm_pages (diseño L) sobre las páginas de ESA réplica. O2 se mide por réplica: el techo útil es "réplicas con el oro ≤ K".
import { normalizeUrl } from '../../../../agent/docs.mjs';
import { v8events, v8cache, loadCase, nameIn, CASES_A, closeAll } from './data.v9.mjs';
import { rankVariant } from '../../list-names.v9.mjs';
import { isGold, GOLD_NAMES_V9 } from './ceiling_lists.mjs';
export function replicaRows() {
  const out = [];
  for (const c of CASES_A) for (const s of ['s101', 's202', 's303']) {
    const k = loadCase(c), rid = `investors-internal-2026-10-12-v8__inv-case-syn-${c}__B2__${s}`;
    // último intento de la corrida (p05 s202 se repitió)
    const evs = v8events().filter(e => e.run_id === rid); let i0 = -1; evs.forEach((e, i) => { if (e.event === 'run_start') i0 = i; });
    const last = evs.slice(i0);
    const urls = [...new Set(last.filter(e => e.event === 'search_opened' && e.origin === 'list_discovery').flatMap(o => o.opened.map(i => o.urls[i])))];
    const pages = urls.map(u => ({ url: u, text: v8cache().get('fetch', normalizeUrl(u))?.value?.text ?? '' })).filter(p => p.text.length >= 200);
    const r = rankVariant(pages, 'firm_pages', { extraGeneric: [k.fields.sector, ...(k.fields.subsectors ?? []), ...(k.fields.target_markets ?? [])] });
    const gi = r.findIndex(x => isGold(c, x.key));
    out.push({ case: c, rep: s, pages: pages.length, named: pages.filter(p => nameIn(p.text, GOLD_NAMES_V9[c])).length, names: r.length, rank: gi < 0 ? null : gi + 1 });
  }
  return out;
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const rows = replicaRows();
  for (const r of rows) console.log(`${r.case} ${r.rep} páginas=${r.pages} con_oro=${r.named} nombres=${r.names} puesto_oro=${r.rank ?? '—'}`);
  for (const K of [8, 16, 32, 64, 128, 256]) {
    const cases = CASES_A.filter(c => rows.filter(r => r.case === c && r.rank && r.rank <= K).length >= 2);
    console.log(`K=${K}: casos con el oro ≤K en ≥2 de 3 réplicas: ${cases.length} (${cases.join(' ')})`);
  }
  closeAll();
}
