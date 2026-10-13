import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { auditPage, applyAudit, dateOverrideOf, legacyOut, verifyDate, stateFrom, judgeMode } from '../server/research/judge/audit.v13.mjs';
import { validateCompilation, validateJudgment } from '../server/research/judge/contracts.v13.mjs';
import { verifyFinding } from '../server/research/engine.mjs';
import { fleetConfig } from '../server/analysis/fleet.mjs';

const fx = JSON.parse(readFileSync(new URL('./fixtures/nia-fixtures.json', import.meta.url), 'utf8'));
const pageOf = (id) => { const p = fx.pages.find((x) => x.id === id); return { url: p.url, title: p.title, text: readFileSync(new URL(`./fixtures/${p.file}`, import.meta.url), 'utf8'), meta: p }; };
const BRIEF = { entityType: 'for-profit company', country: 'Colombia', stage: 'preclinical', industry: 'Alzheimer pharma', product: 'AI stratification tool', minDays: 21 };
const TODAY = '2026-10-12';

const D = (role, date, quote, estimated = false) => ({ role, date, estimated, quote });
const crit = (v, quote = null, reason = 'r', compiler = 'agree') => ({ verdict: v, quote, reason, compiler });
function compilation(page, over = {}) {
  return validateCompilation({
    page_type: 'forecast_notice', relevant: true, official: true, money: 'grant', non_dilutive: 'yes', summary: 'resumen',
    identity: { name: page.title, org: 'NIA', kind: 'program', quote: page.title },
    dates: [D('application_deadline', page.meta.dates.application_deadline, `Estimated Application Due Date: ${new Date(page.meta.dates.application_deadline + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}`, true)],
    eligibility: { applicant_types: ['Small businesses'], applicant_types_quote: 'Small businesses', countries: [], countries_quote: null, stage: null, stage_quote: null, for_profit_allowed: 'yes', for_profit_quote: 'For-profit organizations other than small businesses' },
    amount: { text: null, quote: null }, how_to_apply_quote: null, ...over,
  }).value;
}
function judgment(page, over = {}) {
  const c = compilation(page);
  return validateJudgment({
    page_type: 'forecast_notice', dates: c.dates,
    criteria: {
      deadline: crit('unknown', 'Applications are not being solicited at this time', 'only an estimated date'),
      eligibility: crit('yes', 'Small businesses'), region: crit('unknown'), entity_type: crit('yes', 'For-profit organizations other than small businesses'),
      stage: crit('unknown'), topic_fit: crit('yes', 'Applications are not being solicited at this time'),
    }, ...over,
  }).value;
}
const audit = (page, o = {}) => auditPage({ objective: 'grant', page, today: TODAY, compilation: compilation(page), judgment: judgment(page), ...o });

test('V13-10 NIA notices: the page text still fools the pattern reader (the defect being fixed)', () => {
  const a = verifyFinding({ ...legacyOut(compilation(pageOf('precision-aging')), audit(pageOf('precision-aging'))), status: 'upcoming' }, pageOf('precision-aging'), 'grant', { today: TODAY, brief: BRIEF });
  assert.equal(a.dates.status, 'open'); assert.equal(a.dates.quote, 'Award Date: July 6, 2027');   // el lector por patrones sigue leyendo mal
});

for (const id of ['niagads', 'precision-aging']) {
  test(`V13-11 ${id}: forecast notice is audited as forecast, never open, never main, no days left`, () => {
    const page = pageOf(id); const a = audit(page);
    assert.equal(a.state, 'forecast'); assert.equal(a.deadline, null); assert.equal(a.daysLeft, null); assert.equal(a.estimatedDeadline, page.meta.dates.application_deadline);
    assert.equal(a.mainOk, false);
    const out = legacyOut(compilation(page), a);
    const v = applyAudit(verifyFinding(out, page, 'grant', { today: TODAY, brief: BRIEF, dateOverride: dateOverrideOf(a) }), a);
    assert.notEqual(v.status, 'open'); assert.equal(v.status, 'upcoming');
    assert.equal(v.daysLeft, null); assert.equal(v.deadline, null);
    assert.notEqual(v.tier, 'main'); assert.equal(v.tier, 'verify'); assert.equal(v.forecast, true);
    assert.ok(v.flags.includes('date_pattern_disagrees'), 'alarm from the pattern reader');
    assert.ok(v.blockers.some((b) => /Forecast notice/.test(b)));
    // criterio 6: la lectura por patrones queda intacta en `dates`
    const plain = verifyFinding(out, page, 'grant', { today: TODAY, brief: BRIEF });
    assert.deepEqual(v.dates, plain.dates);
  });
}

