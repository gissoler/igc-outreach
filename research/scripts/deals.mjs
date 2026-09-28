// CLI del Módulo 1 (corpus de deals). Corre desde tu Mac (necesita red a Firecrawl y a la flota):
//   node --env-file-if-exists=.env scripts/deals.mjs ingest --from 2023-01-01 --to 2026-09-30 [--rules]
//   node --env-file-if-exists=.env scripts/deals.mjs seed-rounds                  → carga las rondas del backtest como deals citados
//   node --env-file-if-exists=.env scripts/deals.mjs stats
//   node --env-file-if-exists=.env scripts/deals.mjs review-export [--n 100]      → ../backend/eval/deals_review.csv
//   node --env-file-if-exists=.env scripts/deals.mjs review-score  [archivo.csv]  → precisión por campo
//   node --env-file-if-exists=.env scripts/deals.mjs gold-export                  → ../backend/eval/deals_gold.jsonl (test)
//   node --env-file-if-exists=.env scripts/deals.mjs trainset                     → ../backend/ml/data/{train,test}.jsonl
//   node --env-file-if-exists=.env scripts/deals.mjs compare --a chat --b <lora-id> → P/R por campo en el test
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createStore } from '../server/research/store.mjs';
import { dealQueries, ingestDeals, quarterPeriods, processPage } from '../server/analysis/dealIngest.mjs';
import { EXTRACT_SYSTEM, extractionPrompt } from '../server/analysis/deals.mjs';
import { EVAL_FIELDS, comparePerField, parseCsv, precisionFromReview, smallModelWins, splitOf, toCsv } from '../server/analysis/extractEval.mjs';

const args = process.argv.slice(2);
const cmd = args[0];
const opt = (name, fallback = null) => { const i = args.indexOf(`--${name}`); return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : fallback; };
const store = createStore(resolve(process.env.RESEARCH_DB || 'data/research.sqlite')).analysis;
const EVAL_DIR = resolve('../backend/eval');
const write = (path, text) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); console.log(`→ ${path}`); };
const pct = (x) => x == null ? '—' : `${(100 * x).toFixed(1)} %`;

