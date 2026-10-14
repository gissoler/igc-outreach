// Cliente de la flota vLLM propia (API compatible con OpenAI). Un modelo por puerto.
// Formatos tomados de la documentación oficial de vLLM (docs/models/pooling_models/scoring.md y
// docs/features/structured_outputs.md): /v1/chat/completions con response_format json_schema,
// /v1/embeddings (formato OpenAI) y /v1/rerank (formato Jina/Cohere: results[].index, relevance_score).
// Nada de este módulo se ejecuta sin VLLM_BASE (o las URL por rol): sin flota, quien llama usa su
// método de respaldo y lo declara en la interfaz.

const DEFAULT_PORTS = { chat: 8000, small: 8001, reasoning: 8002, embed: 8003, rerank: 8004 };
const ROLE_ENV = {
  chat: ['VLLM_CHAT_URL', 'VLLM_CHAT_MODEL'],
  small: ['VLLM_SMALL_URL', 'VLLM_SMALL_MODEL'],
  reasoning: ['VLLM_REASONING_URL', 'VLLM_REASONING_MODEL'],
  embed: ['VLLM_EMBED_URL', 'VLLM_EMBED_MODEL'],
  rerank: ['VLLM_RERANK_URL', 'VLLM_RERANK_MODEL'],
};
const trim = (s) => String(s || '').replace(/\/+$/, '');

/** Configuración por rol. Un rol está listo solo si tiene URL y el id real del modelo (de GET /v1/models). */
export function fleetConfig(env = process.env) {
  const base = trim(env.VLLM_BASE);
  const roles = {};
  for (const [role, [urlKey, modelKey]] of Object.entries(ROLE_ENV)) {
    const url = trim(env[urlKey]) || (base ? `${base}:${DEFAULT_PORTS[role]}/v1` : '');
    const model = String(env[modelKey] || '').trim();
    roles[role] = { url, model, ready: Boolean(url && model) };
  }
  // Respaldo: si no hay rol 'chat' configurado pero sí el modelo del prerregistro (INTAKE_LLM_*), se usa ese.
  if (!roles.chat.ready && env.INTAKE_LLM_BASE_URL) roles.chat = { url: trim(env.INTAKE_LLM_BASE_URL), model: String(env.INTAKE_LLM_MODEL || '').trim(), ready: Boolean(env.INTAKE_LLM_MODEL), fallback: 'INTAKE_LLM', ...(env.INTAKE_LLM_API_KEY ? { apiKey: env.INTAKE_LLM_API_KEY } : {}), ...(env.INTAKE_LLM_REASONING_EFFORT ? { reasoningEffort: String(env.INTAKE_LLM_REASONING_EFFORT).trim() } : {}), ...(Number(env.INTAKE_LLM_MAX_TOKENS) ? { maxTokens: Number(env.INTAKE_LLM_MAX_TOKENS) } : {}) };
  // Rol 'engine': el modelo que PLANEA y LEE en el motor v2 (engine.mjs). Puede ser un modelo grande propio
  // (vLLM en g355) o cualquier API compatible con OpenAI. Sin ENGINE_LLM_URL/MODEL usa el rol 'chat' (Qwen3-30B).
  const engineUrl = trim(env.ENGINE_LLM_URL); const engineModel = String(env.ENGINE_LLM_MODEL || '').trim();
  roles.engine = engineUrl && engineModel
    ? { url: engineUrl, model: engineModel, ready: true, apiKey: env.ENGINE_LLM_API_KEY || '', jsonMode: env.ENGINE_LLM_JSON_MODE !== '0', reasoningEffort: String(env.ENGINE_LLM_REASONING_EFFORT || '').trim(), maxTokens: Number(env.ENGINE_LLM_MAX_TOKENS) || 0, thinking: env.ENGINE_LLM_THINKING === '0' ? false : undefined }
    : { ...roles.chat, alias: 'chat' };
  // Roles separados del motor. Sin URL y modelo no están listos ni se sustituyen: el respaldo existe solo si se pide.
  for (const [role, P] of [['compiler', 'COMPILER'], ['judge', 'JUDGE'], ['agent', 'ENGINE_AGENT']]) {
    const url = trim(env[`${P}_LLM_URL`]); const model = String(env[`${P}_LLM_MODEL`] || '').trim();
    const fb = String(env[`${P}_LLM_FALLBACK`] || '').trim().toLowerCase();
    roles[role] = url && model
      ? { url, model, ready: true, apiKey: env[`${P}_LLM_API_KEY`] || '', jsonMode: env[`${P}_LLM_JSON_MODE`] !== '0', schemaLoose: env[`${P}_LLM_SCHEMA_LOOSE`] === '1', reasoningEffort: String(env[`${P}_LLM_REASONING_EFFORT`] || '').trim(), maxTokens: Number(env[`${P}_LLM_MAX_TOKENS`]) || 0, timeoutMs: Number(env[`${P}_LLM_TIMEOUT_MS`]) || 0, thinking: env[`${P}_LLM_THINKING`] === '0' ? false : undefined, fallback: null }
      : ['engine', 'chat'].includes(fb) && roles[fb]?.ready
        ? { ...roles[fb], alias: fb, fallback: fb }
        : { url: '', model: '', ready: false, fallback: null };
  }
  // Modelo usado para extraer deals: 'chat' (qwen-30b), 'small' (qwen-4b) o el id de un adaptador LoRA
  // servido en el puerto de 'small' (vLLM --lora-modules nombre=ruta).
  const extractor = String(env.VLLM_EXTRACT_ROLE || 'chat');
  return { base, roles, extractor, apiKey: env.VLLM_API_KEY || '', timeoutMs: Number(env.VLLM_TIMEOUT_MS) || 120_000 };
}
export const fleetReady = (env, role) => fleetConfig(env).roles[role]?.ready || false;
/** ¿Responde de verdad el modelo de ese rol? (GET /models, rápido). Configurado ≠ alcanzable: el túnel puede estar cerrado. */
export async function roleReachable(env = process.env, role = 'engine', { fetcher = fetch, timeoutMs = 4000 } = {}) {
  const cfg = fleetConfig(env); const target = cfg.roles[role];
  if (!target?.ready) return false;
  try {
    const key = target.apiKey || cfg.apiKey;
    const r = await fetcher(`${target.url}/models`, { headers: key ? { Authorization: `Bearer ${key}` } : {}, signal: AbortSignal.timeout(timeoutMs) });
    return r.ok;
  } catch { return false; }
}

