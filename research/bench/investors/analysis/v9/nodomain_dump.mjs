// V9 paso 0 (solo relectura): resoluciones no_domain de v8 con los URL que devolvió su búsqueda.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { nameMatchesDomain } from '../../extractor.mjs';
const D = resolve(import.meta.dirname, '../../out/investors-internal-2026-10-12-v8');
const ev = readFileSync(resolve(D, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const host = u => { try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ''); } catch { return null; } };
const out = [];
ev.forEach((e, i) => {
  if (e.event !== 'resolution_end') return;
  // búsqueda de resolución: el search_end anterior más cercano del mismo run con la consulta "<name>"
  let s = null; for (let j = i - 1; j >= 0; j--) { const x = ev[j]; if (x.run_id === e.run_id && x.event === 'search_end' && x.query.startsWith(`"${e.name}"`)) { s = x; break; } if (x.run_id === e.run_id && x.event === 'resolution_start' && x.name !== e.name) break; }
  out.push({ run: e.run_id.split('__').slice(1).join('_'), name: e.name, outcome: e.outcome, url: e.url, provider: s?.provider ?? null, hosts: (s?.urls ?? []).map(host) });
});
const by = {}; for (const r of out) by[r.outcome] = (by[r.outcome] ?? 0) + 1;
console.log(JSON.stringify(by));
console.log('runs', new Set(ev.filter(e => e.event === 'run_start').map(e => e.run_id)).size, 'run_start', ev.filter(e => e.event === 'run_start').length);
for (const r of out.filter(r => r.outcome === 'no_domain')) console.log(`${r.run}\t${r.name}\t${r.provider}\t${r.hosts.join(' ')}`);
