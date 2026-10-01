/* El encaje con lo que el programa financia lo juzga el modelo leyendo la página; el código solo comprueba citas.
   Caso real: NSF CogNeuro (PD-24-1699) salía en radar para un proyecto de datos de Alzheimer aunque su página excluye
   «Understanding clinical populations». */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verifyOpportunity } from '../server/research/verify.mjs';
import { verifyRegistryLeads } from '../server/research/registryVerify.mjs';
import { runObjective } from '../server/research/engine.mjs';
import { grantLead } from '../server/research/providers.mjs';
import { grantGate, matchFromModel, evaluate } from '../server/research/core.mjs';

const brief = JSON.parse(readFileSync(new URL('../eval/briefs/mentiva.json', import.meta.url), 'utf8'));
const TODAY = new Date('2026-10-01T12:00:00Z');
const PAGE = 'https://www.nsf.gov/funding/opportunities/cogneuro-cognitive-neuroscience/pd24-1699';
const TEXT = 'Cognitive Neuroscience (CogNeuro). The program seeks to fund proposals that can advance our understanding of the neural mechanisms underlying human cognition and behavior. Proposals will be returned without review if they focus on understanding clinical populations. Applications close 1 February 2027. Open to for-profit startups and small businesses worldwide. Grant, no equity. How to apply: submit your proposal through Research.gov or Grants.gov.';
const base = { relevant: true, kind: 'program', page_type: 'call', name: 'Cognitive Neuroscience (CogNeuro)', official: true, status: 'open', deadline: null, eligible: 'yes', non_dilutive: 'yes', money: 'grant', quotes: { identity: 'Cognitive Neuroscience (CogNeuro)', eligible: 'Open to for-profit startups and small businesses worldwide' } };
const read = (scope_fit) => verifyOpportunity({ ...base, ...(scope_fit ? { scope_fit } : {}) }, { url: PAGE, title: 'CogNeuro', text: TEXT }, { today: TODAY, brief });
const SF = { verdict: 'does_not_fit', reason: 'The project is clinical data infrastructure; the program funds basic cognition research and excludes clinical populations.', funds_quote: 'advance our understanding of the neural mechanisms underlying human cognition and behavior', excludes_quote: 'returned without review if they focus on understanding clinical populations', work_type: 'basic_research' };

test('encaje: does_not_fit con cita literal de la página descarta con la razón y la frase', () => {
  const v = read(SF);
  assert.equal(v.tier, 'drop'); assert.equal(v.drop, 'scope_mismatch'); assert.equal(v.keep, false);
  assert.equal(v.scopeFit.workType, 'basic_research');
});

test('encaje: sin cita, o con una cita inventada, nunca descarta: queda para verificar con el motivo', () => {
  const noQuote = read({ ...SF, funds_quote: null, excludes_quote: null });
  assert.equal(noQuote.tier, 'verify'); assert.ok(noQuote.blockers.some((b) => /no quote from the page/.test(b))); assert.ok(noQuote.flags.includes('scope_mismatch_without_quote'));
  const fake = read({ ...SF, funds_quote: null, excludes_quote: 'Clinical populations are never funded by this program' });
  assert.equal(fake.tier, 'verify'); assert.ok(fake.flags.includes('fake_quote:excludes'));
});

test('encaje: partial y unclear pasan a verificar; fits conserva la lista principal; sin scope_fit nada cambia', () => {
  assert.equal(read({ ...SF, verdict: 'partial' }).tier, 'verify');
  assert.equal(read({ ...SF, verdict: 'unclear', funds_quote: null, excludes_quote: null }).tier, 'verify');
  assert.equal(read({ verdict: 'fits', reason: 'Funds this kind of work', funds_quote: 'advance our understanding of the neural mechanisms underlying human cognition and behavior', excludes_quote: null, work_type: 'basic_research' }).tier, 'main');
  assert.equal(read(null).scopeFit, null); assert.equal(read(null).tier, 'main');
});

test('caso real de punta a punta: la convocatoria del registro se lee, se descarta por encaje y grantGate muestra la cita', async () => {
  const lead = grantLead({ id: '350561', number: 'PD-24-1699', title: 'Cognitive Neuroscience (CogNeuro)', agency: 'U.S. National Science Foundation', oppStatus: 'posted', closeDate: '02/01/2027' },
    { synopsis: { synopsisDesc: 'The CogNeuro program seeks to fund proposals that advance understanding of neural mechanisms of cognition.', applicantTypes: [{ description: 'Unrestricted' }], fundingDescLinkUrl: PAGE } });
  const chat = async ({ name }) => (name === 'finding' ? { json: { ...base, scope_fit: SF }, model: 'sim' } : { json: { queries: [] } });
  const r = await verifyRegistryLeads([lead], brief, { env: {}, today: TODAY, run: (o, b, opts) => runObjective(o, b, { ...opts, chat, pageFetcher: async (u) => (u === PAGE ? { url: u, title: 'CogNeuro', text: TEXT } : null), reader: async () => null, fallbackReader: null, crawl4aiReader: null }) });
  const out = r.leads[0];
  assert.equal(out.verification.tier, 'drop'); assert.equal(out.verification.scopeFit.verdict, 'does_not_fit');
  const gate = grantGate(out, 120);
  assert.equal(gate.tier, 'drop'); assert.match(gate.reason, /Doesn't fund this kind of project/); assert.match(gate.reason, /returned without review if they focus on understanding clinical populations/);
  assert.equal(out.trace.verify.drop, 'scope_mismatch');
  // y en la evaluación el juicio del modelo sustituye a la regla de palabras
  assert.equal(matchFromModel(out.verification.scopeFit).verdict, 'mismatch');
  const ranked = evaluate([out], brief, new Set(), TODAY, []);
  assert.equal(ranked[0].grantMatch.source, 'model'); assert.notEqual(ranked[0].bucket, 'top');
});

const eligRead = (el, eligible = 'yes') => {
  const text = `Cognitive Neuroscience Prize. Applications close 1 February 2027. ${el}. Grant, no equity. How to apply: submit your proposal through our portal.`;
  return verifyOpportunity({ ...base, eligible, quotes: { identity: 'Cognitive Neuroscience Prize', eligible: el } }, { url: 'https://x.example.org/p', title: 'P', text }, { today: TODAY, brief });
};
test('elegibilidad: el juicio del modelo con cita manda sobre la regla de palabras (la regla es una pista)', () => {
  // La regla no entiende «all types of organizations»: antes quedaba «sin confirmar»; el modelo lo cita y entra.
  const open = eligRead('Open to all types of organizations');
  assert.equal(open.tier, 'main'); assert.ok(open.flags.includes('eligibility_from_model'));
  // La regla leía «including nonprofits and universities» como exclusión y descartaba; ahora el desacuerdo queda para verificar.
  const incl = eligRead('Open to all types of organizations, including nonprofits and universities');
  assert.equal(incl.tier, 'verify'); assert.ok(incl.flags.includes('eligibility_conflict')); assert.notEqual(incl.drop, 'not_eligible');
  // Un «no» del modelo con cita se respeta; un «yes» cuya cita no habla de quién postula no vale.
  assert.equal(eligRead('Open to students only', 'no').drop, 'not_eligible');
  assert.notEqual(eligRead('Applications close 1 February 2027').tier, 'main');
});
