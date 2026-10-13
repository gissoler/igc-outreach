import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCorpus, runAB, plan, table, runA, CLASSES } from '../scripts/dates-ab.mjs';

const D = (role, date, quote, estimated = false) => ({ role, date, estimated, quote });
const crit = (v, quote = null) => ({ verdict: v, quote, reason: 'r', compiler: 'agree' });
const NIA_DATES = {
  niagads: [D('application_deadline', '2026-11-01', 'Estimated Application Due Date: November 1, 2026', true)],
  'precision-aging': [D('application_deadline', '2026-10-06', 'Estimated Application Due Date: October 6, 2026', true)],
};
const idOf = (user, pages) => pages.find((p) => user.includes(p.url))?.id;

/** Modelos simulados: B responde la verdad salvo lo que se le rompa; C reconoce los avisos previos de NIA y no ve fechas en las demás. */
function mockChat(pages, { b = {}, judgeDown = false } = {}) {
  return async ({ role, user, name }) => {
    const id = idOf(user, pages); const page = pages.find((p) => p.id === id);
    if (name === 'dates_b') { const forced = b[id]; if (forced === 'throw') throw new Error('timeout'); return { json: forced || { state: page.truth, deadline: null, quote: null } }; }
    const nia = NIA_DATES[id];
    if (role === 'compiler') return { json: { page_type: nia ? 'forecast_notice' : 'program_page', official: true, identity: { name: page.title, kind: 'program' }, dates: nia || [], eligibility: {} } };
    if (judgeDown) throw new Error('ECONNREFUSED');
    return { json: { page_type: nia ? 'forecast_notice' : 'program_page', dates: nia || [], criteria: { deadline: crit('unknown'), eligibility: crit('unknown'), topic_fit: crit('unknown') } } };
  };
}

test('V13-38 corpus: 16 pages with a truth class, none excluded, NIA marked forecast, no page with truth "open"', () => {
  const { pages, excluded } = loadCorpus();
  assert.equal(pages.length, 16); assert.deepEqual(excluded, []);
  const by = Object.fromEntries(CLASSES.map((c) => [c, pages.filter((p) => p.truth === c).length]));
  assert.deepEqual(by, { closed: 8, open: 0, upcoming: 2, forecast: 2, not_a_call: 3, unknown: 1 });
  assert.deepEqual(pages.filter((p) => p.truth === 'forecast').map((p) => p.id).sort(), ['niagads', 'precision-aging']);
  assert.ok(pages.every((p) => p.text.length > 500 && p.today && p.brief));
  assert.equal(pages.find((p) => p.id === 'precision-aging').reconstructed, true);
});

test('V13-39 variant A is deterministic code and reproduces the defect on the NIA notices (forecast read as open)', () => {
  const { pages } = loadCorpus();
  const nia = pages.filter((p) => p.truth === 'forecast').map((p) => runA(p).pred);
  assert.deepEqual(nia, ['open', 'open']);
});

test('V13-40 plan: B runs once per model role; C expands to informed and blind', () => {
  assert.deepEqual(plan(['A', 'B', 'C']).map((r) => r.key), ['A', 'B:compiler', 'B:judge', 'C-informed', 'C-blind']);
  assert.deepEqual(plan(['A']).map((r) => r.key), ['A']);
});

test('V13-41 runAB with simulated models: counts, graves, calls and per-page errors; a bad answer does not stop the run', async () => {
  const { pages } = loadCorpus();
  const sub = pages.filter((p) => ['niagads', 'precision-aging', 'wellcome', 'biohub'].includes(p.id));
  const res = await runAB({ pages: sub, variants: ['A', 'B', 'C'], chat: mockChat(sub, { b: { wellcome: 'throw', biohub: { state: 'maybe' } } }) });
  assert.deepEqual(res.map((r) => r.key), ['A', 'B:compiler', 'B:judge', 'C-informed', 'C-blind']);
  const get = (k) => res.find((r) => r.key === k).summary;
  assert.equal(get('A').graves.forecastAsOpen.length, 2);
  assert.equal(get('B:judge').noAnswer, 2); assert.equal(get('B:judge').ok, 2);
  for (const k of ['C-informed', 'C-blind']) { assert.equal(get(k).perClass.forecast.ok, 2); assert.equal(get(k).graves.total, 0); assert.equal(get(k).noAnswer, 0); }
  const ci = res.find((r) => r.key === 'C-informed'); assert.equal(ci.calls.compiler.calls, 4); assert.equal(ci.calls.judge.calls, 4);
  assert.ok(typeof table(res, sub) === 'string' && table(res, sub).split('\n').length === 7);
});

test('V13-42 judge down in C: every page unknown, zero graves, failure recorded', async () => {
  const { pages } = loadCorpus();
  const sub = pages.filter((p) => ['niagads', 'wellcome'].includes(p.id));
  const [ci] = (await runAB({ pages: sub, variants: ['C'], chat: mockChat(sub, { judgeDown: true }) })).filter((r) => r.key === 'C-informed');
  assert.deepEqual(ci.rows.map((r) => r.pred), ['unknown', 'unknown']); assert.equal(ci.summary.graves.total, 0);
  assert.ok(ci.rows.every((r) => /ECONNREFUSED/.test(r.error)));
});

test('V13-43 an invented quote in B sustains the decision (no auditor); in C the auditor rejects it', async () => {
  const { pages } = loadCorpus();
  const sub = pages.filter((p) => p.id === 'wellcome');
  const chat = async ({ role, name }) => {
    if (name === 'dates_b') return { json: { state: 'open', deadline: '2026-12-01', quote: 'Applications close on December 1, 2026 at noon' } };
    const dates = [D('application_deadline', '2026-12-01', 'Applications close on December 1, 2026 at noon')];
    if (role === 'compiler') return { json: { page_type: 'call', official: true, identity: { name: 'W', kind: 'program' }, dates, eligibility: {} } };
    return { json: { page_type: 'call', dates, criteria: { deadline: crit('yes', 'Applications close on December 1, 2026 at noon') } } };
  };
  const res = await runAB({ pages: sub, variants: ['B', 'C'], chat });
  const b = res.find((r) => r.key === 'B:judge').summary; const c = res.find((r) => r.key === 'C-blind').summary;
  assert.equal(b.graves.closedAsOpen.length, 1); assert.equal(b.quotesInvalidSustainingDecision, 1);
  assert.equal(c.graves.closedAsOpen.length, 0); assert.equal(c.quotesInvalidSustainingDecision, 0); assert.ok(c.quotesInvalid >= 2);
});
