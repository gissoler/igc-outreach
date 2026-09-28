// CLI del Módulo 3 (desde tu Mac, con red y flota).
//   node --env-file-if-exists=.env scripts/voice.mjs ingest-rss --person "Nombre" --feed https://…/feed [--kind autor|podcast|entrevista] [--max 20]
//   node --env-file-if-exists=.env scripts/voice.mjs ingest-url --person "Nombre" --url https://… [--kind entrevista]
//   node --env-file-if-exists=.env scripts/voice.mjs ingest-linkedin --person "Nombre" [--org "Fondo"]   → posts/artículos públicos de LinkedIn (requiere FIRECRAWL_API_KEY; nunca login/cookie)
//   node --env-file-if-exists=.env scripts/voice.mjs brief --person "Nombre" --profile "texto del perfil"
//   node --env-file-if-exists=.env scripts/voice.mjs eval --person "Nombre" --n 50   → fidelidad con juez (qwen-30b) + muestra para revisión manual
// Podcasts: requieren VLLM_ASR_URL y VLLM_ASR_MODEL (modelo de voz a texto desplegado en la flota).
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createStore } from '../server/research/store.mjs';
import { indexSource, meetingBrief, parseFeed, simulateTurn, transcribe } from '../server/analysis/voice.mjs';
import { linkedinPublicContent } from '../server/research/webscrape.mjs';
import { personKey } from '../server/analysis/entities.mjs';
import { chatJSON } from '../server/analysis/fleet.mjs';
import { toCsv } from '../server/analysis/extractEval.mjs';

const args = process.argv.slice(2);
const opt = (n, f = null) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : f; };
const store = createStore(resolve(process.env.RESEARCH_DB || 'data/research.sqlite')).analysis;
const person = opt('person');
const html = (h) => h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<nav[\s\S]*?<\/nav>|<footer[\s\S]*?<\/footer>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#?\w+;/g, ' ');

if (args[0] === 'ingest-rss') {
  const items = parseFeed(await (await fetch(opt('feed'))).text()).slice(0, Number(opt('max', 20)));
  for (const it of items) {
    let text = it.text, segments = null;
    if (opt('kind') === 'podcast' && it.audio) { try { ({ text, segments } = await transcribe(it.audio)); } catch (e) { console.log('ASR:', e.message); continue; } }
    const n = await indexSource({ person, url: it.url, title: it.title, published: it.published, text, segments, kind: opt('kind', 'autor') === 'podcast' ? 'podcast (sin diarización: verificar quién habla)' : opt('kind', 'autor') }, { store });
    console.log(n, 'fragmentos ·', it.title);
  }
} else if (args[0] === 'ingest-linkedin') {
  const { posts, errors } = await linkedinPublicContent(person, { org: opt('org', '') });
  if (!posts.length) console.log('Sin publicaciones públicas indexadas para', person, errors.length ? `(${errors.join('; ')})` : '(no se encontraron páginas linkedin.com/posts o /pulse en la búsqueda pública).');
  for (const p of posts) {
    const n = await indexSource({ person, url: p.url, title: p.title, published: p.published, text: p.text, kind: 'linkedin_post' }, { store });
    console.log(n, 'fragmentos · post de LinkedIn ·', p.url);
  }
} else if (args[0] === 'ingest-url') {
  const text = html(await (await fetch(opt('url'), { headers: { 'User-Agent': 'Mozilla/5.0 (IGC Outreach research)' } })).text());
  console.log(await indexSource({ person, url: opt('url'), title: opt('title', opt('url')), published: opt('date'), text, kind: opt('kind', 'entrevista') }, { store }), 'fragmentos');
} else if (args[0] === 'brief') {
  const b = await meetingBrief({ person, chunks: store.chunks(personKey(person)), profileText: opt('profile', '') });
  console.log(JSON.stringify(b, null, 2));
} else if (args[0] === 'eval') {
  // 50 respuestas del simulador sobre preguntas variadas; el juez marca cada respuesta como respaldada o no por sus citas.
  const chunks = store.chunks(personKey(person));
  const qs = ['¿Qué buscas en un founder?', '¿Qué te preocupa de una startup de salud mental?', '¿Invertirías en pre-seed?', '¿Qué métricas pides?', '¿Qué opinas de LatAm?', '¿Qué te haría pasar?', '¿Cómo decides?', '¿Qué opinas de reembolso?', '¿Te importa la evidencia clínica?', '¿Qué tamaño de cheque haces?'];
  const rows = [];
  const n = Number(opt('n', 50));
  for (let i = 0; i < n; i++) {
    const q = qs[i % qs.length] + (i >= qs.length ? ` (variante ${Math.floor(i / qs.length)})` : '');
    const t = await simulateTurn({ person, chunks, message: q });
    let supported = null;
    if (t.evidence && t.citations.length) {
      const { json } = await chatJSON({ system: 'Eres un juez estricto. Respondes {"supported": true|false, "why": string}. supported=true solo si TODO lo que afirma la respuesta está respaldado por las citas.', user: `Respuesta: ${t.reply}\n\nCitas:\n${t.citations.map((c) => c.quote).join('\n---\n')}`, schema: { type: 'object', properties: { supported: { type: 'boolean' }, why: { type: 'string' } }, required: ['supported', 'why'] }, name: 'juez' });
      supported = json.supported;
    }
    rows.push({ pregunta: q, respuesta: t.reply, citas: t.citations.map((c) => `${c.url} :: ${c.quote}`).join(' || '), con_evidencia: t.evidence, juez_respaldada: supported, revision_manual: '' });
    console.log(i + 1, supported, q);
  }
  const judged = rows.filter((r) => r.juez_respaldada !== null);
  const share = judged.length ? judged.filter((r) => r.juez_respaldada).length / judged.length : null;
  mkdirSync(resolve('../backend/eval/results'), { recursive: true });
  writeFileSync(resolve('../backend/eval/results/voice_faithfulness.csv'), toCsv(rows, Object.keys(rows[0])));
  console.log(`Fidelidad (juez): ${share == null ? '—' : (100 * share).toFixed(1)} % en ${judged.length} respuestas con evidencia; ${rows.length - judged.length} sin evidencia (el simulador lo dijo). Umbral: ≥95 %. Revisa a mano la columna revision_manual en backend/eval/results/voice_faithfulness.csv.`);
} else console.log('Uso: ingest-rss | ingest-url | ingest-linkedin | brief | eval');
