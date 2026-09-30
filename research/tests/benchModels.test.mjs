import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { benchModel, scoreExtract, scoreJudge, scorePlan, summaryTable } from '../eval/benchModels.mjs';

const gold = JSON.parse(readFileSync(new URL('../eval/bench/mentiva-gold.json', import.meta.url), 'utf8'));
const { pages } = JSON.parse(readFileSync(new URL('../eval/bench/mentiva-pages.json', import.meta.url), 'utf8'));

test('gold facts are literally present in the stored pages the models will read', () => {
  const must = { nia: 'January 15, 2027', mmhpi: 'April 5, 2023', braininnovationdays: '30 June 2026', vestbee: 'April 30, 2025', wellcome: '18 September 2026', innovationsinmentalhealth: 'not open for any new applications' };
  for (const [id, text] of Object.entries(must)) assert.ok(pages.find((p) => p.id === id).text.includes(text), id);
  for (const page of pages) assert.ok(gold.extract[page.id], `gold for ${page.id}`);
});

test('extraction scoring rewards the right fields and catches invented quotes and deadlines', () => {
  const page = pages.find((p) => p.id === 'wellcome');
  const good = scoreExtract({ status: 'closed', deadline: '2026-09-18', official: true, non_dilutive: 'yes', quotes: { deadline: 'with an application deadline of 18 September 2026' } }, gold.extract.wellcome, page.text);
  assert.equal(good.correct, good.total);
  assert.equal(good.fakeQuotes, 0);
  const onemind = pages.find((p) => p.id === 'onemind');
  const bad = scoreExtract({ status: 'open', deadline: '2026-10-19', official: true, eligible: 'yes', quotes: { deadline: 'Applications close October 19, 2026' } }, gold.extract.onemind, onemind.text);
  assert.equal(bad.checks.find((c) => c.field === 'deadline').ok, false, 'the stored page does not state a deadline');
  assert.equal(bad.fakeQuotes, 1);
});

test('plan and judge scoring', () => {
  const plan = scorePlan([{ query: 'NIMH SBIR digital mental health 2026' }, { query: 'EIC Accelerator mental health' }, { query: 'mental health startup accelerator 2027 cohort' }], gold.plan.families);
  assert.deepEqual(plan.covered.sort(), ['eu_programs', 'mental_health_accelerators', 'time_bound', 'us_federal_sbir']);
  const judge = scoreJudge({ decisions: gold.judge.decisions, top3: ['S2', 'S1', 'S6'] }, gold.judge);
  assert.equal(judge.correct, 10);
  assert.equal(judge.top2ok, true);
  assert.equal(judge.skipInTop3, 1);
});

test('an oracle model scores 100% end to end through the OpenAI-compatible client', async () => {
  const fetcher = async (url, init) => {
    const { messages } = JSON.parse(init.body);
    const user = messages[1].content;
    let json;
    if (user.includes('Write 20 distinct')) json = { queries: [{ query: 'NIMH SBIR 2026' }, { query: 'EIC Accelerator' }, { query: 'Innovate UK mental health' }, { query: 'IRAP Canada digital health' }, { query: 'mental health accelerator cohort' }, { query: 'global health prize' }, { query: 'mental health foundation grant' }] };
    else if (user.includes('PAGE URL')) { const id = pages.find((p) => user.includes(p.url)).id; json = { ...Object.fromEntries(Object.entries(gold.extract[id]).filter(([, v]) => v !== null)), deadline: gold.extract[id].deadline, quotes: {} }; }
    else json = { decisions: gold.judge.decisions, top3: ['S1', 'S2', 'S3'] };
    return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: `<think>x</think>${JSON.stringify(json)}` } }] }) };
  };
  const row = await benchModel({ name: 'oracle', url: 'http://fleet:8000/v1', model: 'oracle' }, { gold, pages, fetcher });
  assert.equal(row.plan.coverage, 1);
  assert.equal(row.extract.correct, row.extract.total);
  assert.equal(row.judge.correct, 10);
  assert.equal(row.jsonFail, 0);
  assert.match(summaryTable([row]), /\| oracle \| 100%/);
});
