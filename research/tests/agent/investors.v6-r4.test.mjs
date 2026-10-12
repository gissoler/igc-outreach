// R4: prueba simulada de la pregunta al usuario antes de enriquecer la intención (módulo apagado y no conectado al benchmark).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createIntentClarifier, parseAnswer, INTENT_CLARIFY_DEFAULTS } from '../../bench/investors/intent-clarify.mjs';

const profile = { profile_id: 'p', provenance: {}, fields: { product: { value: 'App que reduce emisiones de carbono' }, description: { value: 'Mide y reduce emisiones de flotas.' }, sector: { value: 'Climate' } } };
const options = [{ product: 'App que reduce contaminación', description: 'También reduce contaminación local, no solo CO2.' },
  { product: 'App para ganar bonos de carbono', description: 'Monetiza la reducción como bonos de carbono.' }];
const propose = async () => options;

test('R4 apagado por defecto: no pregunta aunque haya poco', async () => {
  assert.equal(INTENT_CLARIFY_DEFAULTS.enabled, false);
  let asked = 0; const c = createIntentClarifier({ ask: async () => { asked++; return 'a'; }, propose });
  assert.equal((await c.atRound3Start({ profile, acceptedCount: 0 })).action, 'continue'); assert.equal(asked, 0);
});

test('R4 simulado: con poco tras 2 rondas pregunta una vez; el usuario falso elige «b» y se reanuda con el perfil enriquecido', async () => {
  const qs = [], logs = []; const c = createIntentClarifier({ enabled: true, ask: async q => { qs.push(q); return 'b'; }, propose, log: r => logs.push(r) });
  const r = await c.atRound3Start({ profile, acceptedCount: 2 });
  assert.equal(r.action, 'resume'); assert.equal(qs.length, 1); assert.match(qs[0], /Encontré 2 firmas tras 2 rondas/); assert.match(qs[0], /\(b\) App para ganar bonos de carbono/);
  assert.equal(r.profile.fields.product.value, 'App para ganar bonos de carbono');
  assert.match(r.profile.fields.description.value, /^Mide y reduce emisiones de flotas\. Monetiza/);
  assert.equal(r.profile.fields.sector.value, 'Climate'); assert.equal(profile.fields.product.value, 'App que reduce emisiones de carbono');
  assert.deepEqual(logs[0].chosen, [1]);
  assert.equal((await c.atRound3Start({ profile, acceptedCount: 0 })).action, 'continue');   // solo una vez por corrida
});

test('R4 simulado: «no» o sin respuesta → para y dice «encontré poco»; con 3 o más firmas no pregunta', async () => {
  const no = await createIntentClarifier({ enabled: true, ask: async () => 'no', propose }).atRound3Start({ profile, acceptedCount: 1 });
  assert.equal(no.action, 'stop'); assert.equal(no.stop_reason, 'sparse_user_declined'); assert.match(no.message, /Encontré poco: 1/);
  const mute = await createIntentClarifier({ enabled: true, timeoutMs: 20, ask: () => new Promise(() => {}), propose }).atRound3Start({ profile, acceptedCount: 0 });
  assert.equal(mute.action, 'stop');
  let asked = 0; const many = await createIntentClarifier({ enabled: true, ask: async () => { asked++; return 'a'; }, propose }).atRound3Start({ profile, acceptedCount: 3 });
  assert.equal(many.action, 'continue'); assert.equal(asked, 0);
  assert.deepEqual(parseAnswer('ambas', 2), [0, 1]); assert.deepEqual(parseAnswer('a', 2), [0]); assert.deepEqual(parseAnswer('', 2), []);
});
