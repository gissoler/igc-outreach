// V15 · Omisiones frente a la lista de CONTROL de inversionistas (no es un gold: ver `status` y `warning` del archivo).
// Lee events.jsonl de cada caso (investor_harvest, investor_org, investor_summary) y dice, por organización de control:
// si apareció como candidata, si se abrió, qué decidió el código y en qué puesto quedó. Sin red.
// Uso: node scripts/investor-control.mjs --runs "<carpeta con RD-01…>" [--control eval/investors/rd-control-2026-10-19.json]
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const arg = (k, d = null) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const control = JSON.parse(readFileSync(arg('control', new URL('../eval/investors/rd-control-2026-10-19.json', import.meta.url)), 'utf8'));
const runs = arg('runs');
const cases = [...new Set(control.items.flatMap((x) => x.cases))].sort();
console.log(`Control: ${control.status}${control.reviewed_by ? ` (revisado por ${control.reviewed_by})` : ' — SIN revisión humana: esto mide omisiones conocidas, no recall.'}\n`);
const rows = [];
for (const c of cases) {
  const file = join(runs, c, 'events.jsonl'); if (!existsSync(file)) { console.log(`${c}: sin corrida`); continue; }
  const ev = readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const orgs = ev.filter((e) => e.type === 'investor_org'); const sum = ev.filter((e) => e.type === 'investor_summary').at(-1);
  const kept = orgs.filter((o) => o.decision === 'main' || o.decision === 'verify').sort((a, b) => (a.decision === 'main' ? 0 : 1) - (b.decision === 'main' ? 0 : 1) || b.score - a.score).map((o) => o.key);
  const routes = (sum?.other_routes || []).map((r) => r.org);
  console.log(`${c}: ${sum?.status_line || 'sin resumen de inversionistas (¿corrida anterior a V15?)'}`);
  for (const it of control.items.filter((x) => x.cases.includes(c))) {
    const o = orgs.find((x) => x.key === it.org); const rank = kept.indexOf(it.org);
    const state = !o ? 'no apareció como candidata' : o.decision === 'not_selected' ? `candidata no abierta (puntaje ${o.score})` : rank >= 0 ? `retenida #${rank + 1} (${o.decision})` : routes.includes(it.org) ? 'ruta de partnering (other_routes)' : `descartada por código: ${o.reason}`;
    rows.push({ case: c, org: it.org, route: it.route, state }); console.log(`   ${it.name} [${it.route}]: ${state}`);
  }
}
if (process.argv.includes('--json')) console.log(JSON.stringify(rows, null, 2));
