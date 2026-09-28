// Módulo 3: RAG de la voz del decisor (partner, BD, program officer), preparación de reunión y objeciones.
// Fuentes permitidas: RSS de podcasts (audio transcrito con un modelo de voz a texto propio), newsletters y
// blogs (RSS o Firecrawl), entrevistas en prensa, y posts/artículos públicos de LinkedIn (solo los que un
// buscador ya indexa como públicos, vía linkedinPublicContent en webscrape.mjs — nunca login, cookie ni
// "conexiones"). YouTube: solo metadatos; NO subtítulos ajenos (la API exige permiso de edición del video y
// las políticas prohíben extraer contenido).
// Regla: toda afirmación sobre la persona lleva un fragmento recuperado que la sostiene literal; si no, no se dice.
import { createHash } from 'node:crypto';
import { chatJSON, cosine, embed, fleetConfig, rerank } from './fleet.mjs';
import { bm25Index, rrf } from './lexical.mjs';
import { plainText, quoteInPage } from './deals.mjs';
import { personKey } from './entities.mjs';

const hash = (...p) => createHash('sha256').update(p.join('|')).digest('hex').slice(0, 16);

/** Fragmentos de ~900 caracteres con solapamiento, cortando en oraciones. `segments` (ASR) conserva el minuto. */
export function chunkText(text, { size = 900, overlap = 150, segments = null } = {}) {
  if (segments?.length) {
    const out = []; let cur = [], len = 0;
    for (const s of segments) { cur.push(s); len += s.text.length; if (len >= size) { out.push({ text: cur.map((x) => x.text).join(' ').trim(), position: fmtTime(cur[0].start) }); cur = cur.slice(-1); len = cur[0].text.length; } }
    if (cur.length && len > 40) out.push({ text: cur.map((x) => x.text).join(' ').trim(), position: fmtTime(cur[0].start) });
    return out;
  }
  const sents = plainText(text).split(/(?<=[.!?])\s+/);
  const out = []; let cur = '';
  for (const s of sents) {
    if ((cur + ' ' + s).length > size && cur) { out.push({ text: cur.trim(), position: null }); cur = cur.slice(-overlap); }
    cur += ' ' + s;
  }
  if (cur.trim().length > 40) out.push({ text: cur.trim(), position: null });
  return out;
}
const fmtTime = (sec) => sec == null ? null : `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

/** Parser mínimo de RSS/Atom: título, enlace, fecha, texto y audio. */
export function parseFeed(xml) {
  const tag = (s, t) => (s.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`, 'i'))?.[1] || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
  const items = [...xml.matchAll(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi)].map((m) => m[0]);
  return items.map((it) => ({
    title: plainText(tag(it, 'title').replace(/<[^>]+>/g, ' ')),
    url: tag(it, 'link') || it.match(/<link[^>]*href="([^"]+)"/i)?.[1] || '',
    published: tag(it, 'pubDate') || tag(it, 'published') || tag(it, 'updated') || null,
    text: plainText((tag(it, 'content:encoded') || tag(it, 'content') || tag(it, 'description') || tag(it, 'summary')).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')),
    audio: it.match(/<enclosure[^>]*url="([^"]+)"[^>]*type="audio/i)?.[1] || null,
  }));
}

/** Transcribe audio con el modelo de voz a texto de la flota (vLLM /v1/audio/transcriptions, p. ej. Whisper). */
export async function transcribe(audioUrl, { env = process.env, fetcher = fetch } = {}) {
  const url = String(env.VLLM_ASR_URL || '').replace(/\/+$/, ''), model = env.VLLM_ASR_MODEL;
  if (!url || !model) throw new Error('Missing VLLM_ASR_URL and VLLM_ASR_MODEL: deploy a speech-to-text model in the fleet.');
  const audio = await (await fetcher(audioUrl)).arrayBuffer();
  const form = new FormData();
  form.append('file', new Blob([audio]), 'audio.mp3');
  form.append('model', model);
  form.append('response_format', 'verbose_json');
  const r = await fetcher(`${url}/audio/transcriptions`, { method: 'POST', body: form, headers: env.VLLM_API_KEY ? { Authorization: `Bearer ${env.VLLM_API_KEY}` } : {} });
  if (!r.ok) throw new Error(`Transcription HTTP ${r.status}`);
  const j = await r.json();
  return { text: j.text || '', segments: (j.segments || []).map((s) => ({ start: s.start, text: s.text })) };
}

