import test from 'node:test';
import assert from 'node:assert/strict';
import { grantMatch, alnField, topicAnchors } from '../server/research/grantMatch.mjs';
import { evaluate, buildDraft, candidate } from '../server/research/core.mjs';
import { attachGrantPlans } from '../server/research/grantManager.mjs';
import { grantLead } from '../server/research/providers.mjs';

// Brief del caso reportado el 30/09 (Alzheimer + armonización de datos + ciencia abierta).
const alz = {
  company: 'AHA', product: 'Open research network for Alzheimer data harmonization', industry: "Alzheimer's disease, data harmonization",
  description: 'Harmonizes Alzheimer research datasets and connects investigators in an open science network.', criteria: 'open science, research infrastructure',
  stage: 'prototype', geography: 'United States', exclusions: '', fundingTypes: ['grant'], minDays: 30, mode: 'strategic', amount: null,
};
const terms = [{ term: "Alzheimer's disease" }, { term: 'data harmonization' }, { term: 'dementia care' }, { term: 'neurodegenerative disease' }, { term: 'research infrastructure' }, { term: 'open science' }];

// Registro Grants.gov real (344715 · NSF 23-525), reducido a sus campos oficiales.
const nsfHit = { id: '344715', number: '23-525', title: 'Oceanographic Facilities and Equipment Support', agency: 'U.S. National Science Foundation', oppStatus: 'posted', closeDate: '12/31/2099', alnist: ['47.050'] };
const nsfDetail = { cfdas: [{ cfdaNumber: '47.050', programTitle: 'Geosciences' }], synopsis: {
  agencyName: 'U.S. National Science Foundation',
  synopsisDesc: 'The Division of Ocean Sciences supports the operation, upgrade and acquisition of shared-use oceanographic research facilities and equipment: research vessels, marine technical services, shipboard scientific instrumentation, winches, communications and safety. Proposals support research infrastructure that enables open science data collection across the oceanographic community.',
  applicantTypes: [{ description: 'Public and State controlled institutions of higher education' }] } };

// Control positivo: una convocatoria de NIA sobre armonización de datos de Alzheimer.
const niaHit = { id: '999001', number: 'RFA-AG-27-001', title: "Harmonization of Alzheimer's Disease and Related Dementias Research Data", agency: 'National Institutes of Health', oppStatus: 'posted', closeDate: '12/31/2099', alnist: ['93.866'] };
const niaDetail = { cfdas: [{ cfdaNumber: '93.866', programTitle: 'Aging Research' }], synopsis: { synopsisDesc: 'Supports data harmonization infrastructure for Alzheimer and dementia cohorts.' } };

const verifiedGrant = (hit, detail) => { const l = grantLead(hit, detail); l.evidence = l.evidence.map((e) => ({ ...e, verified: true })); return l; };

test('ALN → campo oficial', () => {
  assert.equal(alnField('47.050').label, 'Geosciences');
  assert.equal(alnField('93.866').domain, 'health');
  assert.equal(alnField('12.420').domain, 'health'); // CDMRP es investigación médica, no «defensa»
  assert.equal(alnField('sin número'), null);
});

test('palabras genéricas nunca son anclas temáticas', () => {
  const { anchors } = topicAnchors(alz, terms);
  for (const g of ['research', 'infrastructure', 'open', 'science', 'data']) assert.ok(!anchors.includes(g), g);
  assert.ok(anchors.includes('alzheimer') && anchors.includes('harmonization'));
});

test('NSF 23-525 (oceanografía) es mismatch para un proyecto de Alzheimer', () => {
  const m = grantMatch(grantLead(nsfHit, nsfDetail), alz, terms);
  assert.equal(m.verdict, 'mismatch');
  assert.equal(m.field.code, '47.050');
  assert.match(m.summary, /Off-topic/);
});

test('evaluate descarta NSF 23-525 y no genera propuesta; el control NIA sigue siendo prioridad', () => {
  const [nsf, nia] = [verifiedGrant(nsfHit, nsfDetail), verifiedGrant(niaHit, niaDetail)];
  const ranked = attachGrantPlans(evaluate([nsf, nia], alz, new Set(), new Date('2026-09-30'), terms), alz);
  const n = ranked.find((l) => l.externalId === '23-525');
  const g = ranked.find((l) => l.externalId === 'RFA-AG-27-001');
  assert.equal(n.bucket, 'discarded');
  assert.match(n.discard, /Off-topic/);
  assert.equal(n.fit, 0);
  assert.equal(n.grantPlan.decision, 'no_go');
  const draft = buildDraft(n, alz);
  assert.equal(draft.status, 'rejected');
  assert.match(draft.body, /No application draft/);
  assert.doesNotMatch(draft.body, /\d{1,3},\d{3}|%/); // ninguna cifra inventada
  assert.equal(g.grantMatch.verdict, 'match');
  assert.equal(g.bucket, 'top');
});

test('solo una palabra suelta en el alcance → weak (radar), no prioridad', () => {
  const l = candidate({ kind: 'opportunity', fundingType: 'grant', title: 'Community Resilience Program', status: 'open', deadline: '2099-12-31', externalId: 'X-1',
    evidence: [{ id: 'a', source: 'Grants.gov', url: 'https://www.grants.gov/x', quote: 'Community resilience grants; projects may involve dementia-friendly spaces among many other topics.', field: 'scope', verified: true }],
    searchText: 'Community Resilience Program. Community resilience grants; projects may involve dementia-friendly spaces among many other topics.' });
  const [r] = evaluate([l], alz, new Set(), new Date('2026-09-30'), terms);
  assert.equal(r.grantMatch.verdict, 'weak');
  assert.equal(r.bucket, 'radar');
});

test('campo ajeno aunque el título coincida → weak con aviso del ALN', () => {
  const hit = { ...nsfHit, id: '1', number: 'N-1', title: 'Alzheimer data harmonization for ocean sensor networks', alnist: ['47.050'] };
  const m = grantMatch(grantLead(hit, { synopsis: { synopsisDesc: 'x' } }), alz, terms);
  assert.equal(m.verdict, 'weak');
  assert.match(m.reasons.join(' '), /Geosciences/);
});

test('Mentiva (salud mental digital): NSF oceanografía también es mismatch', () => {
  const mentiva = { company: 'Mentiva', product: 'Platform for digital well-being and navigation toward care experiences', industry: 'wellness mental health digital health', description: "Helps individuals understand what's weighing on them.", stage: 'prototype', geography: 'Global', exclusions: '', fundingTypes: ['grant'], minDays: 30 };
  const m = grantMatch(grantLead(nsfHit, nsfDetail), mentiva, [{ term: 'mental health' }, { term: 'digital mental health' }]);
  assert.equal(m.verdict, 'mismatch');
});

test('gold set: el caso negativo NSF 23-525 cuenta como falso positivo si no se descarta', async () => {
  const { evaluateRun } = await import('../eval/metrics.mjs');
  const gold = JSON.parse((await import('node:fs')).readFileSync(new URL('../eval/gold/negative-nsf-23-525.json', import.meta.url)));
  assert.equal(evaluateRun({ leads: [{ externalId: '23-525', bucket: 'top' }] }, gold).falsePositives, 1);
  const brief = { exclusions: '', minDays: 30, mode: 'strategic', stage: '', geography: '', amount: null, ...gold.brief };
  const ranked = evaluate([verifiedGrant(nsfHit, nsfDetail)], brief, new Set(), new Date('2026-09-30'), []);
  assert.equal(evaluateRun({ leads: ranked }, gold).falsePositives, 0);
});
