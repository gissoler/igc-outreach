import test from 'node:test';
import assert from 'node:assert/strict';
import { validateBrief, evaluate, isIGC, ventureOf } from '../server/research/core.mjs';
import { exaQuery, exaSearch, roundAnnouncements } from '../server/research/providers.mjs';
import { planResearch, newIntake, editField, toProfile } from '../server/research/intake.mjs';

const brief = () => validateBrief({
  name: 'Gisel', role: 'Founder', company: 'IGC Pharma', organization: 'IGC Pharma', venture: 'Mentiva',
  product: 'Mentiva app', description: 'Experiencia móvil para reflexionar sobre estrés', oneLiner: 'Turna el ruido en algo que puedas nombrar',
  industry: 'mental health digital health', stage: 'prototype', round: 'pre-seed', geography: 'CO, LATAM',
  fundingTypes: ['investment', 'sponsorship'], amount: 1500000, criteria: 'Tesis en salud mental', constraints: 'No tabacaleras',
  exclusions: 'Headspace', dataMode: 'live', minDays: 30,
});

test('el brief conserva quién busca, para qué empresa y el perfil completo', () => {
  const b = brief();
  assert.equal(b.organization, 'IGC Pharma');
  assert.equal(ventureOf(b), 'Mentiva');
  assert.equal(b.relation, 'other');
  assert.ok(isIGC(b));
  const q = exaQuery(b, 'investment');
  for (const part of ['pre-seed', 'Mentiva', 'USD 1500000', 'Tesis en salud mental', 'Avoid: No tabacaleras']) assert.ok(q.includes(part), part);
  assert.match(exaQuery(b, 'sponsorship'), /sponsors/);
});

test('Exa: una consulta por objetivo, Bearer en cabecera, sin la propia empresa y con exclusiones', async () => {
  const calls = [];
  const client = { json: async (url, body, headers) => {
    calls.push({ url, body, headers });
    return { results: [
      { url: 'https://fund.example.com/thesis', title: 'Mental health fund', highlights: ['We back pre-seed mental health startups in LATAM.'] },
      { url: 'https://www.mentiva.app/', title: 'Mentiva', highlights: ['Mentiva'] },
      { url: 'https://headspace.com/x', title: 'Headspace', highlights: ['Competitor page'] },
    ] };
  } };
  const leads = await exaSearch(client, brief(), {}, { EXA_API_KEY: 'k' });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, 'https://api.exa.ai/search');
  assert.equal(calls[0].headers.Authorization, 'Bearer k');
  assert.deepEqual(calls[0].body.contents, { highlights: true });
  assert.ok(!leads.some((l) => l.org.includes('mentiva')));
  const ranked = evaluate(leads, brief());
  assert.equal(ranked.find((l) => l.org === 'fund.example.com' && l.fundingType === 'investment').bucket, 'top');
  assert.equal(ranked.find((l) => l.org === 'headspace.com').bucket, 'discarded');
});

test('anuncios de rondas: Exa noticias si hay clave, si no Serper News; error claro sin ninguna', async () => {
  const seen = [];
  const client = { json: async (url, body) => { seen.push({ url, body }); return url.includes('serper') ? { news: [{ link: 'https://news.example.com/a', title: 'X raises seed led by Y', snippet: 'led by Y' }] } : { results: [{ url: 'https://news.example.com/b', title: 'Z raises pre-seed', highlights: ['led by W Ventures'] }] }; } };
  const exa = await roundAnnouncements(client, brief(), {}, { EXA_API_KEY: 'k' });
  assert.equal(seen[0].body.category, 'news');
  assert.equal(exa[0].evidence[0].verified, true);
  const serper = await roundAnnouncements(client, brief(), {}, { SERPER_API_KEY: 's' });
  assert.match(seen[1].url, /serper\.dev\/news/);
  assert.equal(serper[0].evidence[0].verified, false);
  await assert.rejects(() => roundAnnouncements(client, brief(), {}, {}), /EXA_API_KEY or SERPER_API_KEY/);
});

test('prerregistro: organización distinta de la empresa, patrocinio y plan con Exa', () => {
  const s = newIntake({ user: { name: 'Gisel' } });
  editField(s, 'company.name', 'Mentiva');
  editField(s, 'organization.name', 'IGC Pharma');
  editField(s, 'company.relation', 'sponsored');
  editField(s, 'funding.objectives', ['sponsorship', 'investment']);
  const plan = planResearch(s, { EXA_API_KEY: 'k' });
  assert.ok(plan.steps.some((x) => x.source.startsWith('Exa') && x.status === 'activo'));
  assert.ok(plan.steps.some((x) => x.source.startsWith('Funding rounds') && x.status === 'activo'));
  const p = toProfile(s, { founder: {}, project: {} }, { name: 'Gisel', email: 'g@x.co' });
  assert.equal(p.founder.org, 'IGC Pharma');
  assert.equal(p.project.venture, 'Mentiva');
  assert.equal(p.project.relation, 'sponsored');
  const reseeded = newIntake({ user: { name: 'Gisel' }, profile: p });
  assert.equal(reseeded.fields['company.name'].value, 'Mentiva');
  assert.equal(reseeded.fields['organization.name'].value, 'IGC Pharma');
});
