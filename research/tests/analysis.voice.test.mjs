// Módulo 3: fragmentación, RSS, búsqueda híbrida y control de fidelidad (solo lo citado literal sobrevive).
import test from 'node:test';
import assert from 'node:assert/strict';
import { chunkText, parseFeed, searchVoice, keepSupported, meetingBrief, simulateTurn } from '../server/analysis/voice.mjs';

const chunks = [
  { id: 'c1', url: 'https://blog.example.com/a', title: 'Qué buscamos', kind: 'autor', text: 'We look for founders with clinical evidence and a clear path to reimbursement. Retention at 90 days matters to us.' },
  { id: 'c2', url: 'https://blog.example.com/b', title: 'Por qué pasamos', kind: 'autor', text: 'We usually pass when there is no Phase 2 data of good quality in agitation trials.' },
  { id: 'c3', url: 'https://blog.example.com/c', title: 'Other', kind: 'autor', text: 'Our fund likes climate software and carbon accounting.' },
];

test('fragmentos, minutos de ASR y RSS', () => {
  const c = chunkText('Una oración. '.repeat(200));
  assert.ok(c.length > 1 && c.every((x) => x.text.length <= 1100));
  const s = chunkText('', { size: 20, segments: [{ start: 61, text: 'hola mundo largo' }, { start: 75, text: 'segunda parte del texto' }] });
  assert.equal(s[0].position, '1:01');
  const feed = parseFeed('<rss><channel><item><title>Ep 1</title><link>https://pod.example.com/1</link><pubDate>Mon, 01 Sep 2025</pubDate><description><![CDATA[<p>Hablamos de salud</p>]]></description><enclosure url="https://pod.example.com/1.mp3" type="audio/mpeg"/></item></channel></rss>');
  assert.deepEqual([feed[0].title, feed[0].audio, feed[0].text], ['Ep 1', 'https://pod.example.com/1.mp3', 'Hablamos de salud']);
});

test('búsqueda BM25 sin flota', async () => {
  const r = await searchVoice(chunks, 'Phase 2 agitation data', { env: {} });
  assert.equal(r[0].id, 'c2');
});

test('fidelidad: se descarta lo que no cita literal un fragmento', () => {
  const { kept, dropped } = keepSupported([{ text: 'Pide retención', chunk_id: 'c1', quote: 'Retention at 90 days matters to us' }, { text: 'Invento', chunk_id: 'c1', quote: 'We love Alzheimer companies' }, { text: 'x', chunk_id: 'zz', quote: 'y' }], chunks);
  assert.equal(kept.length, 1); assert.equal(dropped.length, 2);
  assert.equal(kept[0].url, 'https://blog.example.com/a');
});

test('brief con flota: objeciones solo con cita y respuesta con hechos del perfil', async () => {
  const env = { VLLM_BASE: 'http://fleet.test', VLLM_CHAT_MODEL: 'qwen-30b' };
  const fetcher = async (url, init) => {
    const body = JSON.parse(init.body);
    const name = body.response_format.json_schema.name;
    const content = name === 'objeciones'
      ? { objections: [{ objection: 'Datos de Fase 2', chunk_id: 'c2', quote: 'no Phase 2 data of good quality', answer: 'CALMA', facts_used: ['Hecho A'] }, { objection: 'Inventada', chunk_id: 'c3', quote: 'We never invest in LatAm', answer: 'x' }] }
      : { claims: [{ text: 'Busca evidencia clínica', chunk_id: 'c1', quote: 'founders with clinical evidence' }] };
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }));
  };
  const b = await meetingBrief({ person: 'Jane Roe', chunks, profileText: 'Alzheimer agitation Phase 2', profileFacts: [{ text: 'Hecho A', source: 'https://igc.example.com' }] }, { env, fetcher });
  assert.equal(b.objections.length, 1);
  assert.equal(b.objections[0].answerGrounded, true);
  assert.match(b.objectionsNote, /Only 1 objection/);
  assert.ok(b.fidelity.share < 1, 'se contó lo descartado');
});

test('simulador: sin evidencia, lo dice', async () => {
  const r = await simulateTurn({ person: 'Jane Roe', chunks, message: 'zzz qqq' }, { env: {} });
  assert.equal(r.evidence, false);
  assert.match(r.reply, /I have no evidence/);
});