test('V13-12 either agent flagging "estimated" makes it a forecast; a past estimated date is not "closed"', () => {
  const page = pageOf('niagads');
  const cNotEst = compilation(page, { page_type: 'call', dates: [D('application_deadline', '2026-11-01', 'Estimated Application Due Date: November 1, 2026', false)] });
  const jNotEst = judgment(page, { page_type: 'call', dates: [D('application_deadline', '2026-11-01', 'Estimated Application Due Date: November 1, 2026', true)] });
  assert.equal(auditPage({ page, today: TODAY, compilation: cNotEst, judgment: jNotEst }).state, 'forecast');
  const past = judgment(page, { dates: [D('application_deadline', '2026-09-01', 'Estimated Post Date: September 1, 2026', true)] });
  assert.equal(auditPage({ page, today: TODAY, compilation: compilation(page), judgment: past }).state, 'forecast');
});

const OPEN_TEXT = `# Founders Grant 2027\n\nThe Founders Grant funds early-stage Alzheimer drug discovery companies.\n\nWho can apply: For-profit companies and startups from any country are eligible to apply.\n\nApplications are due March 15, 2027 at 5 pm ET.\n\nHow to apply: submit the form on this page.\n`;
const openPage = { url: 'https://foundersgrant.org/apply', title: 'Founders Grant 2027', text: OPEN_TEXT, meta: { dates: { application_deadline: '2027-03-15' } } };
const openC = (over = {}) => validateCompilation({
  page_type: 'call', relevant: true, official: true, money: 'grant', non_dilutive: 'yes', summary: 's', identity: { name: 'Founders Grant 2027', org: 'Founders', kind: 'program', quote: 'The Founders Grant funds early-stage Alzheimer drug discovery companies' },
  dates: [D('application_deadline', '2027-03-15', 'Applications are due March 15, 2027 at 5 pm ET')], eligibility: { applicant_types: ['For-profit companies'], applicant_types_quote: 'For-profit companies and startups from any country are eligible to apply', countries: ['any'], countries_quote: null, stage: null, stage_quote: null, for_profit_allowed: 'yes', for_profit_quote: null },
  amount: { text: null, quote: null }, how_to_apply_quote: 'submit the form on this page', ...over,
}).value;
const openJ = (over = {}) => validateJudgment({
  page_type: 'call', dates: [D('application_deadline', '2027-03-15', 'Applications are due March 15, 2027 at 5 pm ET')],
  criteria: { deadline: crit('yes', 'Applications are due March 15, 2027 at 5 pm ET'), eligibility: crit('yes', 'For-profit companies and startups from any country are eligible to apply'), region: crit('yes', 'from any country are eligible to apply'), entity_type: crit('yes', 'For-profit companies and startups'), stage: crit('unknown'), topic_fit: crit('yes', 'funds early-stage Alzheimer drug discovery companies') }, ...over,
}).value;
const run = (c, j, o = {}) => {
  const a = auditPage({ page: openPage, today: TODAY, compilation: c, judgment: j, ...o });
  const v = applyAudit(verifyFinding(legacyOut(c, a), openPage, 'grant', { today: TODAY, brief: BRIEF, dateOverride: dateOverrideOf(a) }), a);
  return { a, v };
};

test('V13-13 an open call where both agents agree and every quote is on the page reaches main, with days from today', () => {
  const { a, v } = run(openC(), openJ());
  assert.equal(a.state, 'open'); assert.equal(a.deadline, '2027-03-15'); assert.equal(a.daysLeft, 154);
  assert.deepEqual(a.disagreements, []); assert.equal(a.mainOk, true);
  assert.equal(v.tier, 'main'); assert.equal(v.status, 'open'); assert.equal(v.daysLeft, 154); assert.equal(v.deadline, '2027-03-15');
});

