#!/usr/bin/env node
/* Por qué una página quedó como quedó en una corrida del motor.
   Uso: node scripts/run-why.mjs eval/runs/<corrida> "<regex de URL o nombre>" [objetivo]
   Lee result.json (trazas guardadas por el motor) y muestra, por página: veredicto, motivo de descarte, bloqueos, avisos,
   fechas y la lectura del modelo y del extractor. No hace red ni llama a ningún modelo. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const [dir, pattern, objective] = process.argv.slice(2);
if (!dir || !pattern) { console.error('Uso: node scripts/run-why.mjs eval/runs/<corrida> "<regex>" [grant|investment]'); process.exit(1); }
const result = JSON.parse(readFileSync(join(dir, 'result.json'), 'utf8'));
const rx = new RegExp(pattern, 'i');
const short = (v, n = 160) => String(v ?? '').replace(/\s+/g, ' ').slice(0, n);
let shown = 0;
for (const audit of result.audits || []) {
  if (objective && audit.objective !== objective) continue;
  for (const t of audit.traces || []) {
    if (!rx.test(`${t.url} ${t.title || ''} ${t.verify?.name || ''}`)) continue;
    shown++;
    const v = t.verify || {};
    console.log(`\n── [${audit.objective}] ${t.url}\n   ${short(t.title, 100)}`);
    console.log(`   veredicto: ${t.verdict || v.verdict || '-'} · descarte: ${t.drop || v.drop || '-'} · motivos: ${(t.reasons || v.reasons || []).join(', ') || '-'}`);
    if (t.note) console.log(`   nota: ${t.note}`);
    if (t.textChars != null) console.log(`   texto: ${t.textChars} caracteres, leído vía ${t.fetchedVia || 'búsqueda'}`);
    if (v.blockers?.length) console.log(`   bloqueos: ${v.blockers.map((b) => short(b, 120)).join(' | ')}`);
    if (v.flags?.length) console.log(`   avisos: ${v.flags.join(', ')}`);
    if (v.dates) console.log(`   fechas: ${v.dates.status} (${v.dates.phase || '-'}) ${short(v.dates.reason, 100)} · cita: ${short(v.dates.quote, 100)}`);
    if (v.pageType) console.log(`   tipo de página: ${v.pageType.type} (${v.pageType.isCall ? 'convocatoria' : 'no es convocatoria'}) ${short(v.pageType.reason, 100)}`);
    if (v.eligibility) console.log(`   elegibilidad: ${v.eligibility.decision} · ${short(v.eligibility.reason, 120)}`);
    if (t.read?.out) { const o = t.read.out; console.log(`   lectura del modelo: kind=${o.kind} page_type=${o.page_type} official=${o.official} relevant=${o.relevant} status=${o.status} eligible=${o.eligible} money=${short(o.money, 40)}`); }
    if (t.extraction) { const e = t.extraction; console.log(`   extractor: ${e.ok === false ? `FALLÓ: ${e.error}` : `estado=${e.status} plazo=${e.deadline || '-'} fases=${(e.phases || []).length} rechazadas=${(e.rejected || []).length} sin leer=${(e.unparsed || []).length} créditos=${e.credits ?? '-'}`}`); }
  }
}
for (const audit of result.audits || []) {
  if (objective && audit.objective !== objective) continue;
  for (const o of audit.overBudget || []) if (rx.test(`${o.url} ${o.title}`)) { shown++; console.log(`\n── [${audit.objective}] ${o.url}\n   ${short(o.title, 100)}\n   NO SE LEYÓ: quedó fuera del presupuesto de páginas (prioridad ${o.score}, en ${o.providers} buscador(es)). Sube ENGINE_MAX_PAGES o mejora su prioridad.`); }
}
if (!shown) console.log('Ninguna traza coincide. Si la página nunca se leyó, mira "skipped" en result.json (presupuesto de páginas, agregadores); las corridas anteriores al 30/09 noche guardan pocas trazas.');
