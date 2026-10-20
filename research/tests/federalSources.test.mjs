/* Run IGC/MINT-AD del 5-oct-2026: el motor no encontró el SBIR parental del NIA (PA-27-100: el título no nombra la enfermedad; fechas 5-ene y 5-abr-2027,
   NIA participa, empresas con fines de lucro de EE. UU. elegibles) ni convocatorias estatales del RHTP. El catálogo de portales no tenía entradas
   federales de EE. UU. Estas pruebas fijan qué briefs activan cada punto de partida y que los demás no. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { portalsFor, portalSeeds, loadPortals, loadRhtpStateSources } from '../server/research/grantSources.mjs';
import { expandTerms, vehicleTerms, lexiconTerms } from '../server/research/expand.mjs';

const igc = { company: 'IGC Pharma', industry: "Alzheimer's, cognitive screening, digital health", product: 'MINT-AD AI platform for cognitive risk screening',
  description: 'Rural brain-health program PRISM in Maryland; U.S. for-profit biotech', geography: 'U.S.-based; Maryland program', entityType: 'for_profit' };
const names = (b) => portalsFor(b).map((p) => p.name);

test('IGC (EE. UU., con fines de lucro, salud rural): SBIR parental, CMS RHT y RHIhub', () => {
  const n = names(igc);
  assert.ok(n.some((x) => /PA-27-100/.test(x)), 'SBIR parental');
  assert.ok(n.some((x) => /CMS Rural Health Transformation/.test(x)));
  assert.ok(n.some((x) => /Rural Health Information Hub/.test(x)));
});

test('el SBIR parental solo aplica a empresas con fines de lucro de EE. UU. con tema de salud', () => {
  assert.ok(!names({ ...igc, entityType: 'nonprofit' }).some((x) => /PA-27-100/.test(x)), 'ONG de EE. UU.');
  assert.ok(!names({ industry: 'fintech payments', product: 'B2B payments API', description: 'seed startup', geography: 'United States', entityType: 'for_profit' }).some((x) => /PA-27-100/.test(x)), 'fintech');
  assert.deepEqual(names({ industry: 'rural health telehealth', description: 'Colombian nonprofit', country: 'Colombia', entityType: 'nonprofit' }).filter((x) => /PA-27-100|CMS|Rural Health Information/.test(x)), [], 'Colombia');
});

test('sin país explícito, "U.S.-based" en la geografía basta; sin ninguna pista de país no se activa nada federal', () => {
  assert.ok(names({ ...igc, country: '' }).some((x) => /PA-27-100/.test(x)));
  assert.deepEqual(names({ ...igc, geography: '', domicile: '' }), []);
});

test('las entradas federales apuntan a páginas oficiales y el catálogo conserva las anteriores', () => {
  const all = loadPortals();
  const fed = all.filter((p) => p.country === 'United States' && p.scope === 'country');
  assert.equal(fed.length, 3);
  for (const p of fed) assert.match(p.url, /^https:\/\/(files\.simpler\.grants\.gov|www\.cms\.gov|www\.ruralhealthinfo\.org)\//);
  assert.ok(all.filter((p) => p.scope === 'state').length >= 20);
});

test('el catálogo RHTP conecta una fuente por cada estado con procedencia verificable', () => {
  const stateSources = loadRhtpStateSources();
  assert.equal(stateSources.length, 50);
  assert.equal(new Set(stateSources.map((p) => p.state)).size, 50);
  assert.equal(new Set(stateSources.flatMap((p) => p.stateCodes)).size, 50);
  for (const source of stateSources) {
    assert.match(source.url, /^https:\/\//);
    assert.equal(source.program, 'RHTP');
    assert.equal(source.source.sheet, 'RFPs Status');
    assert.match(source.source.sha256, /^[a-f0-9]{64}$/);
  }
});

test('RHTP nacional ofrece los 50 estados; con estado limita la fuente estatal', () => {
  const national = portalsFor({ country: 'US', searchTerms: 'RHTP' });
  assert.equal(national.filter((p) => p.program === 'RHTP').length, 50);
  assert.deepEqual(national.filter((p) => p.program === 'RHTP').slice(0, 3).map((p) => p.state), ['Alaska', 'Virginia', 'Mississippi']);

  const maryland = portalsFor({ country: 'US', state: 'MD', searchTerms: 'Rural Health Transformation Program' });
  assert.deepEqual(maryland.filter((p) => p.program === 'RHTP').map((p) => p.state), ['Maryland']);
  assert.equal(portalSeeds({ country: 'US', state: 'MD', searchTerms: 'RHTP' }).find((p) => /Maryland Rural/.test(p.title)).seed, 'rhtp-state-sources/1');
});

test('un brief rural genérico no activa automáticamente las 50 fuentes RHTP', () => {
  const generic = portalsFor({ country: 'US', industry: 'rural health', product: 'telehealth' });
  assert.equal(generic.filter((p) => p.program === 'RHTP').length, 0);
});

test('consultas: RHTP y SBIR entran justo después de las palabras del usuario, antes que el modelo', async () => {
  assert.deepEqual(vehicleTerms(igc), ['Rural Health Transformation Program', 'SBIR STTR small business innovation research']);
  const modelFetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '{"terms":["alpha one","beta two","gamma three"]}' } }] }) });
  const out = await expandTerms(igc, { INTAKE_LLM_BASE_URL: 'http://m/v1', QUERY_EXPAND_MAX: '4' }, modelFetch);
  const terms = out.map((t) => t.term);
  assert.ok(terms.includes('Rural Health Transformation Program'), terms.join(' | '));
  assert.ok(terms.includes('SBIR STTR small business innovation research'), terms.join(' | '));
  assert.ok(lexiconTerms({ industry: 'wellness', product: 'app', description: 'tell us about a startup' }).every((t) => !/SBIR/.test(t)), 'el pronombre "us" no activa EE. UU.');
  assert.ok(vehicleTerms({ industry: 'biotech', product: 'x', description: 'Spanish for-profit biotech startup' }).every((t) => !/SBIR/.test(t)), 'sin EE. UU. no hay SBIR');
});

test('consultas: los programas escritos por el usuario tienen prioridad sobre sectores genéricos', async () => {
  const terms = await expandTerms({ ...igc, searchTerms: 'Rural Health Transformation Program; dementia risk reduction' }, { QUERY_EXPAND_MAX: '4' });
  assert.deepEqual(terms.slice(0, 2).map((x) => x.term), ['Rural Health Transformation Program', 'dementia risk reduction']);
  assert.deepEqual(terms.slice(0, 2).map((x) => x.source), ['yours', 'yours']);
});
