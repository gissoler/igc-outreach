// Hojas ciegas (sin condición, semilla, rango, puntaje, juez ni origen Apollo) + claves + CSV etiquetados.
import fs from 'fs'; import path from 'path';
const [S, benchId] = process.argv.slice(2);
const O = path.join(S, 'out', benchId);
const { blindSample, sampleCsv, ADJUDICATION_COLUMNS } = await import(path.join(S, 'sample.mjs'));
const json = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const labels = fs.readFileSync(path.join(O, 'labels/adjudicator.jsonl'), 'utf8').split('\n').filter(Boolean).map(x => JSON.parse(x));
const out = path.join(O, 'labeling'); fs.mkdirSync(out, { recursive: true });
let total = 0;
for (const f of fs.readdirSync(path.join(O, 'pool')).filter(x => x.endsWith('.json'))) {
  const caseId = f.replace('.json', ''), pool = json(path.join(O, 'pool', f));
  const c = json(path.join(S, 'cases', f)); const prof = json(path.resolve(S, '../../..', c.profile_path)); 
  const pf = Object.fromEntries(Object.entries(prof.fields ?? {}).map(([k, v]) => [k, v?.value ?? v])); const summary = `${pf.sector ?? ''} | ${pf.product ?? ''} | etapa ${pf.funding_stage ?? ''} | ronda ${pf.round_sought ?? ''} (USD ${pf.capital_sought_usd ?? ''}) | mercados ${[].concat(pf.target_markets ?? []).join(', ')}`;
  const sample = blindSample({ caseId, profileSummary: summary, pool, seed: 7, maxNegatives: 1000 });
  fs.writeFileSync(path.join(out, `${caseId}.csv`), sampleCsv(sample.rows));
  fs.writeFileSync(path.join(out, `key-${caseId}.json`), JSON.stringify(sample.key, null, 2) + '\n');
  const byId = new Map(labels.filter(l => l.case_id === caseId).map(l => [l.stable_id, l]));
  const filled = sample.rows.map(r => { const l = byId.get(sample.key[r.item_key].stable_id); return { ...r, identity_correct: l.identity_correct, entity_kind: l.entity_kind, active_status: l.active_status, sector_fit: l.sector_fit, stage_fit: l.stage_fit, geography_fit: l.geography_fit, check_fit: l.check_fit, round_fit: l.round_fit, business_model_fit: l.business_model_fit, lead_fit: l.lead_fit, hard_eligibility: l.hard_eligibility, portfolio_conflict: l.portfolio_conflict, overall_relevance: l.overall_relevance, confidence: l.confidence, evidence_json: JSON.stringify(l.evidence), labeled_on: l.labeled_on, notes: l.notes }; });
  fs.writeFileSync(path.join(out, `labeled-${caseId}.csv`), sampleCsv(filled));
  total += sample.rows.length;
}
// Verificación de ceguera: ninguna columna ni clave filtra condición/semilla/rango/Apollo
const header = fs.readFileSync(path.join(out, 'inv-case-syn-p01.csv'), 'utf8').split('\n')[0];
const leak = /(condition|seed|rank|score|judge|apollo|B[0-3]\b)/i.test(header);
console.log(JSON.stringify({ items: total, header_leaks: leak }));
