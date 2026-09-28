// Evaluación del Módulo 5 (desde tu Mac, con red a Grants.gov).
//   1) node scripts/grants-eval.mjs fetch --keyword "Alzheimer SBIR" --n 30   → evalúa convocatorias reales y las guarda
//   2) Rohit llena ../backend/eval/grants_labels.csv (columnas id, veredicto_manual con ✔, ✖ o ?)
//   3) node scripts/grants-eval.mjs score                                        → exactitud del veredicto y "falsos ✔"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createStore } from '../server/research/store.mjs';
import { evaluateOpportunity } from '../server/analysis/eligibility.mjs';
import { parseCsv, toCsv } from '../server/analysis/extractEval.mjs';
import { verdictAccuracy } from '../server/analysis/eligibility.mjs';

const args = process.argv.slice(2);
const opt = (n, f = null) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : f; };
const store = createStore(resolve(process.env.RESEARCH_DB || 'data/research.sqlite')).analysis;
const labels = resolve('../backend/eval/grants_labels.csv');
const post = async (url, body) => (await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();

if (args[0] === 'fetch') {
  const n = Number(opt('n', 30));
  const search = await post('https://api.grants.gov/v1/api/search2', { keyword: opt('keyword', 'Alzheimer'), oppStatuses: 'posted|forecasted', rows: n });
  const rows = [];
  for (const hit of search.data?.oppHits || []) {
    const d = await post('https://api.grants.gov/v1/api/fetchOpportunity', { opportunityId: Number(hit.id) });
    const syn = d.data?.synopsis || {};
    const opp = { id: hit.id, number: hit.number, title: hit.title, agency: hit.agency, url: `https://www.grants.gov/search-results-detail/${hit.id}`, closeDate: hit.closeDate ? new Date(hit.closeDate).toISOString().slice(0, 10) : null, awardCeiling: Number(syn.awardCeiling) || null, applicantTypes: syn.applicantTypes || [], applicantEligibilityDesc: syn.applicantEligibilityDesc || '' };
    const e = await evaluateOpportunity(opp, { env: process.env });
    store.saveGrantEvaluation(String(e.id), e);
    rows.push({ id: e.id, numero: e.number, titulo: e.title, url: e.url, cierre: e.closeDate, veredicto_motor: e.verdict, veredicto_manual: '', nota: '' });
    console.log(e.verdict, e.number, e.title.slice(0, 70));
  }
  mkdirSync(resolve('../backend/eval'), { recursive: true });
  if (!existsSync(labels)) writeFileSync(labels, toCsv(rows, ['id', 'numero', 'titulo', 'url', 'cierre', 'veredicto_motor', 'veredicto_manual', 'nota']));
  console.log(`→ ${labels} (llenar veredicto_manual sin mirar veredicto_motor si es posible)`);
} else if (args[0] === 'score') {
  const res = verdictAccuracy(store.grantEvaluations(), parseCsv(readFileSync(labels, 'utf8')));
  console.log(JSON.stringify(res, null, 2));
  writeFileSync(resolve('../backend/eval/grants_eval.json'), JSON.stringify({ at: new Date().toISOString(), ...res }, null, 2));
} else console.log('Uso: fetch | score');
