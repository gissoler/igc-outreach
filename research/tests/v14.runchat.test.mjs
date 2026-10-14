/* Tarea C: asistente de la corrida. Usa herramientas sobre el estado de la corrida, recuerda la conversación y nunca deja pasar
   fechas, enlaces o correos que no estén en la corrida. Modelo simulado: sin red. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { askRun, runTools, ungrounded, candidateDetail } from '../server/research/runChat.mjs';
import { closingLine, newIntake } from '../server/research/intake.mjs';

const job = () => ({
  id: 'run1', status: 'done', brief: { company: 'IGC Pharma', product: 'MINT AD', fundingTypes: ['grant'], entityType: 'for_profit', state: 'Maryland', geography: 'US' },
  leads: [
    { id: 'L1', bucket: 'top', fundingType: 'grant', kind: 'opportunity', title: 'PA-27-100 · Omnibus small business', org: 'Agency', status: 'open', deadline: '2027-01-05', daysToDeadline: 83, score: 80, why: ['Open call'],
      registry: { number: 'PA-27-100' }, verification: { tier: 'main', deadlineQuote: 'Application close date: January 5, 2027', eligibility: { quote: 'Only United States small business concerns are eligible.' }, blockers: [] },
      contacts: [{ name: 'Ana Ruiz', role: 'Program Director', organization: 'Agency', linkedin: 'https://linkedin.example/ana', source: 'apollo' }],
      grantPlan: { label: 'Prepare application', nextAction: 'Apply on the portal.', apply: { portal: { name: 'Grants portal' }, steps: [{ label: 'Register the company', days: 14 }, { label: 'Write the research plan', days: 30 }] }, checklist: [{ label: 'Eligibility resolved', done: false }] }, evidence: [], foundBy: [] },
    { id: 'L2', bucket: 'discarded', fundingType: 'grant', kind: 'opportunity', title: 'Old program', org: 'X', discard: 'Closed: the deadline (2025-09-05) has passed.', evidence: [], foundBy: [] },
  ],
  engineDrops: [{ url: 'https://x.example/pas-17-064', title: 'Expired PAS-17-064', reason: 'closed', quote: 'Expiration Date September 6, 2019', deadline: '2019-09-06' }],
});
const scripted = (steps, seen = []) => async (req) => { seen.push(req.messages); const next = steps.shift(); return { json: typeof next === 'function' ? next(req) : next }; };
const ENV = { VLLM_CHAT_URL: 'http://m/v1', VLLM_CHAT_MODEL: 'm' };

test('C asistente: pide una herramienta, responde con lo que devolvió y guarda la conversación en el job', async () => {
  const j = job(); const seen = [];
  const chat = scripted([{ action: 'tool', tool: 'candidate', args: { query: 'PA-27-100' } }, { action: 'answer', answer: 'Closes January 5, 2027 ("Application close date: January 5, 2027"). You still need to resolve eligibility.', cites: ['L1', 'ZZ'], question: null }], seen);
  const r = await askRun(j, '¿Qué me falta para aplicar a PA-27-100?', { env: ENV, chat, now: new Date('2026-10-14T12:00:00Z') });
  assert.match(r.reply, /January 5, 2027/); assert.deepEqual(r.cites, ['L1'], 'solo ids que existen'); assert.equal(r.tools[0].tool, 'candidate');
  assert.match(JSON.stringify(seen[1]), /Register the company/, 'el modelo vio el plan de aplicación real');
  assert.equal(j.chat.length, 2); assert.equal(j.chat[0].role, 'user');
});
test('C asistente: memoria — el turno siguiente lleva el historial', async () => {
  const j = job(); const seen = [];
  await askRun(j, 'Hola', { env: ENV, chat: scripted([{ action: 'answer', answer: 'There is one open call: PA-27-100.', cites: ['L1'] }]) });
  await askRun(j, '¿y el contacto?', { env: ENV, chat: scripted([{ action: 'answer', answer: 'Ana Ruiz, Program Director.', cites: ['L1'] }], seen) });
  assert.match(JSON.stringify(seen[0]), /There is one open call/); assert.equal(j.chat.length, 4);
});
test('C asistente: una fecha o un enlace inventado se rechaza; si el modelo insiste, se quita la frase y se avisa', async () => {
  const j = job();
  const r1 = await askRun(j, 'when?', { env: ENV, chat: scripted([{ action: 'answer', answer: 'It closes March 3, 2027.' }, { action: 'answer', answer: 'The run does not show another date; the close date is January 5, 2027.' }]) });
  assert.doesNotMatch(r1.reply, /March 3/); assert.match(r1.reply, /January 5, 2027/);
  const r2 = await askRun(j, 'link?', { env: ENV, chat: scripted([{ action: 'answer', answer: 'Apply at https://made-up.example/apply. It is open.' }, { action: 'answer', answer: 'Apply at https://made-up.example/apply. It is open.' }]) });
  assert.doesNotMatch(r2.reply, /made-up\.example\/apply\. It/); assert.match(r2.reply, /Removed 1 detail/);
  assert.deepEqual(ungrounded('Write to ana@agency.example on 2027-01-05', 'January 5, 2027'), ['ana@agency.example']);
});
test('C asistente: «por qué descartaste X» usa las razones y citas reales (lista y páginas del juez)', () => {
  const t = runTools(job()); const out = t.ruled_out({ query: 'pas-17' });
  assert.equal(out.judged_pages[0].quote, 'Expiration Date September 6, 2019');
  assert.match(t.ruled_out({ query: 'old' }).in_list[0].reason, /deadline .* has passed/);
  const d = candidateDetail(job().leads[0]); assert.equal(d.contacts[0].linkedin, 'https://linkedin.example/ana'); assert.deepEqual(d.application_plan.steps, ['Register the company (~14 days)', 'Write the research plan (~30 days)']);
});
test('C intake: al final hace UNA pregunta concreta y dice por qué cambia la búsqueda (sin la lista «I still need: …»)', () => {
  const s = newIntake({ user: { name: 'G' } });
  const line = closingLine(s);
  assert.doesNotMatch(line, /still need:/); assert.equal((line.match(/\?/g) || []).length, 1); assert.match(line, /It changes the search|Your plan is complete/);
});