/**
 * Indexa una fuente de la persona. kind: 'autor' (blog/newsletter escrito por la persona), 'entrevista'
 * (prensa: se guarda, pero la atribución debe verificarse), 'podcast' (sin diarización: "no atribuible" hasta revisar).
 */
export async function indexSource({ person, url, title, published, text, segments = null, kind = 'autor' }, { store, env = process.env, fetcher = fetch } = {}) {
  const pk = personKey(person);
  const chunks = chunkText(text, { segments }).map((c, i) => ({ id: hash(pk, url, i), personKey: pk, person, url, title, published, kind, text: c.text, position: c.position }));
  if (fleetConfig(env).roles.embed.ready && chunks.length) (await embed(chunks.map((c) => c.text), { env, fetcher })).forEach((v, i) => { chunks[i].vector = v; });
  for (const c of chunks) store.saveChunk(c);
  return chunks.length;
}

/** Búsqueda híbrida: BM25 + vectores (RRF) → reranker. Sin flota, solo BM25. */
export async function searchVoice(chunks, query, { k = 6, env = process.env, fetcher = fetch } = {}) {
  if (!chunks.length) return [];
  const lists = [bm25Index(chunks.map((c) => c.text)).search(query)];
  const cfg = fleetConfig(env);
  if (cfg.roles.embed.ready && chunks.every((c) => c.vector)) {
    const [q] = await embed([query], { env, fetcher });
    lists.push(chunks.map((c, i) => ({ index: i, score: cosine(q, c.vector) })).sort((a, b) => b.score - a.score).slice(0, 50));
  }
  let fused = rrf(lists).slice(0, 25);
  if (cfg.roles.rerank.ready && fused.length) {
    const rr = await rerank(query, fused.map((f) => chunks[f.index].text), { env, fetcher });
    fused = rr.map((r) => ({ index: fused[r.index].index, score: r.score }));
  }
  return fused.slice(0, k).map((f) => ({ ...chunks[f.index], score: f.score }));
}

const CLAIMS_SCHEMA = { type: 'object', properties: { claims: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, chunk_id: { type: 'string' }, quote: { type: 'string' } }, required: ['text', 'chunk_id', 'quote'] } } }, required: ['claims'] };
const OBJ_SCHEMA = { type: 'object', properties: { objections: { type: 'array', items: { type: 'object', properties: { objection: { type: 'string' }, chunk_id: { type: 'string' }, quote: { type: 'string' }, answer: { type: 'string' }, facts_used: { type: 'array', items: { type: 'string' } } }, required: ['objection', 'chunk_id', 'quote', 'answer'] } } }, required: ['objections'] };

/** Deja solo lo que cita literal un fragmento recuperado. Devuelve también cuántos se descartaron (fidelidad). */
export function keepSupported(items, chunks) {
  const by = new Map(chunks.map((c) => [c.id, c]));
  const kept = [], dropped = [];
  for (const it of items) { const c = by.get(it.chunk_id); (c && quoteInPage(it.quote, c.text) ? kept : dropped).push(c ? { ...it, url: c.url, title: c.title, published: c.published, position: c.position, kind: c.kind } : it); }
  return { kept, dropped };
}
const context = (chunks) => chunks.map((c) => `[${c.id}] (${c.kind}; ${c.title || c.url}; ${c.published || 's/f'}${c.position ? `; min ${c.position}` : ''})\n${c.text}`).join('\n\n');

export const BRIEF_QUESTIONS = [
  { key: 'busca', label: 'What they say they look for', query: 'what we look for in founders companies invest thesis criteria' },
  { key: 'preocupa', label: 'What worries them', query: 'concerns risks red flags pass why we did not invest' },
  { key: 'decide', label: 'How they decide', query: 'how we decide diligence process partnership meeting conviction' },
  { key: 'comparte', label: 'Topics they share and their audience', query: 'topics content posts audience readers followers writes about shares publishes' },
];

/**
 * Brief de reunión de una página. Sin flota: modo extractivo (solo fragmentos citados, sin redacción).
 * profileFacts: [{text, source}] hechos verificados del perfil del founder para responder objeciones.
 * similarDeals: explicación de la tesis revelada (revealed.explanation) del fondo de la persona.
 */