test('V13-14 a deadline before today is closed by code whatever the model says about status', () => {
  const c = openC({ dates: [D('application_deadline', '2026-10-06', 'Applications are due October 6, 2026 at 5 pm ET')] });
  const page = { ...openPage, text: OPEN_TEXT.replace('March 15, 2027', 'October 6, 2026') };
  const j = openJ({ dates: c.dates, criteria: { ...openJ().criteria, deadline: crit('yes', 'Applications are due October 6, 2026 at 5 pm ET') } });
  const a = auditPage({ page, today: TODAY, compilation: c, judgment: j });
  assert.equal(a.state, 'closed'); assert.equal(a.dropReason, 'closed'); assert.equal(a.daysLeft, null);
  assert.ok(a.disagreements.some((d) => /Judge says the deadline is open/.test(d)));
  const v = applyAudit(verifyFinding({ ...legacyOut(c, a), status: 'upcoming', deadline: '2026-10-06' }, page, 'grant', { today: TODAY, brief: BRIEF, dateOverride: dateOverrideOf(a) }), a);
  assert.equal(v.tier, 'drop'); assert.equal(v.drop, 'closed');
});

test('V13-15 compiler and judge disagree on the deadline: verify, never main, both readings visible', () => {
  const text2 = `${OPEN_TEXT}\nLetter of intent due January 10, 2027.\n`;
  const page2 = { ...openPage, text: text2 };
  const c = openC();
  const j = openJ({ dates: [D('application_deadline', '2027-01-10', 'Letter of intent due January 10, 2027')] });   // el juez toma la LOI como plazo
  const a = auditPage({ page: page2, today: TODAY, compilation: c, judgment: j });
  const v = applyAudit(verifyFinding(legacyOut(c, a), page2, 'grant', { today: TODAY, brief: BRIEF, dateOverride: dateOverrideOf(a) }), a);
  assert.equal(a.mainOk, false); assert.equal(v.tier, 'verify');
  assert.ok(a.disagreements.some((d) => /Application deadline: compiler 2027-03-15, judge 2027-01-10/.test(d)));
  assert.deepEqual([a.dates.compiler.length, a.dates.judge.length], [1, 1]);
  const j2 = openJ({ page_type: 'program_page' });
  const r2 = run(c, j2); assert.equal(r2.v.tier, 'verify'); assert.ok(r2.a.disagreements.some((d) => /Page type/.test(d)));
  const j3 = openJ({ criteria: { ...openJ().criteria, topic_fit: crit('yes', 'funds early-stage Alzheimer drug discovery companies', 'r', 'disagree') } });
  assert.ok(run(c, j3).a.disagreements.some((d) => /Criterion topic_fit/.test(d)));
});

test('V13-16 invented quote: the date is not sustained and no decision rests on it', () => {
  const c = openC({ dates: [D('application_deadline', '2027-03-15', 'The deadline for applications is March 15, 2027')] });   // no está en la página
  const j = openJ({ dates: c.dates });
  const { a, v } = run(c, j);
  assert.equal(a.dates.judge[0].verified, false); assert.equal(a.dates.judge[0].why, 'quote_not_in_page');
  assert.equal(a.state, 'unknown'); assert.equal(v.deadline, null); assert.equal(v.daysLeft, null); assert.notEqual(v.tier, 'main');
  assert.ok(a.flags.includes('date_quote_not_in_page:application_deadline'));
});

test('V13-17 a quote with several dates, or a date not in its quote, is not verified (no label shifting)', () => {
  const t = 'Estimated Application Due Date: October 6, 2026 Estimated Award Date: July 6, 2027 for the program.';
  assert.equal(verifyDate(D('application_deadline', '2027-07-06', 'Estimated Application Due Date: October 6, 2026 Estimated Award Date: July 6, 2027'), t).why, 'quote_has_several_dates');
  assert.equal(verifyDate(D('application_deadline', '2027-07-06', 'Estimated Application Due Date: October 6, 2026'), t).why, 'date_not_in_quote');
  assert.equal(verifyDate(D('application_deadline', null, 'Estimated Application Due Date: October 6, 2026'), t).why, 'no_date');
  assert.equal(verifyDate(D('application_deadline', '2026-10-06', 'Estimated Application Due Date: October 6, 2026'), t).verified, true);
});

