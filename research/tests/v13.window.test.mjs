import test from 'node:test';
import assert from 'node:assert/strict';
import { auditPage } from '../server/research/judge/audit.v13.mjs';
import { validateCompilation, validateJudgment } from '../server/research/judge/contracts.v13.mjs';
import { judgePrompt } from '../server/research/judge/prompts.v13.mjs';
import { validateBrief } from '../server/research/core.mjs';

const TODAY = '2026-10-12';
const QUOTE = 'Applications are due January 15, 2027.';
const PAGE = { url: 'https://foundation.example/grants/alz-2027', title: 'Alzheimer Founders Grant 2027', text: `Alzheimer Founders Grant 2027\nFor-profit companies may apply. ${QUOTE} Funds software for early detection.` };
const D = [{ role: 'application_deadline', date: '2027-01-15', estimated: false, quote: QUOTE }];
const crit = (v, quote = null) => ({ verdict: v, quote, reason: 'r', compiler: 'agree' });
const comp = validateCompilation({
  page_type: 'call', relevant: true, official: true, money: 'grant', non_dilutive: 'yes', summary: 'resumen',
  identity: { name: PAGE.title, org: 'Foundation', kind: 'program', quote: PAGE.title }, dates: D,
  eligibility: { applicant_types: ['For-profit companies'], applicant_types_quote: 'For-profit companies may apply.', countries: [], countries_quote: null, stage: null, stage_quote: null, for_profit_allowed: 'yes', for_profit_quote: 'For-profit companies may apply.' },
  amount: { text: null, quote: null }, how_to_apply_quote: null,
}).value;
const judg = validateJudgment({
  page_type: 'call', dates: D,
  criteria: { deadline: crit('yes', QUOTE), eligibility: crit('yes', 'For-profit companies may apply.'), region: crit('unknown'), entity_type: crit('yes', 'For-profit companies may apply.'), stage: crit('unknown'), topic_fit: crit('yes', 'Funds software for early detection.') },
}).value;
const run = (window) => auditPage({ objective: 'grant', page: PAGE, today: TODAY, compilation: comp, judgment: judg, window });

test('V13-44 sin ventana: convocatoria abierta sigue en main (sin cambios)', () => {
  const a = run(null); assert.equal(a.state, 'open'); assert.equal(a.dropReason, null); assert.equal(a.mainOk, true); assert.equal(a.window, null);
});
test('V13-45 cierre dentro de la ventana: main', () => {
  const a = run({ from: '2026-12-01', to: '2027-02-28' }); assert.equal(a.dropReason, null); assert.equal(a.mainOk, true); assert.deepEqual(a.window, { from: '2026-12-01', to: '2027-02-28' });
});
test('V13-46 cierre antes de la ventana: se descarta con motivo outside_window', () => {
  const a = run({ from: '2027-02-01', to: '2027-03-31' }); assert.equal(a.dropReason, 'outside_window'); assert.equal(a.mainOk, false); assert.ok(a.flags.includes('deadline_outside_window'));
});
test('V13-47 cierre después de la ventana: se descarta', () => {
  const a = run({ to: '2026-12-31' }); assert.equal(a.dropReason, 'outside_window'); assert.equal(a.mainOk, false);
});
test('V13-48 los bordes cuentan: from == to == fecha de cierre', () => {
  const a = run({ from: '2027-01-15', to: '2027-01-15' }); assert.equal(a.dropReason, null); assert.equal(a.mainOk, true);
});
test('V13-49 la ventana la aplica el código sobre la fecha con cita, no sobre el veredicto del juez', () => {
  const liar = validateJudgment({ page_type: 'call', dates: D, criteria: { ...judg.criteria, deadline: crit('yes', QUOTE) } }).value;
  const a = auditPage({ objective: 'grant', page: PAGE, today: TODAY, compilation: comp, judgment: liar, window: { to: '2026-11-30' } });
  assert.equal(a.criteria.deadline.verdict, 'yes'); assert.equal(a.dropReason, 'outside_window');
});
test('V13-50 aviso previo con fecha estimada fuera de la ventana: no se descarta por la ventana, sigue sin entrar a main', () => {
  const f = auditPage({ objective: 'grant', page: PAGE, today: TODAY, compilation: validateCompilation({ ...comp, page_type: 'forecast_notice', dates: [{ ...D[0], estimated: true }] }).value, judgment: validateJudgment({ ...judg, page_type: 'forecast_notice', dates: [{ ...D[0], estimated: true }], criteria: { ...judg.criteria, deadline: crit('unknown') } }).value, window: { to: '2026-11-30' } });
  assert.equal(f.state, 'forecast'); assert.notEqual(f.dropReason, 'outside_window'); assert.equal(f.mainOk, false);
});
test('V13-51 el juez recibe la ventana en el brief y en la regla del criterio deadline', () => {
  const p = judgePrompt({ objective: 'grant', brief: { entityType: 'for_profit', deadlineFrom: '2026-12-01', deadlineTo: '2027-02-28' }, page: PAGE, today: TODAY });
  const text = `${p.system}\n${p.user}`;
  assert.ok(text.includes('deadlineFrom: 2026-12-01')); assert.ok(text.includes('deadlineTo: 2027-02-28')); assert.ok(/inside that window/.test(text));
});
test('V13-52 validateBrief: ventana opcional, fechas reales, from <= to', () => {
  const base = { name: 'A', role: 'Founder', company: 'C', product: 'P', description: 'D', industry: 'health', stage: 'marketed', geography: 'US', fundingTypes: ['grant'], dataMode: 'live', organization: 'C', venture: 'C', entityType: 'for_profit' };
  let ok; try { ok = validateBrief({ ...base }); } catch (e) { return assert.fail(`base brief should validate: ${e.message}`); }
  assert.equal(ok.deadlineFrom, undefined); assert.equal(ok.deadlineTo, undefined);
  const w = validateBrief({ ...base, deadlineFrom: '2026-12-01', deadlineTo: '2027-02-28' }); assert.equal(w.deadlineFrom, '2026-12-01'); assert.equal(w.deadlineTo, '2027-02-28');
  assert.throws(() => validateBrief({ ...base, deadlineFrom: '2027-03-01', deadlineTo: '2027-02-28' }), /not be after/);
  assert.throws(() => validateBrief({ ...base, deadlineFrom: '2026-02-30' }), /YYYY-MM-DD/);
  assert.throws(() => validateBrief({ ...base, deadlineTo: 'mañana' }), /YYYY-MM-DD/);
});

test('V13-56 el brief que ven compilador y juez incluye oneLiner (sin él, "mint ad" se lee como publicidad)', async () => {
  const { briefBlock } = await import('../server/research/judge/prompts.v13.mjs');
  const b = briefBlock({ product: 'mint ad', oneLiner: 'stratification tool that tells the risk of a patient to develop AD', industry: 'healthcare' });
  assert.ok(b.includes('oneLiner: stratification tool that tells the risk of a patient to develop AD'));
});