export async function meetingBrief({ person, chunks, profileText = '', profileFacts = [], similarDeals = [] }, { env = process.env, fetcher = fetch } = {}) {
  const cfg = fleetConfig(env);
  const sections = [];
  let generated = 0, supported = 0;
  for (const q of BRIEF_QUESTIONS) {
    const hits = await searchVoice(chunks, `${q.query} ${profileText}`.slice(0, 600), { env, fetcher });
    if (!hits.length) { sections.push({ ...q, claims: [], note: 'No evidence retrieved.' }); continue; }
    if (!cfg.roles.chat.ready) { sections.push({ ...q, mode: 'extractivo', claims: hits.slice(0, 3).map((c) => ({ text: c.text.slice(0, 280), quote: c.text.slice(0, 280), chunk_id: c.id, url: c.url, title: c.title, position: c.position, kind: c.kind })) }); continue; }
    const { json } = await chatJSON({ system: `Summarize what ${person} has said publicly. Each claim has the fragment id and a LITERAL quote from it. If the fragments don't answer the question, return {"claims": []}. Don't use outside knowledge. Write in English.`, user: `Question: ${q.label}

Fragments:
${context(hits)}`, schema: CLAIMS_SCHEMA, name: 'claims' }, { env, fetcher });
    const { kept, dropped } = keepSupported(json.claims || [], hits);
    generated += kept.length + dropped.length; supported += kept.length;
    sections.push({ ...q, mode: 'generado', claims: kept, droppedUnsupported: dropped.length });
  }
  let objections = [];
  const objHits = await searchVoice(chunks, `objection concern worry risk pass ${profileText}`.slice(0, 600), { k: 8, env, fetcher });
  if (cfg.roles.chat.ready && objHits.length) {
    const { json } = await chatJSON({ system: `Identify up to 3 likely objections ${person} would raise with this startup, ONLY if a fragment supports it (LITERAL quote). For each, write how to answer using ONLY the given profile facts (list facts_used). If there's no evidence, return fewer objections. Write in English.`, user: `Startup profile: ${profileText}

Verified profile facts:
${profileFacts.map((f, i) => `(${i + 1}) ${f.text} [${f.source}]`).join('\n') || '(none)'}

Fragments:
${context(objHits)}`, schema: OBJ_SCHEMA, name: 'objeciones' }, { env, fetcher });
    const { kept, dropped } = keepSupported(json.objections || [], objHits);
    generated += kept.length + dropped.length; supported += kept.length;
    const factSet = new Set(profileFacts.map((f) => f.text));
    objections = kept.slice(0, 3).map((o) => ({ ...o, facts_used: (o.facts_used || []).filter((f) => factSet.has(f)), answerGrounded: (o.facts_used || []).some((f) => factSet.has(f)) }));
  }
  return { person, sections, similarDeals, objections, objectionsNote: objections.length < 3 ? `Only ${objections.length} objection(s) backed by what ${person} has said. Not padded with guesses.` : null, fidelity: generated ? { generated, supported, share: supported / generated } : null, sources: [...new Set(chunks.map((c) => c.url))].length };
}

/** Simulador de objeciones: el modelo hace de la persona, solo con lo recuperado, citando cada objeción. */
export async function simulateTurn({ person, chunks, history = [], message }, { env = process.env, fetcher = fetch } = {}) {
  const hits = await searchVoice(chunks, message, { env, fetcher });
  const none = { reply: `I have no evidence that ${person} said anything about this in the indexed sources.`, citations: [], evidence: false };
  if (!hits.length) return none;
  if (!fleetConfig(env).roles.chat.ready) return { reply: `(No model configured) The closest thing ${person} has said:`, citations: hits.slice(0, 2).map((c) => ({ chunk_id: c.id, quote: c.text.slice(0, 280), url: c.url, position: c.position })), evidence: true };
  const schema = { type: 'object', properties: { reply: { type: 'string' }, citations: { type: 'array', items: { type: 'object', properties: { chunk_id: { type: 'string' }, quote: { type: 'string' } }, required: ['chunk_id', 'quote'] } } }, required: ['reply', 'citations'] };
  const { json } = await chatJSON({ system: `You simulate ${person} in a meeting with a founder, using ONLY what ${person} said in the fragments. Every objection or question cites a fragment (id + LITERAL quote). If the fragments don't cover the topic, say: "I have no evidence that ${person} has an opinion on this". Don't invent opinions. Reply in English.`, user: `Previous conversation:
${history.slice(-6).map((h) => `${h.role}: ${h.text}`).join('\n')}\n\nFounder: ${message}

Fragments:
${context(hits)}`, schema, name: 'turno' }, { env, fetcher });
  const { kept } = keepSupported(json.citations || [], hits);
  return kept.length ? { reply: json.reply, citations: kept, evidence: true } : none;
}