test('V13-18 yes/no without a literal page quote is downgraded to unknown; a "no" with a quote drops', () => {
  const j = openJ({ criteria: { ...openJ().criteria, eligibility: crit('yes', 'Everybody is welcome to apply here'), region: crit('no', 'Applicants from Colombia are excluded from this call') } });
  const { a, v } = run(openC(), j);
  assert.equal(a.criteria.eligibility.verdict, 'unknown'); assert.equal(a.criteria.eligibility.claimed, 'yes');
  assert.equal(a.criteria.region.verdict, 'unknown');
  assert.ok(a.flags.includes('fake_quote:eligibility') && a.flags.includes('fake_quote:region'));
  assert.equal(a.dropReason, null); assert.notEqual(v.tier, 'main');
  assert.ok(a.blockers.some((b) => /"no" for region without a quote/.test(b)));
  const noq = openJ({ criteria: { ...openJ().criteria, entity_type: crit('no', 'For-profit companies and startups from any country are eligible to apply') } });
  const r = run(openC(), noq);
  assert.equal(r.a.dropReason, 'not_eligible'); assert.equal(r.v.tier, 'drop'); assert.equal(r.v.drop, 'not_eligible');
});

test('V13-19 judge down, invalid or missing: fail closed with a visible notice, nothing reaches main', () => {
  for (const failure of ['timeout', 'invalid_json: /criteria must be object', 'http 503']) {
    const a = auditPage({ page: openPage, today: TODAY, compilation: openC(), judgment: null, failure: { judge: failure } });
    assert.equal(a.state, 'unverified'); assert.equal(a.mainOk, false); assert.equal(a.judgeOk, false); assert.match(a.blockers[0], /Judge unavailable/);
    const v = applyAudit(verifyFinding(legacyOut(openC(), a), openPage, 'grant', { today: TODAY, brief: BRIEF, dateOverride: dateOverrideOf(a) }), a);
    assert.notEqual(v.tier, 'main'); assert.equal(v.status, 'unknown'); assert.equal(v.deadline, null);
  }
  // criterio omitido por el juez: unknown + bandera, y los obligatorios impiden main
  const j = openJ(); delete j.criteria.topic_fit;
  const r = run(openC(), j); assert.ok(r.a.flags.includes('criterion_missing:topic_fit')); assert.notEqual(r.v.tier, 'main');
});

test('V13-20 an investor page: no deadline, criteria catalog without deadline/eligibility, a judge "no" with quote drops', () => {
  const page = { url: 'https://acmevc.com/about', title: 'Acme VC', text: 'Acme VC invests in pre-seed and seed biotech startups in Latin America. We do not invest in medical devices. Pitch us at hello@acmevc.com. Portfolio 2026.' };
  const c = validateCompilation({ page_type: 'funder_about', official: true, relevant: true, money: 'equity', non_dilutive: 'no', identity: { name: 'Acme VC', kind: 'investor', quote: 'Acme VC invests in pre-seed and seed biotech startups in Latin America' }, dates: [], eligibility: {}, how_to_apply_quote: 'Pitch us at hello@acmevc.com' }).value;
  const ok = validateJudgment({ page_type: 'funder_about', dates: [], criteria: { region: crit('yes', 'startups in Latin America'), entity_type: crit('unknown'), stage: crit('yes', 'pre-seed and seed biotech startups'), topic_fit: crit('yes', 'invests in pre-seed and seed biotech startups') } }).value;
  const a = auditPage({ objective: 'investment', page, today: TODAY, compilation: c, judgment: ok });
  assert.equal(a.state, 'n/a'); assert.equal(a.dropReason, null); assert.equal(a.mainOk, true); assert.equal(dateOverrideOf(a), null);
  const bad = validateJudgment({ page_type: 'funder_about', dates: [], criteria: { region: crit('yes', 'startups in Latin America'), stage: crit('yes', 'pre-seed and seed biotech startups'), topic_fit: crit('no', 'We do not invest in medical devices') } }).value;
  const b = auditPage({ objective: 'investment', page, today: TODAY, compilation: c, judgment: bad });
  assert.equal(b.dropReason, 'scope_mismatch'); assert.equal(b.mainOk, false);
  const none = auditPage({ objective: 'investment', page, today: TODAY, compilation: c, judgment: null, failure: { judge: 'timeout' } });
  assert.equal(none.mainOk, false);
});

