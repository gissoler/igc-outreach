// 27-10 · Prueba IGC «family offices»: tipo de inversor, función del contacto, exclusiones del chat,
// geografía de búsqueda vs. país de la empresa, resumen sin «todo listo» y plan de outreach sin invenciones.
import test from 'node:test';
import assert from 'node:assert/strict';
import { candidate, evaluate, evidence } from '../server/research/core.mjs';
import { assessInvestor, classifyEntity, dealsFrom, investorPrefs, parseExclusions, parseInvestorTypes, parseTypeMode, roleFit } from '../server/research/investors/fit.mjs';
import { newIntake, readiness, runTurn, summaryLine } from '../server/research/intake.mjs';
import { rulePlan, outreachPlan, similarBrief } from '../server/research/outreachPlan.mjs';
import { validateTracking } from '../server/research/tracking.mjs';

const ev = (url, quote, source = 'Web research engine') => evidence(source, url, quote, 'profile');
const org = (name, quotes, extra = {}) => candidate({ externalId: `t:${name}`, key: `t:${name}`, org: name, title: name, kind: 'research', fundingType: 'investment', status: 'unknown', contact: { type: 'web', value: `https://${name.replace(/\W/g, '').toLowerCase()}.com`, provenance: 'site' }, evidence: quotes.map((q) => ev(`https://${name.replace(/\W/g, '').toLowerCase()}.com/about`, q)), searchText: quotes.join(' '), ...extra });
const person = (name, role, orgName) => candidate({ externalId: `t:${orgName}:${name}`, person: name, role, org: orgName, title: `${role} at ${orgName}`, kind: 'person', fundingType: 'investment', status: 'unknown', contact: { type: 'email', value: `${name.split(' ')[0].toLowerCase()}@x.com`, provenance: 'Contact Finder' }, evidence: [], orgEvidence: [ev('https://x.com/team', `${name} works at ${orgName}`)], searchText: `${role} ${orgName} biotechnology neuroscience`, parentKey: `t:${orgName}` });
const brief = { name: 'G', role: 'CEO', company: 'IGC Pharma', product: 'IGC-AD1', description: 'Alzheimer biotech', industry: 'biotechnology; neuroscience', stage: 'clinical_phase_2', geography: 'GLOBAL', fundingTypes: ['investment'], amount: null, criteria: '', exclusions: '', event: '', minDays: 30, mode: 'strategic', dataMode: 'live', useTeam: false, useApify: true, excludeCompetitors: false, strictTypes: false, investorTypes: 'family_office', investorTypesMode: 'prefer', listing: 'public', constraints: 'Exclude advisers without direct investments and unrelated VC funds.' };

test('ACC-FO-1 pedido: tipos, modo y exclusiones del chat se leen como reglas', () => {
  assert.deepEqual(parseInvestorTypes("I'd like to find family offices that could invest in IGC Pharma."), ['family_office']);
  assert.equal(parseTypeMode('We prefer family offices that invest directly'), 'prefer');
  assert.equal(parseTypeMode('Only family offices, please'), 'only');
  assert.equal(parseTypeMode('We want family offices'), '');
  assert.equal(parseTypeMode('Show only family offices in the main list; list other investors separately as alternatives.'), 'prefer');
  const x = parseExclusions('Exclude advisers without direct investments and unrelated VC funds.');
  assert.deepEqual(x.map((e) => e.kind).sort(), ['unrelated_vc', 'wealth_adviser']);
  assert.equal(investorPrefs(brief).listing, 'public');
});

test('ACC-FO-2 cargos operativos no son contactos de inversión', () => {
  for (const r of ['Customer Service Manager', 'Operations Manager', 'Director, Quantitative Pharmacology', 'Executive Assistant', 'Field Service Training Director', 'Vice President of Finance']) assert.equal(roleFit(r), 'operational', r);
  for (const r of ['Partner', 'Managing Partner', 'Principal', 'Chief Investment Officer', 'Investment Associate']) assert.equal(roleFit(r), 'investing', r);
  assert.equal(roleFit('CEO'), 'leadership');
  assert.equal(roleFit(''), 'unknown');
});

test('ACC-FO-3 el nombre «Family Office» no basta; una fuente que lo describe sí', () => {
  const byName = classifyEntity(org('Cooper Family Office', ['Cooper Family Office backs biotechnology companies.']));
  assert.equal(byName.type, 'family_office'); assert.equal(byName.nameOnly, true);
  const sourced = classifyEntity(org('Walden Holdings', ['Walden Holdings is a single family office that makes direct investments in life sciences companies.']));
  assert.equal(sourced.type, 'family_office'); assert.equal(sourced.status, 'sourced');
  const funded = classifyEntity(org('NeuroCo', ['NeuroCo raised a $40 million Series B financing led by Atlas Venture.']));
  assert.equal(funded.type, 'funded_company');
  const cvc = classifyEntity(org('Merck.com', ["We invest globally in early-stage, preclinical therapeutics companies, providing capital, strategic guidance and access to Merck’s deep domain expertise."]));
  assert.equal(cvc.type, 'corporate_venture');
});

