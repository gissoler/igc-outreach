// Expande adjudicaciones compactas (analysis/adjudication/<case>.json) a labels investor_label/1 y las valida con el contrato congelado.
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
const [S, BENCH, E] = process.argv.slice(2);
const { validateInvestor } = await import(resolve(S, 'contracts.mjs'));
const { investorGain } = await import(resolve(S, 'ranking.mjs'));
const TODAY = '2026-10-08', ANNOTATOR = 'model_adjudicated_internal:claude-sonnet-5-5';
const dir = resolve(E, 'analysis/adjudication'); const out = [];
const pools = Object.fromEntries(readdirSync(resolve(S, 'out', BENCH, 'pool')).map(f => [f.replace('.json',''), JSON.parse(readFileSync(resolve(S,'out',BENCH,'pool',f),'utf8'))]));
let errors = 0; for (const c of Object.keys(pools)) if (!readdirSync(dir).includes(c + '.json')) { console.error(`SIN adjudicar caso ${c}`); }
let errors0 = 0; const gainDist = {};
for (const f of readdirSync(dir).filter(x => x.endsWith('.json')).sort()) {
  const caseId = f.replace('.json',''), items = JSON.parse(readFileSync(resolve(dir, f), 'utf8'));
  const ids = new Set(items.map(x => x.id)), poolIds = new Set(pools[caseId].map(x => x.stable_id));
  for (const id of poolIds) if (!ids.has(id)) { console.error(`[${caseId}] FALTA adjudicar ${id}`); errors++; }
  for (const id of ids) if (!poolIds.has(id)) { console.error(`[${caseId}] ${id} no está en el pool`); errors++; }
  for (const x of items) {
    const crit = Object.entries(x.crit ?? {}).map(([criterion_id, state]) => ({ criterion_id, state }));
    const evidence = (x.ev ?? []).map(([criterion_id, url, quote]) => ({ criterion_id, url, quote, retrieved_on: TODAY }));
    const label = { schema_version: 'investor_label/1', case_id: caseId, stable_id: x.id, role: 'adjudicator', annotator: ANNOTATOR,
      identity_correct: x.ident ?? true, entity_kind: x.kind ?? 'institutional_investor', active_status: x.active, sector_fit: x.sector, stage_fit: x.stage, geography_fit: x.geo,
      check_fit: x.check ?? 'unknown', round_fit: x.round ?? 'unknown', business_model_fit: x.biz ?? 'unknown', lead_fit: x.lead ?? 'unknown', hard_eligibility: x.hard,
      portfolio_conflict: x.conflict ?? 'unknown', overall_relevance: x.rel, confidence: x.conf, criteria: crit, evidence, labeled_on: TODAY, notes: x.notes ?? '' };
    try { validateInvestor('investor_label', label); } catch (e) { console.error(`[${caseId}] ${x.id}: ${e.message.slice(0,300)}`); errors++; continue; }
    const g = investorGain(label); const k = `${caseId.includes('-n')||caseId.includes('r1')?'null':'pos'}:${g}`; gainDist[k] = (gainDist[k] ?? 0) + 1;
    out.push(label);
  }
}
mkdirSync(resolve(S, 'out', BENCH, 'labels'), { recursive: true });
if (!errors) { writeFileSync(resolve(E, 'analysis/adjudicator.expanded.jsonl'), out.map(x => JSON.stringify(x)).join('\n') + '\n'); }
console.log(JSON.stringify({ labels: out.length, errors, gain_distribution: gainDist }));
process.exit(errors ? 1 : 0);
