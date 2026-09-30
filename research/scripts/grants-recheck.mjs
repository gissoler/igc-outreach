#!/usr/bin/env node
/* Vuelve a pasar la rúbrica de matching (server/research/grantMatch.mjs) sobre las convocatorias de
   evaluaciones YA GUARDADAS y lista las que antes eran prioridad/radar y ahora serían rechazadas.
   Solo lee la base de datos; no cambia nada.
     node research/scripts/grants-recheck.mjs                 # todas las evaluaciones
     node research/scripts/grants-recheck.mjs --job <id>      # una
     node research/scripts/grants-recheck.mjs --json          # salida JSON
   Nota: las evaluaciones antiguas no guardaban el ALN; ahí la rúbrica solo mira título y alcance. */
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { grantMatch } from '../server/research/grantMatch.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const only = args.includes('--job') ? args[args.indexOf('--job') + 1] : null;
const asJson = args.includes('--json');
const dbPath = process.env.RESEARCH_DB || path.join(root, 'data', 'research.sqlite');
const db = new DatabaseSync(dbPath, { readOnly: true });
const rows = db.prepare('SELECT id, body FROM jobs').all().filter((r) => !only || r.id === only);

const out = [];
for (const row of rows) {
  let job; try { job = JSON.parse(row.body); } catch { continue; }
  if (job.mode === 'demo') continue;
  for (const lead of job.leads || []) {
    if (lead.fundingType !== 'grant' || lead.kind !== 'opportunity') continue;
    const m = grantMatch(lead, job.brief || {}, job.plan?.terms || []);
    out.push({ job: row.id, venture: job.brief?.company || job.brief?.venture || '', createdAt: job.createdAt, id: lead.externalId, title: lead.title, org: lead.org,
      before: lead.bucket, now: m.verdict, field: m.field ? `${m.field.label} (${m.field.code})` : null, anchors: [...new Set([...m.phrases, ...m.anchorsInTitle, ...m.anchorsInScope])].slice(0, 5), why: m.summary });
  }
}
const changed = out.filter((r) => r.before !== 'discarded' && r.now !== 'match');
if (asJson) { console.log(JSON.stringify({ total: out.length, changed }, null, 2)); process.exit(0); }
const count = (v) => out.filter((r) => r.now === v).length;
console.log(`Convocatorias revisadas: ${out.length} en ${new Set(out.map((r) => r.job)).size} evaluaciones · match ${count('match')} · weak ${count('weak')} · mismatch ${count('mismatch')}`);
console.log(`Antes eran prioridad o radar y ahora NO son match: ${changed.length}\n`);
for (const r of changed.sort((a, b) => (a.now === 'mismatch' ? -1 : 1) - (b.now === 'mismatch' ? -1 : 1))) {
  console.log(`[${r.now.toUpperCase()}] ${r.id || '—'} · ${r.title}`);
  console.log(`   ${r.org || ''}${r.field ? ` · ${r.field}` : ''} · antes: ${r.before} · evaluación ${r.job.slice(0, 8)} (${r.venture})`);
  console.log(`   ${r.why}\n`);
}
