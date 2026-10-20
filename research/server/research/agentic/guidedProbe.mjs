/* ─────────────────────────────────────────────────────────────────────────────
   Sonda de decodificación guiada (20/10). Pregunta: ¿por qué json_schema va a ~10 tok/s y json_object a ~205 tok/s con el
   mismo modelo, prompt y página? Cada sonda cambia UNA cosa respecto a la anterior; ninguna toca el servidor: solo envía
   peticiones normales a /chat/completions (la única que pide algo especial es la sonda de motores, opcional).
   Lectura de resultados (ver scripts/probe-guided.mjs):
     · plain ≈ json_object            → el modelo decodifica rápido; la GPU no es el cuello de botella.
     · ctl_schema_text ≈ ctl_json     → una restricción simple no frena; el coste crece con la complejidad del esquema.
     · ctl_schema_text ≪ ctl_json     → cualquier decodificación guiada frena en este servidor (CPU/motor), sin importar el esquema.
     · L1 → L4 cae de forma escalonada → el coste es del esquema (enums, unions con null, arrays, objetos anidados).
   ───────────────────────────────────────────────────────────────────────────── */
import { AGENT_CRITERIA } from './prompts.v14.mjs';
import { assessLiteSchema } from './contracts.v14.mjs';
import { buildReplayRequest, quantile } from './replay.mjs';
import { postChatStream } from '../../analysis/fleet.mjs';

const pick = (schema, keys) => {
  const present = keys.filter((k) => schema.properties?.[k]);
  return { type: 'object', additionalProperties: false, required: present.filter((k) => (schema.required || []).includes(k)), properties: Object.fromEntries(present.map((k) => [k, schema.properties[k]])) };
};
/** Escalera de esquemas: cada peldaño añade campos del contrato ligero real. */
export function schemaLadder(ids = AGENT_CRITERIA.grant) {
  const full = assessLiteSchema(ids); const { $id, ...lite } = full; void $id;
  return [
    ['schema_L1_ref_candidate', pick(lite, ['ref', 'candidate'])],
    ['schema_L2_plus_about_pagetype', pick(lite, ['ref', 'candidate', 'about', 'page_type'])],
    ['schema_L3_plus_dates', pick(lite, ['ref', 'candidate', 'about', 'page_type', 'dates'])],
    ['schema_L4_lite_completo', lite],
  ];
}
const TEXT_SCHEMA = { type: 'object', additionalProperties: false, required: ['text'], properties: { text: { type: 'string' } } };

/** Lista de sondas para una página. `backends` añade una sonda por motor con el esquema completo (puede ser rechazada: se registra). */
export function probeSet(page, { model, maxTokens = 400, reasoningEffort = '', backends = [] } = {}) {
  const base = buildReplayRequest(page, 'lite', { model }).body; const messages = base.messages;
  const common = { model, temperature: 0, max_tokens: maxTokens, ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}) };
  const control = [{ role: 'system', content: 'Reply only with JSON.' }, { role: 'user', content: `<page>\n${String(page.text || '').slice(0, 3000)}\n</page>\n\nReturn {"text": "..."} where text is a plain-prose summary of this page of about 250 words.` }];
  const probes = [
    { name: 'plain', note: 'sin response_format', body: { ...common, messages } },
    { name: 'json_object', note: 'json_object, mismo prompt', body: { ...common, messages, response_format: { type: 'json_object' } } },
    { name: 'ctl_json_object', note: 'control: resumen libre, json_object', body: { ...common, messages: control, response_format: { type: 'json_object' } } },
    { name: 'ctl_schema_text', note: 'control: el mismo resumen con un esquema de 1 campo string', body: { ...common, messages: control, response_format: { type: 'json_schema', json_schema: { name: 'text', schema: TEXT_SCHEMA } } } },
    ...schemaLadder(AGENT_CRITERIA[page.objective] || AGENT_CRITERIA.grant).map(([name, schema]) => ({ name, note: 'json_schema, mismo prompt', body: { ...common, messages, response_format: { type: 'json_schema', json_schema: { name: 'assess', schema } } } })),
  ];
  const full = probes.find((p) => p.name === 'schema_L4_lite_completo');
  for (const backend of backends) probes.push({ name: `L4@${backend}`, note: `esquema completo pidiendo el motor ${backend} por petición`, body: { ...full.body, guided_decoding_backend: backend } });
  return probes;
}

/** Una medición de una sonda; los fallos se registran con su mensaje (p. ej. el motor pedido no se acepta). */
export async function runProbe(endpoint, probe, { fetcher = fetch, timeoutMs = 120_000 } = {}) {
  const started = Date.now(); const progress = {};
  try {
    const r = await postChatStream(endpoint, probe.body, { timeoutMs, fetcher, progress, apiKey: endpoint.apiKey });
    const tokens = Number(r.usage?.completion_tokens) || r.chunks || 0;
    return { probe: probe.name, ok: true, total_ms: Date.now() - started, ttft_ms: r.ttft_ms, completion_tokens: tokens, finish_reason: r.finish_reason, usage_reported: Boolean(r.usage?.completion_tokens),
      tok_s_decode: tokens && r.decode_ms ? Math.round((tokens / (r.decode_ms / 1000)) * 10) / 10 : null };
  } catch (error) { return { probe: probe.name, ok: false, total_ms: Date.now() - started, error: String(error?.message || error).slice(0, 240) }; }
}

export function summarizeProbes(rows) {
  const groups = new Map(); for (const r of rows) groups.set(r.probe, [...(groups.get(r.probe) || []), r]);
  return [...groups.entries()].map(([probe, g]) => { const ok = g.filter((r) => r.ok); const speeds = ok.map((r) => r.tok_s_decode).filter(Number.isFinite);
    return { probe, n: g.length, ok: ok.length, tokens_mean: ok.length ? Math.round(ok.reduce((n, r) => n + (r.completion_tokens || 0), 0) / ok.length) : null,
      ttft_p50_ms: quantile(ok.map((r) => r.ttft_ms), 0.5), tok_s_p50: quantile(speeds, 0.5), tok_s_min: speeds.length ? Math.min(...speeds) : null, tok_s_max: speeds.length ? Math.max(...speeds) : null,
      error: g.find((r) => !r.ok)?.error || null }; });
}
