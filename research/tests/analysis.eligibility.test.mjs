// Módulo 5. Las oraciones de prueba reproducen frases estándar de NOFOs de NIH; los casos son de prueba.
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateOpportunity, patternRules, deadlineAlerts, toICS, verdictAccuracy, IGC_PROFILE, opportunityFromLead } from '../server/analysis/eligibility.mjs';

const NOFO = 'Non-domestic (non-U.S.) Entities (Foreign Institutions) are not eligible to apply. Foreign components, as defined in the NIH Grants Policy Statement, are not allowed. Cost Sharing is not required. The PI must have primary employment (more than one half) with the small business at the time of award.';
const base = { id: 'X-1', number: 'PA-00-000', title: 'SBIR prueba', agency: 'NIH', url: 'https://www.grants.gov/search-results-detail/1', closeDate: '2026-11-05', awardCeiling: 300000, applicantTypes: [{ description: 'Small businesses' }], applicantEligibilityDesc: NOFO };

test('patrones: reglas con la oración literal como cita', () => {
  const r = patternRules(NOFO, base.url);
  assert.deepEqual(r.map((x) => x.type).sort(), ['cost_sharing', 'foreign_component', 'foreign_entity', 'pi_employment']);
  assert.ok(r.every((x) => NOFO.includes(x.quote.replace(/\.$/, ''))));
});

test('un "?" nunca se convierte en ✔', async () => {
  const e = await evaluateOpportunity(base, { today: new Date('2026-09-27'), useFleet: false });
  assert.equal(e.verdict, '?');
  assert.ok(e.questions.some((q) => /small business/i.test(q)));
  const full = { ...IGC_PROFILE, smallBusiness: { value: true }, foreignComponent: { value: false }, piPrimaryEmployment: { value: true } };
  const ok = await evaluateOpportunity(base, { profile: full, today: new Date('2026-09-27'), useFleet: false });
  assert.equal(ok.verdict, '✔');
  const abroad = await evaluateOpportunity(base, { profile: { ...full, foreignComponent: { value: true } }, today: new Date('2026-09-27'), useFleet: false });
  assert.equal(abroad.verdict, '✖');
  const closed = await evaluateOpportunity({ ...base, closeDate: '2026-01-01' }, { profile: full, today: new Date('2026-09-27'), useFleet: false });
  assert.equal(closed.verdict, '✖');
});

test('empresas con fines de lucro no pequeñas: ✔ si el campo oficial lo permite', async () => {
  const e = await evaluateOpportunity({ ...base, applicantTypes: ['For profit organizations other than small businesses'], applicantEligibilityDesc: '' }, { today: new Date('2026-09-27'), useFleet: false });
  assert.equal(e.verdict, '✔');
});

test('alertas 60/30/7, ICS y exactitud', async () => {
  const today = new Date('2026-09-27');
  const evals = [await evaluateOpportunity({ ...base, id: 'a', closeDate: '2026-10-02' }, { today, useFleet: false }), await evaluateOpportunity({ ...base, id: 'b', closeDate: '2026-11-15' }, { today, useFleet: false })];
  const al = deadlineAlerts(evals, { today });
  assert.equal(al[0].level, 'urgente'); assert.equal(al[1].level, 'aviso');
  const ics = toICS(evals, { now: today });
  assert.match(ics, /TRIGGER:-P30D/); assert.match(ics, /DTSTART;VALUE=DATE:20261002/);
  const acc = verdictAccuracy(evals, [{ id: 'a', veredicto_manual: '?' }, { id: 'b', veredicto_manual: '✖' }]);
  assert.equal(acc.n, 2); assert.equal(acc.accuracy, 0.5); assert.equal(acc.falsePass, 0);
});

test('convierte un lead del pipeline de grants', () => {
  const lead = { externalId: 'PA-1', title: 'T', org: 'NIH', deadline: '2026-12-01', amount: 1, evidence: [{ field: 'opportunity', url: 'https://www.grants.gov/search-results-detail/9', quote: 'T' }, { field: 'eligibility', url: 'https://www.grants.gov/search-results-detail/9', quote: 'Small businesses; For profit organizations other than small businesses' }] };
  const o = opportunityFromLead(lead);
  assert.deepEqual(o.applicantTypes, ['Small businesses', 'For profit organizations other than small businesses']);
});