if (cmd === 'ingest') {
  const periods = quarterPeriods(opt('from', '2023-01-01'), opt('to', new Date().toISOString().slice(0, 10)));
  const queries = dealQueries({ sectors: String(opt('sectors', 'mental health,digital health,neuro')).split(','), stages: String(opt('stages', 'pre-seed,seed,series-a')).split(','), regions: String(opt('regions', 'LATAM,US,CO,MX,BR')).split(',') });
  console.log(`${queries.length} consultas × ${periods.length} trimestres`);
  const stats = await ingestDeals({ queries, periods, perQuery: Number(opt('per', 8)) }, { store, forceRules: Boolean(opt('rules')), log: console.log });
  console.log(JSON.stringify({ ...stats, errors: stats.errors.slice(0, 20), totalDeals: store.dealCount(), funds: store.fundCount() }, null, 2));
} else if (cmd === 'seed-rounds') {
  // Las rondas reales del conjunto del backtest también son deals: se cargan con su cita (mismo verificador).
  // Cada una entra como página de una sola cita; quote_verified=false queda anotado en el extractor.
  const { verifyDeal } = await import('../server/analysis/deals.mjs');
  const data = JSON.parse(readFileSync(resolve(EVAL_DIR, 'backtest_rounds.json'), 'utf8'));
  let n = 0;
  for (const r of data.rounds) {
    const what = String(r.profile_hint || '').split(' · ').slice(3).join(' · ');
    const page = { url: r.url, title: r.company, published: r.announced, text: `${r.company}: ${r.quote}\n${what}` };
    const raw = { startup: r.company, sector: r.sector, country: r.country, stage: r.stage, amount_text: r.amount_text, lead_investors: r.leads, co_investors: r.co_investors, quote: `${r.company}: ${r.quote}`, description: what };
    const { deal, reason } = verifyDeal(raw, page, { extractor: r.quote_verified ? 'manual-web (cita verificada)' : 'manual-web (cita pendiente de verificar)' });
    if (!deal) { console.log('✖', r.id, reason); continue; }
    if (!deal.sector && r.sector) { deal.sector = r.sector; deal.sectors = [r.sector]; deal.fieldStatus.sector = 'del conjunto'; }
    if (!deal.country && r.country) { deal.country = r.country; deal.fieldStatus.country = 'del conjunto'; }
    store.saveDeal(deal); n++;
  }
  console.log(`${n} deals cargados desde el conjunto del backtest.`);
} else if (cmd === 'stats') {
  const ex = store.extractions();
  const raw = ex.reduce((n, e) => n + (e.raw?.deals?.length || 0), 0);
  const ok = ex.reduce((n, e) => n + e.verified.filter((v) => v.deal).length, 0);
  const reasons = {};
  for (const e of ex) for (const v of e.verified) if (!v.deal) reasons[v.reason] = (reasons[v.reason] || 0) + 1;
  const fields = Object.fromEntries(EVAL_FIELDS.map((f) => [f, {}]));
  for (const e of ex) for (const v of e.verified) if (v.deal) for (const f of EVAL_FIELDS) fields[f][v.status[f]] = (fields[f][v.status[f]] || 0) + 1;
  console.log(JSON.stringify({ paginas: ex.length, extraidos: raw, verificados: ok, tasaVerificacion: raw ? ok / raw : null, motivosDeRechazo: reasons, estadoPorCampo: fields, deals: store.dealCount(), fondos: store.fundCount(), revisionFondos: store.fundReviews().length }, null, 2));
} else if (cmd === 'review-export') {
  const n = Number(opt('n', 100));
  const all = store.extractions().flatMap((e) => e.verified.filter((v) => v.deal).map((v) => ({ e, d: v.deal })));
  // Muestra estable: orden por hash del id del deal.
  const sample = all.sort((a, b) => a.d.id.localeCompare(b.d.id)).slice(0, n);
  const rows = sample.map(({ e, d }) => ({ extraction_id: e.id, deal_id: d.id, url: d.url, cita: d.quote, startup: d.startup, sector: d.sector, country: d.country, stage: d.stage, amount: d.amountText, date: d.date, date_basis: d.dateBasis, lead_investors: d.investors.filter((i) => i.role === 'lead').map((i) => i.name).join(' | '), co_investors: d.investors.filter((i) => i.role === 'co').map((i) => i.name).join(' | '), partners: d.partners.map((p) => p.name).join(' | '), ...Object.fromEntries(EVAL_FIELDS.map((f) => [`ok_${f}`, ''])), nota: '' }));
  write(resolve(EVAL_DIR, 'deals_review.csv'), toCsv(rows, Object.keys(rows[0] || { extraction_id: '' })));
  console.log(`${rows.length} deals para revisar. En cada columna ok_<campo> escribe "si" o "no" (vacío si el campo está vacío y era correcto dejarlo vacío).`);
} else if (cmd === 'review-score') {
  const file = args[1] && !args[1].startsWith('--') ? args[1] : resolve(EVAL_DIR, 'deals_review.csv');
  const res = precisionFromReview(parseCsv(readFileSync(file, 'utf8')));
  console.log('| Campo | n revisados | Correctos | Precisión | IC 95 % |\n|---|---|---|---|---|');
  for (const [f, r] of Object.entries(res)) console.log(`| ${f} | ${r.n} | ${r.ok} | ${pct(r.precision)} | ${r.ci95[0] == null ? '—' : `${pct(r.ci95[0])}–${pct(r.ci95[1])}`} |`);
  write(resolve(EVAL_DIR, 'deals_review_score.json'), JSON.stringify({ file, at: new Date().toISOString(), fields: res }, null, 2));
} else if (cmd === 'gold-export' || cmd === 'trainset') {
  // Oro = extracciones del modelo grande revisadas a mano (review.gold) o, si no hay revisión, sus campos verificados.
  const ex = store.extractions().filter((e) => e.extractor.startsWith('vllm:'));
  const pages = new Map();
  for (const e of ex) { const prev = pages.get(e.url); if (!prev || (e.review && !prev.review)) pages.set(e.url, e); }
  const rows = [...pages.values()].map((e) => ({ url: e.url, split: e.split || splitOf(e.url), page: e.page, deals: e.review?.gold || e.verified.filter((v) => v.deal).map((v) => v.deal) }));
  for (const r of rows) store.setSplit(pages.get(r.url).id, r.split);
  if (cmd === 'gold-export') write(resolve(EVAL_DIR, 'deals_gold.jsonl'), rows.filter((r) => r.split === 'test').map((r) => JSON.stringify(r)).join('\n'));
  else {
    // Formato chat (messages) para SFT. La respuesta objetivo contiene solo lo que pasó la verificación literal.
    const target = (deals) => JSON.stringify({ deals: deals.map((d) => ({ startup: d.startup, sector: d.sector || '', country: d.countryText || '', stage: d.stage || '', amount_text: d.amountText || '', date_text: d.dateBasis === 'cita' ? d.date : '', lead_investors: d.investors.filter((i) => i.role === 'lead').map((i) => i.name), co_investors: d.investors.filter((i) => i.role === 'co').map((i) => i.name), partners: d.partners.map((p) => ({ name: p.name, fund: p.fund || '' })), quote: d.quote })) });
    for (const split of ['train', 'test']) write(resolve('../backend/ml/data', `${split}.jsonl`), rows.filter((r) => r.split === split).map((r) => JSON.stringify({ url: r.url, messages: [{ role: 'system', content: EXTRACT_SYSTEM }, { role: 'user', content: extractionPrompt(r.page) }, { role: 'assistant', content: target(r.deals) }] })).join('\n'));
    const n = rows.reduce((a, r) => ({ ...a, [r.split]: (a[r.split] || 0) + 1, [`${r.split}_deals`]: (a[`${r.split}_deals`] || 0) + r.deals.length }), {});
    console.log(JSON.stringify(n), n.train_deals < 500 ? '\nAVISO: menos de 500 extracciones verificadas en train; el Módulo 1 pide 500–2.000 antes del LoRA.' : '');
  }
} else if (cmd === 'compare') {
  const gold = readFileSync(resolve(EVAL_DIR, 'deals_gold.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const run = async (who) => {
    const env = { ...process.env, VLLM_EXTRACT_ROLE: who };
    const out = [];
    for (const g of gold) { const { accepted } = await processPage({ ...g.page, markdown: g.page.text, date: g.page.published }, { env }); out.push({ url: g.url, deals: accepted }); }
    return comparePerField(out, gold);
  };
  const a = await run(opt('a', 'chat')), b = await run(opt('b', 'small'));
  console.log(`| Campo | P ${opt('a', 'chat')} | R ${opt('a', 'chat')} | F1 ${opt('a', 'chat')} | P ${opt('b', 'small')} | R ${opt('b', 'small')} | F1 ${opt('b', 'small')} |\n|---|---|---|---|---|---|---|`);
  for (const f of EVAL_FIELDS) console.log(`| ${f} | ${pct(a[f].precision)} | ${pct(a[f].recall)} | ${pct(a[f].f1)} | ${pct(b[f].precision)} | ${pct(b[f].recall)} | ${pct(b[f].f1)} |`);
  const verdict = smallModelWins(a, b);
  console.log(verdict.wins ? `\nEl modelo ${opt('b')} iguala dentro de 3 puntos de F1 en todos los campos → úsalo por defecto (VLLM_EXTRACT_ROLE=${opt('b')}).` : `\nEl modelo ${opt('b')} NO iguala dentro de 3 puntos: ${verdict.gaps.filter((g) => g.gap > 0.03).map((g) => `${g.field} (−${(100 * g.gap).toFixed(1)})`).join(', ')}. Se mantiene ${opt('a')}.`);
  write(resolve(EVAL_DIR, 'extraction_compare.json'), JSON.stringify({ at: new Date().toISOString(), a: opt('a'), b: opt('b'), gold: gold.length, resultA: a, resultB: b, verdict }, null, 2));
} else {
  console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).join('\n'));
}
