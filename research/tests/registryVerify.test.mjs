/* Las convocatorias de registros (Grants.gov) se leen con el mismo motor antes de decidir; sin red, modelo simulado. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verifyRegistryLeads, registryText, seedFor, isRegistryCall } from '../server/research/registryVerify.mjs';
import { grantLead } from '../server/research/providers.mjs';
import { grantGate } from '../server/research/core.mjs';

const brief = JSON.parse(readFileSync(new URL('../eval/briefs/mentiva.json', import.meta.url), 'utf8'));
const TODAY = new Date('2026-10-01T12:00:00Z');
const hit = (id, number, title, closeDate) => ({ id, number, title, agency: 'Test Agency', oppStatus: 'posted', closeDate });
const detail = (desc, officialUrl) => ({ synopsis: { synopsisDesc: desc, applicantTypes: [{ description: 'Unrestricted' }], fundingDescLinkUrl: officialUrl } });
const OPEN_PAGE = 'https://agency.example.gov/call/open-prize';
const CLOSED_PAGE = 'https://agency.example.gov/call/old-prize';
const PAGES = {
  [OPEN_PAGE]: 'Open Prize for digital mental health. Applications close 15 January 2027. Open to for-profit startups and small businesses worldwide. Grant, no equity. How to apply: submit your application through our online portal.',
  [CLOSED_PAGE]: 'Old Prize for digital mental health. Applications close 15 January 2026. Open to for-profit startups worldwide. Grant, no equity. How to apply: submit your application through our online portal.',
};
const chat = async ({ name, user }) => {
  if (name !== 'finding') return { json: { queries: [] } };
  const text = Object.entries(PAGES).find(([u]) => user.includes(`PAGE URL: ${u}`)) || null;
  const ident = text ? (text[0] === OPEN_PAGE ? 'Open Prize for digital mental health' : 'Old Prize for digital mental health') : 'Registry only call';
  return { json: { relevant: true, kind: 'program', page_type: 'call', name: ident, official: true, status: 'open', deadline: null, eligible: 'yes', non_dilutive: 'yes', money: 'grant', quotes: { identity: ident } }, model: 'sim' };
};
const leads = () => [
  grantLead(hit('1', 'OPEN-26-001', 'Open Prize', '01/15/2027'), detail('Prize for digital mental health.', OPEN_PAGE)),
  grantLead(hit('2', 'OLD-25-002', 'Old Prize', '01/15/2027'), detail('Prize for digital mental health.', CLOSED_PAGE)),
  grantLead(hit('3', 'REG-26-003', 'Registry only call', '03/01/2027'), detail('Registry only call. Applications close 1 March 2027. Open to for-profit startups. How to apply: submit through the portal.', null)),
];
const run = async (extra = {}) => {
  const opened = [];
  const r = await verifyRegistryLeads(leads(), brief, { env: { ENGINE_LLM_URL: 'x' }, today: TODAY, run: (o, b, opts) => import('../server/research/engine.mjs').then((m) => m.runObjective(o, b, { ...opts, chat, search: undefined, pageFetcher: async (u) => { opened.push(u); return PAGES[u] ? { url: u, title: 'Page', text: PAGES[u] } : null; }, reader: async () => null, fallbackReader: null, crawl4aiReader: null })), ...extra });
  return { r, opened };
};

test('el enlace oficial del aviso se guarda y el registro se reconoce como puntero', () => {
  const [open, , regOnly] = leads();
  assert.equal(open.facts.officialUrl, OPEN_PAGE); assert.equal(regOnly.facts.officialUrl, undefined);
  assert.ok(isRegistryCall(open));
  assert.match(registryText(open), /Close date in the registry: 15 January 2027 \(2027-01-15\)/);
  assert.equal(seedFor(open).fixed, false); assert.equal(seedFor(regOnly).fixed, true);
});

test('cada convocatoria se lee: la abierta pasa, la cerrada la descarta el código con la fecha de hoy y la que solo tiene registro se lee del registro', async () => {
  const { r, opened } = await run();
  const by = (n) => r.leads.find((l) => l.title === n);
  assert.equal(by('Open Prize').verification.tier, 'main'); assert.equal(by('Open Prize').deadline, '2027-01-15');
  assert.equal(by('Old Prize').verification.tier, 'drop'); assert.equal(by('Old Prize').verification.drop, 'closed');
  assert.ok(by('Old Prize').trace?.url, 'el descarte conserva su rastro para la Run audit');
  assert.ok(['main', 'verify'].includes(by('Registry only call').verification.tier));
  assert.deepEqual(opened.sort(), [CLOSED_PAGE, OPEN_PAGE].sort(), 'el texto del registro no se vuelve a descargar de grants.gov');
  assert.deepEqual({ checked: r.stats.checked, kept: r.stats.kept, dropped: r.stats.dropped }, { checked: 3, kept: 2, dropped: 1 });
  // grantGate respeta la verificación: la cerrada se descarta con la razón de la página, no con una regla de palabras.
  assert.equal(grantGate(by('Old Prize'), null).tier, 'drop');
  assert.notEqual(grantGate(by('Open Prize'), 100).tier, 'drop');
});

test('apagado o sin lecturas: las convocatorias quedan como estaban', async () => {
  const off = await verifyRegistryLeads(leads(), brief, { env: { REGISTRY_VERIFY: 'off' } });
  assert.equal(off.stats.skipped, 'off'); assert.ok(off.leads.every((l) => !l.verification));
  const engineLike = leads().map((l) => ({ ...l, externalId: `engine:grant:${l.title}` }));
  assert.equal((await verifyRegistryLeads(engineLike, brief, { env: {} })).stats.checked, 0);
});
