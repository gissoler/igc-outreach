// Genera out/<bench_id>/fingerprint.json (sha256 de los archivos que definen la corrida formal).
// Uso, desde research/: node bench/investors/freeze.mjs --config bench/investors/config/v5-2026-10-09.json
// V9: con la config del diagnóstico v9 (investor_diag_config/1) la huella se genera aparte (out/v9-diagnostico-…), sin tocar v5, v7 ni v8.
// V8: con una config investor_run_config/6 (brazo v8) la huella se genera aparte (out/<bench_id v8>), sin tocar v5 ni v7.
// V7: --check compara con el fingerprint existente SIN escribir (sale 1 si algún archivo cambió; no toca out/ de v5).
//     Con una config investor_run_config/5 (brazo v7) se añaden los archivos v7; la lista v5 no cambia.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, relative, join } from 'node:path';
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const research = process.cwd();
const repo = resolve(research, '..');
const configPath = resolve(research, arg('--config'));
const config = JSON.parse(readFileSync(configPath, 'utf8'));
if (config.status !== 'frozen') throw new Error('La config debe estar en status=frozen antes de generar el fingerprint');
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const walk = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
const inv = resolve(research, 'bench/investors');
const prompts = resolve(repo, 'prompts/investor');
const manifest = resolve(prompts, config.prompts.manifest);
const manifestJson = JSON.parse(readFileSync(manifest, 'utf8'));
const files = new Set([configPath, manifest]);
for (const p of manifestJson.prompts) for (const f of p.files) files.add(resolve(prompts, f));
for (const f of ['investor_run_config.v3', 'investor_run_result.v3', 'investor_extraction.v2', 'investor_entity.v2', 'investor_planner_output.v2', 'investor_case.v2', 'investor_label', 'investor_sector_fit.v1', 'investor_criteria_catalog', 'investor_profile']) {
  const p = resolve(repo, `docs/contracts/investor/${f}.schema.json`); if (existsSync(p)) files.add(p);
}
files.add(resolve(repo, 'docs/contracts/investor/vocab/normalization.v1.json'));
for (const f of ['extractor', 'judge', 'engine', 'normalize', 'resolve', 'deepening']) files.add(resolve(inv, `${f}.mjs`));
for (const d of ['cases', 'gold']) for (const p of walk(resolve(inv, d))) files.add(p);
if (config.schema_version === 'investor_run_config/6') {
  // V8: huella aparte (brazo v8 = v7 + fase de listas). Incluye los módulos v7 que reutiliza, los v8 nuevos y el esquema v6.
  for (const f of ['extractor.v7.mjs', 'external.v7.mjs', 'cache-layers.v7.mjs', 'engine.v8.mjs', 'list-discovery.v8.mjs', 'workspace.v8.mjs', 'run-experiment.v8.mjs', 'engine.v2.mjs', 'conditions.mjs', 'identity.mjs', 'triage.mjs', 'activity.mjs', 'ranking.mjs', 'search-failover.mjs']) files.add(resolve(inv, f));
  if (config.b2?.fixed_initial_batch) files.add(resolve(inv, 'config', config.b2.fixed_initial_batch));
  files.add(resolve(repo, 'docs/contracts/investor/investor_run_config.v6.schema.json'));
}
if (config.schema_version === 'investor_diag_config/1') {
  // V9: diagnóstico (paso 0 y techo L128). Módulos v7/v8 que reutiliza para descargar y extraer, y los v9 nuevos.
  for (const f of ['extractor.v7.mjs', 'external.v7.mjs', 'cache-layers.v7.mjs', 'exa-direct.v8.mjs', 'list-discovery.v8.mjs', 'list-names.v9.mjs', 'resolve-match.v9.mjs', 'resolve.v9.mjs', 'analysis/v9/data.v9.mjs', 'analysis/v9/ceiling_lists.mjs', 'analysis/v9/ceiling_replicas.mjs', 'analysis/v9/diagnostico.v9.mjs', 'analysis/v9/diagnostico_report.v9.mjs', 'analysis/v8/queries.v8.mjs']) files.add(resolve(inv, f));
  files.add(resolve(inv, 'config', config.base_config));
}
if (config.schema_version === 'investor_run_config/6' && config.b2?.model_candidates) {
  // V9 (brazo de candidatos del modelo): además de lo de v8, los módulos v9 y el prompt candidates (manifest v9).
  for (const f of ['engine.v9.mjs', 'name-candidates.v9.mjs', 'resolve.v9.mjs', 'resolve-match.v9.mjs', 'workspace.v9.mjs', 'run-experiment.v9.mjs']) files.add(resolve(inv, f));
  const m9 = resolve(prompts, config.b2.model_candidates.manifest ?? 'manifest.v9.json'); files.add(m9);
  for (const p of JSON.parse(readFileSync(m9, 'utf8')).prompts) for (const f of p.files) files.add(resolve(prompts, f));
}
if (config.schema_version === 'investor_run_config/5') {
  for (const f of ['extractor.v7.mjs', 'engine.v7.mjs', 'external.v7.mjs', 'cache-layers.v7.mjs', 'workspace.v7.mjs', 'run-experiment.v7.mjs', 'engine.v2.mjs', 'conditions.mjs', 'identity.mjs', 'triage.mjs', 'activity.mjs', 'ranking.mjs', 'search-failover.mjs']) files.add(resolve(inv, f));
  if (config.b2?.fixed_initial_batch) files.add(resolve(inv, 'config', config.b2.fixed_initial_batch));
  files.add(resolve(repo, 'docs/contracts/investor/investor_run_config.v5.schema.json'));
}
const entries = [...files].sort().map((p) => ({ path: relative(repo, p), sha256: sha(p) }));
const out = resolve(inv, 'out', config.bench_id);
if (process.argv.includes('--check')) {
  const prev = JSON.parse(readFileSync(resolve(out, 'fingerprint.json'), 'utf8')), old = new Map(prev.files.map((f) => [f.path, f.sha256]));
  const same = entries.filter((e) => old.get(e.path) === e.sha256).length, changed = entries.filter((e) => old.has(e.path) && old.get(e.path) !== e.sha256).map((e) => e.path);
  const missing = prev.files.filter((f) => !entries.some((e) => e.path === f.path)).map((f) => f.path), added = entries.filter((e) => !old.has(e.path)).map((e) => e.path);
  // Los archivos nuevos (p. ej. perfiles -ib añadidos después en cases/profiles) se listan pero no invalidan: los originales deben ser idénticos.
  const ok = same === prev.files.length && !changed.length && !missing.length && prev.config_sha256 === sha(configPath);
  console.log(JSON.stringify({ bench_id: config.bench_id, fingerprint_files: prev.files.length, identical: same, changed, missing, added, config_identical: prev.config_sha256 === sha(configPath), ok }));
  process.exit(ok ? 0 : 1);
}
mkdirSync(out, { recursive: true });
const doc = { schema_version: 'investor_fingerprint/1', bench_id: config.bench_id, generated_at: new Date().toISOString(), config_sha256: sha(configPath), files: entries };
writeFileSync(resolve(out, 'fingerprint.json'), `${JSON.stringify(doc, null, 2)}\n`);
console.log(`fingerprint.json: ${entries.length} archivos; config_sha256=${doc.config_sha256}`);