test('V13-21 stateFrom: closed only when every verified application deadline is before today; LOI dates do not close', () => {
  const v = (role, date) => ({ role, date, estimated: false, quote: 'q', verified: true });
  const base = { judgeType: 'call', compilerType: 'call', compilerDates: [], today: TODAY, dated: true };
  assert.equal(stateFrom({ ...base, judgeDates: [v('application_deadline', '2026-10-01'), v('application_deadline', '2026-11-01')] }).state, 'open');
  assert.equal(stateFrom({ ...base, judgeDates: [v('application_deadline', '2026-10-01'), v('application_deadline', '2026-10-05')] }).state, 'closed');
  assert.equal(stateFrom({ ...base, judgeDates: [v('loi_deadline', '2026-09-01')] }).state, 'unknown');
  assert.equal(stateFrom({ ...base, judgeDates: [v('application_deadline', '2026-10-12')] }).daysLeft, 0);
  assert.equal(stateFrom({ ...base, dated: false, judgeDates: [] }).state, 'n/a');
});

test('V13-22 judgeMode: off by default; on without roles warns and keeps the current behaviour', () => {
  assert.deepEqual(judgeMode({}), { on: false, ready: false, notice: null });
  const m = judgeMode({ ENGINE_JUDGE: '1' }, fleetConfig({}));
  assert.equal(m.on, true); assert.equal(m.ready, false); assert.deepEqual(m.missing, ['compiler', 'judge']); assert.match(m.notice, /ENGINE_JUDGE=1/);
  const env = { ENGINE_JUDGE: '1', ENGINE_JUDGE_BLIND: '1', COMPILER_LLM_URL: 'http://a/v1', COMPILER_LLM_MODEL: 'q', JUDGE_LLM_URL: 'http://b/v1', JUDGE_LLM_MODEL: 'g' };
  const ok = judgeMode(env, fleetConfig(env)); assert.deepEqual([ok.ready, ok.blind, ok.sameModel, ok.notice], [true, true, false, null]);
  const e2 = { ENGINE_JUDGE: '1', ENGINE_LLM_URL: 'http://e/v1', ENGINE_LLM_MODEL: 'm', COMPILER_LLM_FALLBACK: 'engine', JUDGE_LLM_FALLBACK: 'engine' };
  assert.equal(judgeMode(e2, fleetConfig(e2)).sameModel, true);
});

test('V13-35 a judge deadline without a valid quote is not ignored even if another one is valid', () => {
  const j = openJ({ dates: [D('application_deadline', '2027-03-15', 'Applications are due March 15, 2027 at 5 pm ET'), D('application_deadline', '2026-12-01', 'Applications are due December 1, 2026 at noon')] });
  const { a, v } = run(openC(), j);
  assert.equal(a.state, 'open'); assert.equal(a.mainOk, false); assert.notEqual(v.tier, 'main');
  assert.ok(a.blockers.some((b) => /no valid quote/.test(b)));
});

test('V13-36 compilation without "official" is invalid (it would silently drop everything as not official)', () => {
  const c = compilation(pageOf('niagads')); delete c.official;
  assert.equal(validateCompilation(c).ok, false);
});

test('V13-37 a firm deadline but a future opening date: not open yet, to verify, deadline and days kept', () => {
  const text = `${OPEN_TEXT}\nApplications open on January 5, 2027.\n`;
  const page = { ...openPage, text };
  const j = openJ({ dates: [D('opens', '2027-01-05', 'Applications open on January 5, 2027'), D('application_deadline', '2027-03-15', 'Applications are due March 15, 2027 at 5 pm ET')] });
  const c = openC({ dates: j.dates });
  const a = auditPage({ page, today: TODAY, compilation: c, judgment: j });
  assert.equal(a.state, 'upcoming'); assert.equal(a.deadline, '2027-03-15'); assert.equal(a.opensOn, '2027-01-05'); assert.equal(a.mainOk, false);
  const v = applyAudit(verifyFinding(legacyOut(c, a), page, 'grant', { today: TODAY, brief: BRIEF, dateOverride: dateOverrideOf(a) }), a);
  assert.equal(v.status, 'upcoming'); assert.equal(v.deadline, '2027-03-15'); assert.equal(v.tier, 'verify'); assert.ok(v.blockers.some((b) => /Not open yet/.test(b)));
  // apertura ya pasada: abierta
  const past = openJ({ dates: [D('opens', '2026-09-01', 'Applications open on September 1, 2026'), D('application_deadline', '2027-03-15', 'Applications are due March 15, 2027 at 5 pm ET')] });
  const page2 = { ...openPage, text: `${OPEN_TEXT}\nApplications open on September 1, 2026.\n` };
  assert.equal(auditPage({ page: page2, today: TODAY, compilation: openC({ dates: past.dates }), judgment: past }).state, 'open');
});
