// V9 (f) (solo relectura): de las resoluciones no_domain de v8, cuántas tienen en los resultados guardados un host que el
// emparejador v9 acepta, y cuántas eran nombres con el tipo de agregador pegado ("X VC Fund").
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { nameMatchesDomainV9, stripTypeTail } from '../../resolve-match.v9.mjs';
const D = resolve(import.meta.dirname, '../../out/investors-internal-2026-10-12-v8');
const ev = readFileSync(resolve(D, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const host = u => { try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ''); } catch { return null; } };
const deny = ['pitchbook.com', 'app.dealroom.co', 'f4.fund', 'fundraisingfox.com', 'foundersuite.com', 'pipeseed.com', 'crunchbase.com'];
const rows = [];
ev.forEach((e, i) => {
  if (e.event !== 'resolution_end' || e.outcome !== 'no_domain') return;
  let s = null; for (let j = i - 1; j >= 0; j--) { const x = ev[j]; if (x.run_id === e.run_id && x.event === 'search_end' && x.query.startsWith(`"${e.name}"`)) { s = x; break; } }
  const hosts = (s?.urls ?? []).map(host).filter(h => h && !deny.some(d => h === d || h.endsWith(`.${d}`)));
  const pick = hosts.find(h => nameMatchesDomainV9(e.name, h)) ?? null;
  rows.push({ name: e.name, typeTail: stripTypeTail(e.name) !== e.name.replace(/\s*\([^)]*\)\s*$/, '').trim(), pick });
});
const names = [...new Set(rows.map(r => r.name))];
console.log(`no_domain: ${rows.length} resoluciones, ${names.length} nombres distintos`);
console.log(`con tipo de agregador pegado: ${rows.filter(r => r.typeTail).length} resoluciones`);
console.log(`el emparejador v9 elige un host de los resultados guardados: ${rows.filter(r => r.pick).length} resoluciones (${new Set(rows.filter(r => r.pick).map(r => r.name)).size} nombres)`);
for (const n of names) { const r = rows.find(x => x.name === n); if (r.pick) console.log(`  ${n} → ${r.pick} ×${rows.filter(x => x.name === n).length}`); }
