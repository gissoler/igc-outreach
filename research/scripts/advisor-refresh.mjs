// Mantiene al asesor informado: vuelve a investigar los contactos cuya ficha tenga más de N días y rehace el roadmap.
// Programarlo en el Mac (donde hay red a la flota y a Firecrawl), p. ej. cada lunes a las 7:00 con cron:
//   0 7 * * 1  cd /ruta/REPOSITORIO/research && node --env-file-if-exists=.env scripts/advisor-refresh.mjs >> data/refresh.log 2>&1
// Opciones: --days 7 (antigüedad máxima de una ficha) · --job <id> (por defecto, la última evaluación de cada usuario).
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createStore } from '../server/research/store.mjs';
import { runDeep } from '../server/analysis/agent/deepRun.mjs';

const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const dbPath = resolve(process.env.RESEARCH_DB || 'data/research.sqlite');
const days = Number(arg('--days', 7));
const store = createStore(dbPath);
const raw = new DatabaseSync(dbPath, { readOnly: true });
const all = raw.prepare('SELECT body FROM jobs ORDER BY rowid DESC').all().map((r) => JSON.parse(r.body));
const targets = new Map();
for (const j of arg('--job', null) ? all.filter((x) => x.id === arg('--job')) : all) if (j.leads?.length && !targets.has(j.userId ?? null)) targets.set(j.userId ?? null, j);
if (!targets.size) { console.log('No hay evaluaciones para refrescar.'); process.exit(0); }
for (const [userId, job] of targets) {
  console.log(`[${new Date().toISOString()}] ${job.brief.venture || job.brief.company} (${job.id}) · usuario ${userId || 'local'}`);
  const run = await runDeep({ job, store, userId, network: store.network(job.brief, userId), update: store.analysis.updates(userId)[0] || null, maxAgeDays: days, save: (r) => store.analysis.saveRun(r) });
  const fresh = run.dossiers.filter((d) => !d.cached).length;
  console.log(`  ${run.status}: ${fresh} fichas nuevas, ${run.dossiers.length - fresh} reutilizadas${run.errors.length ? `; errores: ${run.errors.map((e) => `${e.contact} (${e.error})`).join(', ')}` : ''}`);
  if (run.status === 'failed') console.log(`  ${run.events.filter((e) => e.type === 'error').map((e) => e.message).join(' · ')}`);
  if (run.roadmap) console.log(`  Roadmap: ${run.roadmap.headline}`);
}