test('ACC-FO-4 caso IGC: lista principal sin empleados operativos ni VC no relacionados; alternativas y por verificar separadas', () => {
  const leads = [
    org('Walden Holdings', ['Walden Holdings is a single family office that makes direct investments in biotechnology and neuroscience companies, including a 2025 PIPE in a listed biotech.']),
    org('Cooper Family Office', ['Cooper Family Office backs biotechnology companies.']),
    org('Merck.com', ["We invest globally in early-stage, preclinical therapeutics companies in neuroscience, providing capital and access to Merck’s deep domain expertise."]),
    org('Palo Santo', ['Palo Santo is a venture capital firm investing in neuroscience companies.']),
    org('Gamma Ventures', ['Gamma Ventures is a venture capital firm investing in fintech and enterprise software.']),
    org('Summit Wealth', ['Summit Wealth provides wealth management and family office services, tax planning and estate planning for families.']),
    person('John Shams', 'Customer Service Manager', 'Merck.com'),
    person('Jeannine McCune', 'Director, Quantitative Pharmacology', 'Merck.com'),
    person('Ana Partner', 'Managing Partner', 'Walden Holdings'),
  ];
  const out = evaluate(leads, brief);
  const by = (n) => out.find((l) => (l.person || l.org) === n);
  assert.equal(by('Walden Holdings').investorFit.tier, 'meets');
  assert.equal(by('Walden Holdings').bucket, 'top');
  assert.equal(by('Ana Partner').investorFit.tier, 'meets');
  assert.equal(by('Cooper Family Office').investorFit.tier, 'verify', 'name only');
  assert.equal(by('Merck.com').investorFit.tier, 'alternative');
  assert.equal(by('Palo Santo').investorFit.tier, 'alternative');
  assert.equal(by('Gamma Ventures').bucket, 'discarded', 'unrelated VC excluded by the chat');
  assert.match(by('Gamma Ventures').discard, /Your exclusion/);
  assert.equal(by('Summit Wealth').bucket, 'discarded', 'adviser without direct investments');
  assert.equal(by('John Shams').bucket, 'discarded'); assert.match(by('John Shams').discard, /not an investment role/);
  assert.equal(by('Jeannine McCune').bucket, 'discarded');
  const top = out.filter((l) => l.bucket === 'top').map((l) => l.person || l.org);
  assert.deepEqual(top.sort(), ['Ana Partner', 'Walden Holdings']);
  assert.ok(by('Ana Partner').investorFit.reasons.some((r) => /not attributed to this person/.test(r)));
});

test('ACC-FO-5 «solo family offices» descarta otros tipos en vez de rellenar la lista', () => {
  const out = evaluate([org('Palo Santo', ['Palo Santo is a venture capital firm investing in neuroscience companies.'])], { ...brief, investorTypesMode: 'only' });
  assert.equal(out[0].bucket, 'discarded'); assert.match(out[0].discard, /asked only for family offices/);
});

test('ACC-FO-6 operaciones: una ronda sindicada no es la participación del inversor', () => {
  const d = dealsFrom(org('Walden Holdings', ['Walden Holdings led the $30 million Series B of BrainCo in 2024 alongside other investors.']));
  const e = dealsFrom(org('EQT Life Sciences', ['EQT Life Sciences co-leads EUR 51 million Series B in Exciva to advance its Alzheimer’s therapy into clinical Phase 2']));
  assert.equal(e[0].company, 'Exciva'); assert.equal(e[0].amount.kind, 'round_size'); assert.match(e[0].amount.value, /EUR 51 million/);
  assert.equal(d[0].company, 'BrainCo'); assert.equal(d[0].amount.kind, 'round_size'); assert.equal(d[0].year, 2024);
  const a = assessInvestor(org('X Family Office', ['X Family Office is a family office investing in biotech.']), investorPrefs(brief), { topicHits: 1 });
  assert.ok(a.gaps.some((g) => /listed companies/.test(g)));
});

