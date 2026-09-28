// Perfil ex ante de cada ronda del backtest: web de la startup en Wayback Machine, captura más cercana ANTERIOR a T.
// Se borran el nombre de la startup ("Startup A"), los líderes y cualquier mención de la ronda.
//   node scripts/backtest-profiles.mjs   (desde tu Mac; necesita acceso a web.archive.org)
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { dayBefore } from '../server/analysis/backtest.mjs';

const path = resolve('../backend/eval/backtest_rounds.json');
const data = JSON.parse(readFileSync(path, 'utf8'));
const strip = (html) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#?\w+;/g, ' ').replace(/\s+/g, ' ').trim();
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function anonymize(text, r) {
  let t = text;
  for (const n of [r.company, ...(r.leads || []), ...(r.co_investors || [])].filter(Boolean)) t = t.replace(new RegExp(esc(n), 'gi'), n === r.company ? 'Startup A' : '[inversionista]');
  return t.replace(/[^.]*\b(raised|raises|funding round|seed round|pre-seed|series [a-e]|levant[oó]|ronda)\b[^.]*\./gi, ' ').replace(/\s+/g, ' ').trim();
}
for (const r of data.rounds) {
  if (!r.website || r.profile_ex_ante) continue;
  const to = dayBefore(r.announced).replace(/-/g, '');
  try {
    const cdx = await (await fetch(`https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(r.website)}&to=${to}&output=json&filter=statuscode:200&limit=-3`)).json();
    const last = cdx.slice(1).at(-1);
    if (!last) { console.log(r.id, 'sin captura anterior a T'); continue; }
    const [, ts, original] = last;
    const html = await (await fetch(`https://web.archive.org/web/${ts}id_/${original}`)).text();
    r.profile_ex_ante = anonymize(strip(html), r).slice(0, 1500);
    r.profile_source = `https://web.archive.org/web/${ts}/${original}`;
    console.log(r.id, ts, r.profile_ex_ante.slice(0, 80));
  } catch (e) { console.log(r.id, 'error', e.message); }
}
writeFileSync(path, JSON.stringify(data, null, 2));