/** Resuelve el rol + modelo para extracción. Un id que no es rol se trata como adaptador LoRA en 'small'. */
export function extractorTarget(cfg) {
  if (cfg.roles[cfg.extractor]) return { role: cfg.extractor, ...cfg.roles[cfg.extractor] };
  return { role: 'small', url: cfg.roles.small.url, model: cfg.extractor, ready: Boolean(cfg.roles.small.url) };
}

async function post(url, body, { apiKey, timeoutMs, fetcher = fetch, signal }) {
  const timeout = AbortSignal.timeout(timeoutMs);
  const response = await fetcher(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
    body: JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  const text = await response.text().catch(() => '');
  if (!response.ok) throw new Error(`vLLM HTTP ${response.status} en ${new URL(url).pathname}${text ? `: ${text.slice(0, 160)}` : ''}`);
  try { return JSON.parse(text); } catch { throw new Error('vLLM returned invalid JSON.'); }
}

export async function postChat(target, body, opts = {}) {
  return post(`${target.url}/chat/completions`, body, {
    apiKey: target.apiKey || opts.apiKey || '', timeoutMs: opts.timeoutMs || 120_000,
    fetcher: opts.fetcher || fetch, signal: opts.signal,
  });
}

/** Primer objeto JSON del texto, sin bloques <think>. */
export function parseJsonContent(content) {
  let text = String(content || '').replace(/<think>[\s\S]*?<\/think>/g, '');
  // Plantillas que abren <think> en el prompt: la salida trae solo el cierre; lo que va antes es razonamiento, no JSON.
  if (text.includes('</think>')) text = text.slice(text.lastIndexOf('</think>') + '</think>'.length);
  text = text.trim();
  try { return JSON.parse(text); } catch { /* sigue */ }
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('The model didn\'t return JSON.');
  return JSON.parse(match[0]);
}

/** Regla de idioma: toda salida en inglés salvo que el prompt pida otro idioma explícitamente. */
export const ENGLISH_RULE = 'LANGUAGE: Write every output string in English, even when the inputs (profiles, documents, notes, quotes) are in Spanish or another language; translate them. Keep proper names verbatim. Only literal quotes that must match a source may stay in their original language.';
export function withLanguageRule(system) {
  const s = String(system || '');
  return /write in spanish|en español|reply in spanish|same language as the draft/i.test(s) ? s : `${s}\n\n${ENGLISH_RULE}`;
}

/** Chat con salida estructurada (response_format json_schema). */
/** Quita las cotas de longitud de cadena (maxLength/minLength; las de arrays se conservan para que el modelo no liste sin fin) del esquema que se envía al servidor: vLLM las expande al compilar la gramática y se cuelga. Los validadores del motor siguen exigiéndolas. */
function looseSchema(node) {
  if (Array.isArray(node)) return node.map(looseSchema);
  if (!node || typeof node !== 'object') return node;
  const out = {};
  for (const [k, v] of Object.entries(node)) if (!['maxLength', 'minLength'].includes(k)) out[k] = looseSchema(v);
  return out;
}

export async function chatJSON({ system, user, messages, schema, name = 'salida', role = 'chat', model, temperature = 0, seed, maxTokens }, { env = process.env, fetcher = fetch, signal } = {}) {
  const cfg = fleetConfig(env);
  const target = model ? { ...cfg.roles[role], model } : cfg.roles[role];
  if (!target?.url || !target.model) throw new Error(`Fleet: role not configured: ${role} (URL and model).`);
  const jsonMode = target.jsonMode !== false;
  const started = Date.now();
  const data = await postChat(target, {
    model: target.model,
    temperature,
    ...(seed === undefined ? {} : { seed }),
    stream: false,
    messages: messages || [{ role: 'system', content: withLanguageRule(system) }, { role: 'user', content: user }],
    ...(!jsonMode ? {} : schema ? { response_format: { type: 'json_schema', json_schema: { name, schema: target.schemaLoose ? looseSchema(schema) : schema } } } : { response_format: { type: 'json_object' } }),
    ...(target.reasoningEffort ? { reasoning_effort: target.reasoningEffort } : {}),
    ...(maxTokens || target.maxTokens ? { max_tokens: maxTokens || target.maxTokens } : {}),
    ...(target.thinking === false ? { chat_template_kwargs: { enable_thinking: false } } : {}),   // ENGINE_LLM_THINKING=0: modelos Qwen con modo razonamiento
  }, { apiKey: target.apiKey || cfg.apiKey, timeoutMs: Number(target.timeoutMs) || (Number(env.ENGINE_LLM_TIMEOUT_MS) && role === 'engine' ? Number(env.ENGINE_LLM_TIMEOUT_MS) : cfg.timeoutMs), fetcher, signal });
  return { json: parseJsonContent(data?.choices?.[0]?.message?.content), model: data?.model || target.model, usage: data?.usage || null, latency_ms: Date.now() - started };
}

/** Embeddings en lotes; devuelve vectores en el orden de entrada. */
export async function embed(texts, { env = process.env, fetcher = fetch, signal, batch = 64 } = {}) {
  const cfg = fleetConfig(env);
  const target = cfg.roles.embed;
  if (!target.ready) throw new Error('Fleet: embeddings not configured (VLLM_EMBED_MODEL).');
  const out = [];
  for (let i = 0; i < texts.length; i += batch) {
    const chunk = texts.slice(i, i + batch).map((t) => String(t).slice(0, 8000));
    const data = await post(`${target.url}/embeddings`, { model: target.model, input: chunk }, { apiKey: cfg.apiKey, timeoutMs: cfg.timeoutMs, fetcher, signal });
    const rows = [...(data?.data || [])].sort((a, b) => a.index - b.index);
    if (rows.length !== chunk.length) throw new Error('vLLM returned a different number of embeddings.');
    out.push(...rows.map((r) => r.embedding));
  }
  return out;
}

/** Rerank (cross-encoder). Devuelve [{index, score}] ordenado por relevancia. */
export async function rerank(query, documents, { env = process.env, fetcher = fetch, signal, topN } = {}) {
  const cfg = fleetConfig(env);
  const target = cfg.roles.rerank;
  if (!target.ready) throw new Error('Fleet: reranker not configured (VLLM_RERANK_MODEL).');
  if (!documents.length) return [];
  const data = await post(`${target.url}/rerank`, { model: target.model, query: String(query).slice(0, 4000), documents: documents.map((d) => String(d).slice(0, 4000)), ...(topN ? { top_n: topN } : {}) }, { apiKey: cfg.apiKey, timeoutMs: cfg.timeoutMs, fetcher, signal });
  return (data?.results || []).map((r) => ({ index: r.index, score: Number(r.relevance_score) })).sort((a, b) => b.score - a.score);
}

/** GET /v1/models de cada rol (para confirmar ids reales antes de ponerlos en .env). */
export async function listModels(env = process.env, { fetcher = fetch } = {}) {
  const cfg = fleetConfig(env);
  const out = {};
  for (const [role, target] of Object.entries(cfg.roles)) {
    if (!target.url) { out[role] = { error: 'no URL' }; continue; }
    try {
      const response = await fetcher(`${target.url}/models`, { headers: cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}, signal: AbortSignal.timeout(10_000) });
      const data = await response.json();
      out[role] = { url: target.url, ids: (data?.data || []).map((m) => m.id) };
    } catch (error) { out[role] = { url: target.url, error: error.message }; }
  }
  return out;
}

export const cosine = (a, b) => {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
};
