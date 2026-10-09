#!/usr/bin/env node
// Verificación v4 sobre una carpeta de salida (smoke D1–D3 o corrida formal). Sin red.
//  · criterios núcleo ≠ unknown, al menos uno ≠ unknown
//  · cada criterio ≠ unknown con cita literal en el texto que vio el extractor (caché de fetch o texto de búsqueda)
//  · gain ≥ 2 por caso/condición, abstención en nulos, FETCH_EMPTY y rechazos/fetches
// Uso: node v4_check.mjs --out <dir de corrida> --cases <dir de casos> [--json <salida.json>]
import { copyFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { normalizeUrl } from '../../../agent/docs.mjs';
import { isLiteralIn, isLiteralEvidence } from '../extractor.mjs';
import { CORE_CRITERIA, criteriaKnownRate, anyCoreKnownRate } from '../metrics.mjs';

const arg = n => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? null : process.argv[i + 1]; };
const OUT = resolve(arg('out')), CASES = resolve(arg('cases'));
const json = p => JSON.parse(readFileSync(p, 'utf8'));
const cases = new Map(readdirSync(CASES).filter(x => x.endsWith('.json') && x !== 'manifest.json').map(x => { const c = json(resolve(CASES, x)); return [c.case_id, c]; }));
const runs = readdirSync(resolve(OUT, 'runs')).filter(d => existsSync(resolve(OUT, 'runs', d, 'result.json'))).map(d => json(resolve(OUT, 'runs', d, 'result.json')));

const dbCopy = resolve(tmpdir(), `v4-check-${process.pid}.sqlite`); copyFileSync(resolve(OUT, 'cache.sqlite'), dbCopy);
const db = new DatabaseSync(dbCopy, { readOnly: true });
const fetchText = new Map(), searchText = new Map();
for (const r of db.prepare("SELECT kind, key, value_json FROM entries WHERE kind IN ('fetch','search')").all()) {
  const v = JSON.parse(r.value_json);
  if (r.kind === 'fetch' && v?.text) fetchText.set(r.key, v.text);
  if (r.kind === 'search' && Array.isArray(v)) for (const row of v) if (row.text) searchText.set(normalizeUrl(row.url), row.text);
}
db.close();
// El extractor vio el texto del lector o, si salió vacío, el texto del buscador (FIX-11b): se aceptan ambos.
const textFor = url => { const k = normalizeUrl(url); return [fetchText.get(k), searchText.get(k)].filter(Boolean).join('\n\u241E\n'); };

// Criterio → campo de evidencia. PORTFOLIO-CONFLICT es una señal del perfil (no de la página) y se reporta aparte.
const FIELD = { 'INV-SECTOR': 'sectors', 'INV-STAGE': 'stages', 'INV-GEO': 'geographies', 'INV-TYPE': 'investor_type', 'INV-LEAD': 'lead_follow', 'INV-CHECK': 'check_range_usd', 'INV-ROUND': 'rounds', 'INV-BUSINESS-MODEL': 'business_models', 'INV-RECENCY': 'published_on' };
const citations = { checked: 0, verified: 0, failures: [] };
const perRun = [];
for (const run of runs) {
  const entities = new Map(run.entities.map(e => [e.stable_id, e]));
  for (const j of run.judgments) {
    const e = entities.get(j.stable_id);
    for (const c of j.criteria) {
      if (['unknown', 'not_applicable'].includes(c.state) || c.criterion_id === 'INV-PORTFOLIO-CONFLICT') continue;
      citations.checked++;
      let ok = false, quote = null, url = null;
      if (c.criterion_id === 'INV-ACTIVE') { const s = e.sources.find(s => s.quote); quote = s?.quote; url = s?.url; ok = Boolean(s && isLiteralEvidence(textFor(s.url) ?? '', s.quote)); }
      else if (c.criterion_id === 'INV-SECTOR' && /^Sector quote: /.test(c.rationale)) { quote = c.rationale.replace(/^Sector quote: /, ''); ok = e.sources.some(s => { url = s.url; return isLiteralEvidence(textFor(s.url) ?? '', quote); }); }
      else { const f = FIELD[c.criterion_id]; for (const s of e.sources) { const ev = s.field_evidence?.[f]; if (ev) { quote = ev; url = s.url; if (isLiteralEvidence(textFor(s.url) ?? '', ev)) { ok = true; break; } } } }
      if (ok) citations.verified++; else citations.failures.push({ run_id: run.run_id, stable_id: j.stable_id, criterion: c.criterion_id, state: c.state, quote, url });
    }
  }
  perRun.push({ run_id: run.run_id, case_id: run.case_id, kind: cases.get(run.case_id)?.kind, condition: run.condition, seed: run.seed, entities: run.entities.length, gain2: run.ranked.filter(x => x.gain >= 2).length, abstention_reason: run.abstention_reason ?? null, stop_reason: run.stop_reason, criteria_known_rate: criteriaKnownRate(run), any_core_known_rate: anyCoreKnownRate(run), searches: run.totals.searches, fetches: run.totals.fetches, rejected_non_investors: run.totals.rejected_non_investors, tokens: run.totals.tokens_nominal, fetch_empty: run.v2_stats?.fetch_empty ?? null, fallback: run.v2_stats?.fetch_fallback_search_contents ?? null, resolutions: run.v2_stats?.resolutions?.length ?? null, resolutions_accepted: run.v2_stats?.resolutions?.filter(r => r.outcome === 'accepted').length ?? null });
}
const allJ = runs.flatMap(r => r.judgments), state = (j, id) => j.criteria.find(c => c.criterion_id === id)?.state ?? 'unknown';
const sum = (rows, f) => rows.reduce((a, r) => a + (r[f] ?? 0), 0);
const fetches = sum(perRun, 'fetches');
const summary = {
  runs: runs.length, accepted_firms: allJ.length,
  all4_core_known_pct: allJ.length ? +(100 * allJ.filter(j => CORE_CRITERIA.every(id => state(j, id) !== 'unknown')).length / allJ.length).toFixed(1) : null,
  any_core_known_pct: allJ.length ? +(100 * allJ.filter(j => CORE_CRITERIA.some(id => state(j, id) !== 'unknown')).length / allJ.length).toFixed(1) : null,
  per_criterion_known_pct: Object.fromEntries(CORE_CRITERIA.map(id => [id, allJ.length ? +(100 * allJ.filter(j => state(j, id) !== 'unknown').length / allJ.length).toFixed(1) : null])),
  citations_verified_pct: citations.checked ? +(100 * citations.verified / citations.checked).toFixed(1) : null, citations_checked: citations.checked,
  fetch_empty_rate: fetches ? +(sum(perRun, 'fetch_empty') / fetches).toFixed(3) : null,
  rejected_non_investors_per_fetch: fetches ? +(sum(perRun, 'rejected_non_investors') / fetches).toFixed(3) : null,
  by_case_condition: Object.values(perRun.reduce((acc, r) => { const k = `${r.case_id}|${r.condition}`; (acc[k] ??= { case_id: r.case_id, kind: r.kind, condition: r.condition, seeds_with_gain2: 0, runs: 0, abstention_reasons: [] }); acc[k].runs++; if (r.gain2 > 0) acc[k].seeds_with_gain2++; acc[k].abstention_reasons.push(r.abstention_reason); return acc; }, {}))
};
const report = { summary, per_run: perRun, citation_failures: citations.failures };
if (arg('json')) writeFileSync(resolve(arg('json')), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ summary, citation_failures: citations.failures.slice(0, 20) }, null, 2));
