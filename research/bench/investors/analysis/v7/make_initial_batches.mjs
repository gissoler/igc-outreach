#!/usr/bin/env node
// C6 (H1): extrae el lote inicial del planner de las corridas v5 B2 semilla 101 (variante A, p01–p06) SIN llamar al LLM:
// se recalcula la clave de la caché LLM de esa llamada (prompt planner v3 + entrada inicial + semilla 101) y se lee la
// respuesta completa (consultas y candidate_firms) de las cachés v5 en solo lectura. Se comprueba que las consultas sean
// las del evento planner_end de esa corrida. Escribe config/v7-initial-batches.json (archivo congelado del brazo v7).
// Uso (desde research/): node bench/investors/analysis/v7/make_initial_batches.mjs [--check]
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from '../../../../agent/prompts.mjs';
import { loadInvestorPrompt } from '../../prompts.mjs';
import { plannerCoverage } from '../../engine.v2.mjs';
import { INV, DIRS, readEvents, lastAttempts, openLayers } from './common.mjs';
const sha = v => createHash('sha256').update(String(v)).digest('hex');
const repo = resolve(INV, '../../..');
const P = loadInvestorPrompt('planner', 'v3', { manifest: 'manifest.v5.json' });
const layers = openLayers();
const evs = [DIRS.pairs, DIRS.quick, DIRS.v5].map(d => ({ d, m: lastAttempts(readEvents(d)) }));
const out = { schema_version: 'investor_fixed_initial_batch/1', source: 'v5 B2 semilla 101, variante A (planner v3, manifest.v5.json)', seed: 101, prompt_sha256: P.sha256, cases: {} };
for (const p of ['p01', 'p02', 'p03', 'p04', 'p05', 'p06']) {
  const caseId = `inv-case-syn-${p}`, runId = `investors-internal-2026-10-09-v5__${caseId}__B2__s101`;
  const caseObj = JSON.parse(readFileSync(resolve(INV, 'cases', `${caseId}.json`), 'utf8'));
  const profile = JSON.parse(readFileSync(resolve(repo, caseObj.profile_path), 'utf8'));
  const state = { queries: [], hosts_seen: [], entities: [], unresolved_candidates: [], coverage: plannerCoverage(profile, []) };
  const user = render(P.user, { mode: 'initial_batch', profile, state, limits: { max_queries: 6 } });
  const key = sha([P.sha256, sha(user), 'investor_planner_output.v2', 0, 101].join('|'));
  let hit = null, from = null; for (const l of layers) { const h = l.get('llm', key); if (h) { hit = h; from = l.path; break; } }
  if (!hit) throw new Error(`sin respuesta en caché para ${runId}`);
  const src = evs.find(x => x.m.get(runId)); const ev = src?.m.get(runId)?.find(e => e.event === 'planner_end' && e.mode === 'initial_batch');
  if (!ev) throw new Error(`sin planner_end inicial para ${runId}`);
  const same = JSON.stringify(ev.queries) === JSON.stringify(hit.value.json.queries ?? []);
  if (!same) throw new Error(`las consultas de la caché no coinciden con el evento de ${runId}`);
  out.cases[caseId] = { source_run_id: runId, source_events: src.d.split('/').at(-1), source_cache: from.split('/').slice(-2).join('/'), llm_cache_key: key, output: hit.value.json, tokens_nominal: hit.meta.tokens ?? 0, latency_ms: hit.meta.latency_ms ?? 0 };
}
for (const l of layers) l.close();
const path = resolve(INV, 'config/v7-initial-batches.json'), text = `${JSON.stringify(out, null, 2)}\n`;
if (process.argv.includes('--check')) { const same = existsSync(path) && readFileSync(path, 'utf8') === text; console.log(same ? 'OK: v7-initial-batches.json coincide con las cachés v5' : 'DIFERENTE'); process.exit(same ? 0 : 1); }
writeFileSync(path, text);
console.log(JSON.stringify(Object.fromEntries(Object.entries(out.cases).map(([k, v]) => [k, { queries: v.output.queries.length, candidate_firms: (v.output.candidate_firms ?? []).length, stop: v.output.stop, from: v.source_cache }]))));