test('ACC-FO-7 chat: país de la empresa ≠ geografía de inversores; «globally» reemplaza; exclusiones y monto desconocido se conservan', async () => {
  const s = newIntake({}); const env = { INTAKE_CONTEXT_V2: '1' };
  await runTurn(s, { text: "I'd like to find family offices that could invest in IGC Pharma.", env });
  await runTurn(s, { text: "IGC Pharma is a US-based, publicly listed clinical-stage biotechnology company focused on Alzheimer's disease. Our lead candidate, IGC-AD1, is in Phase 2.", env });
  assert.equal(s.fields.geography, undefined, 'US-based does not set the investor geography');
  assert.equal(s.fields['company.country'].value, 'United States');
  assert.equal(s.fields['company.listing'].value, 'public');
  assert.equal(s.fields['funding.round'].value, 'public', 'listed company is not forced into seed/Series');
  assert.equal(s.pending, 'investor.types_mode', 'preference vs only is asked once');
  await runTurn(s, { text: 'Please search globally. We prefer family offices. Exclude advisers without direct investments and unrelated VC funds. The target amount and ticket size are not set yet.', env });
  assert.deepEqual(s.fields.geography.value, ['GLOBAL']);
  assert.equal(s.fields['investor.types_mode'].value, 'prefer');
  assert.ok(s.skipped.includes('funding.amount_usd'));
  const r = readiness(s);
  assert.equal(r.canStart, true); assert.equal(r.complete, false);
  const last = s.messages.at(-1).text;
  assert.match(last, /still unknown: target amount/); assert.match(last, /Excluding: advisers without direct investments; venture funds unrelated/);
  assert.doesNotMatch(last, /\d+ ?%|complete/);
  await runTurn(s, { text: 'thanks', env });
  assert.match(s.messages.at(-1).text, /doesn't change the search/);
  const t = await runTurn(s, { text: 'start', env });
  assert.equal(t.run, true);
});

test('ACC-FO-8 chat: «start» sin lo esencial no arranca y lo dice', async () => {
  const s = newIntake({}); s.summaryShownAt = 'x';
  const t = await runTurn(s, { text: 'go ahead', env: {} });
  assert.equal(t.run, false); assert.match(s.messages.at(-1).text, /can't start yet/);
  assert.equal(summaryLine(s).includes('Before searching I still need'), true);
});

test('ACC-FO-9 plan de outreach: hechos con fuente, sin ruta verificada es directo, sin invenciones del modelo', async () => {
  const [w] = evaluate([org('Walden Holdings', ['Walden Holdings is a single family office that makes direct investments in neuroscience companies; it led the $30 million PIPE of BrainCo in 2024 with warrants.'])], brief);
  const job = { brief: { ...brief, oneLiner: 'Alzheimer biotech' }, leads: [w] };
  const p = rulePlan(w, job);
  assert.ok(p.channel.some((x) => /cold approach|directly/.test(x.text)));
  assert.ok(p.angle.some((x) => /past use, not that they would offer/.test(x.text)));
  assert.ok(p.supportingDeals.every((x) => x.basis === 'fact' && x.source));
  assert.match(p.draft.note, /Nothing is sent/);
  const fake = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ objective: [{ text: 'They are interested in Alzheimer deals.', basis: 'fact', source: null }, { text: 'Open a conversation.', basis: 'proposal' }], angle: [{ text: 'Led a PIPE in BrainCo, showing interest in this area.', basis: 'fact', source: 'F1' }], who: [{ text: 'Ana', basis: 'fact', source: 'F999' }], draft: { subject: 'Hi', body: 'As we discussed, you will invest.' } }) } }] }) });
  const m = await outreachPlan(w, job, { env: { INTAKE_LLM_BASE_URL: 'http://127.0.0.1:9/v1' }, fetchImpl: fake });
  assert.equal(m.objective.length, 1, 'invented interest removed'); assert.equal(m.who[0].basis, 'inference', 'fact without a real source is downgraded');
  assert.equal(m.draft.body, p.draft.body, 'invented draft replaced by the rule draft');
  assert.equal(m.angle[0].basis, 'inference', 'interpretation is not a fact');
  assert.ok(m.conditions.some((x) => /Discard/.test(x.text)) && m.questions.length >= 3);
  const down = await outreachPlan(w, job, { env: { INTAKE_LLM_BASE_URL: 'http://127.0.0.1:9/v1' }, fetchImpl: async () => ({ ok: false, status: 402 }) });
  assert.match(down.note, /AI model unavailable \(The model returned 402/);
});

test('ACC-FO-10 seguimiento y similares: un borrador no es contacto; los similares se verifican en una corrida nueva', () => {
  const item = validateTracking({ owner: 'Gisel', status: 'to_contact', nextAction: 'Send email', nextDate: '2026-11-03', activities: [{ kind: 'proposed', text: 'Draft prepared' }] }, 'k');
  assert.equal(item.lastInteraction, null);
  const done = validateTracking({ activities: [...item.activities, { kind: 'done', text: 'Call', date: '2026-11-05' }] }, 'k', item);
  assert.equal(done.lastInteraction, '2026-11-05'); assert.equal(done.owner, 'Gisel');
  assert.throws(() => validateTracking({ activities: [{ kind: 'sent' }] }, 'k'), /proposed, scheduled or done/);
  const [w] = evaluate([org('Walden Holdings', ['Walden Holdings is a single family office that makes direct investments in neuroscience companies.'])], brief);
  const sim = similarBrief({ brief }, [w]);
  assert.equal(sim.brief.investorTypes, 'family_office'); assert.match(sim.brief.similarTo, /Walden Holdings/); assert.match(sim.brief.exclusions, /Walden Holdings/);
});
