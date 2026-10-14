/* Qué leyó GPT Researcher y qué llegó al juez, a partir de su log crudo.
   Uso: node scripts/probe-gptr-sources.mjs <log> [--brief eval/briefs/x.json] [--gold eval/gold/mint-ad-gemini-2026-10-14.json] [--today 2026-10-14]
   El log crudo queda ahora en eval/runs/app-<fecha>/gptr-raw-grant.log (antes vivía en /tmp y se perdía). */
import { readFileSync } from 'node:fs';
import { urlsFromRun } from '../server/research/gptr.mjs';

const arg = (n, d = '') => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
const file = process.argv[2]; if (!file) { console.error('uso: node scripts/probe-gptr-sources.mjs <log> [--brief …] [--gold …]'); process.exit(2); }
const log = readFileSync(file, 'utf8'); const today = arg('--today', new Date().toISOString().slice(0, 10));
const brief = arg('--brief') ? JSON.parse(readFileSync(arg('--brief'), 'utf8')) : null;
const count = (re) => (log.match(re) || []).length;
const queries = [...new Set([...log.matchAll(/Running research for '(.+?)'\.\.\./g)].map((m) => m[1]))];
const added = [...new Set([...log.matchAll(/Added source url to research: (\S+)/g)].map((m) => m[1]))];
const hosts = new Map(); for (const u of added) { let h = u; try { h = new URL(u).hostname.replace(/^www\./, ''); } catch { /* raro */ } hosts.set(h, (hosts.get(h) || 0) + 1); }
console.log(`Sub-consultas: ${queries.length} (con site:: ${queries.filter((q) => /site:/i.test(q)).length})`);
for (const q of queries.slice(0, 30)) console.log(`  · ${q}`);
console.log(`\nURLs añadidas: ${added.length} · dominios: ${hosts.size}`);
console.log(`Fallos: 429=${count(/429 Client Error/g)} · sin resultados=${count(/No results found with/g)} · contenido corto=${count(/Content too short/g)} · PDF fallido=${count(/Error loading PDF/g)} · LLM vacío=${count(/LLM returned empty|Failed to get response from/g)} · sin contenido para consulta=${count(/No content found for/g)}`);
console.log('\nDominios más leídos:'); for (const [h, n] of [...hosts].sort((a, b) => b[1] - a[1]).slice(0, 20)) console.log(`  ${String(n).padStart(3)}  ${h}`);
const max = Number(process.env.GPTR_JUDGE_MAX) || 40; const openMax = Number(process.env.GPTR_OPEN_MAX) || 150;
const ranked = urlsFromRun({ log, max: 10_000, today, brief });
if (arg('--gold')) {
  const gold = JSON.parse(readFileSync(arg('--gold'), 'utf8')).gold;
  console.log(`\nLista de referencia (gold) contra las fuentes: posición en el ranking (el modelo lee ~${max} elegidas por fechas entre las primeras ${openMax}; el registro oficial va aparte)`);
  for (const g of gold) { const re = new RegExp(g.match, 'i'); const hits = ranked.map((u, i) => [i, u.url]).filter(([, u]) => re.test(u)); console.log(`  ${hits.length ? '✔' : '✖'} ${g.label}: ${hits.length ? hits.slice(0, 3).map(([i, u]) => `#${i + 1}${i < openMax ? '' : ' (fuera)'} ${u.slice(0, 90)}`).join(' | ') : 'GPT Researcher no la leyó (solo puede llegar por el registro oficial)'}`); }
}
