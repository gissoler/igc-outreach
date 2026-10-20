/* ─────────────────────────────────────────────────────────────────────────────
   Banco de reproducción offline de la lectura estructurada (assess), P0.1.
   Reconstruye el prompt real de prompts.v14.mjs para páginas ya guardadas por una corrida (pages/*.txt + events.jsonl)
   y mide por variante: latencia, tiempo al primer token, tokens de entrada/salida, tokens/s y validez del JSON frente
   al contrato. No busca en la web: solo llama a los endpoints de modelo que se le pasen.
   ───────────────────────────────────────────────────────────────────────────── */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { postChat, postChatStream, parseJsonContent, withLanguageRule } from '../../analysis/fleet.mjs';
import { AGENT_CRITERIA, assessLitePrompt, assessPrompt, understandFromBrief } from './prompts.v14.mjs';
import { relaxForModel, validateAssess, validateAssessLite } from './contracts.v14.mjs';
import { triageNote, triagePage } from './triage.mjs';
import { clipPage } from './tools.mjs';

/** Variantes: (a) esquema actual, (b) esquema ligero, (c) json_object sin esquema; cada una con y sin max_tokens. */
export const REPLAY_VARIANTS = Object.freeze({
  full: { contract: 'full', format: 'json_schema', maxTokens: 0 }, 'full+mt700': { contract: 'full', format: 'json_schema', maxTokens: 700 },
  lite: { contract: 'lite', format: 'json_schema', maxTokens: 0 }, 'lite+mt700': { contract: 'lite', format: 'json_schema', maxTokens: 700 },
  json: { contract: 'lite', format: 'json_object', maxTokens: 0 }, 'json+mt700': { contract: 'lite', format: 'json_object', maxTokens: 700 },
  // Opcionales (20/10): el prompt de producción solo nombra el contrato; en json_object el modelo nunca ve los campos. `shape` pega el esquema en el prompt.
  // Esquema sin maxLength (el que envía ahora el motor); la validación sigue con el esquema original.
  'lite-relaxed': { contract: 'lite', format: 'json_schema', maxTokens: 0, relax: true }, 'full-relaxed': { contract: 'full', format: 'json_schema', maxTokens: 0, relax: true },
  'lite+mt1500': { contract: 'lite', format: 'json_schema', maxTokens: 1500 },
  'json-shape': { contract: 'lite', format: 'json_object', maxTokens: 0, shape: true }, 'json-shape+mt1500': { contract: 'lite', format: 'json_object', maxTokens: 1500, shape: true },
});
/** Variantes que corre el banco si no se piden otras (las seis originales). */
export const DEFAULT_REPLAY_VARIANTS = Object.freeze(['full', 'full+mt700', 'lite', 'lite+mt700', 'json', 'json+mt700']);
// En V3 la comprensión agotó su tope y el lector recibió este objeto vacío: el esquema actual se reproduce con él.
const V3_EMPTY_UNDERSTOOD = { product_one_line: '', who_pays: '', sector: '', neighbor_sectors: [], stage: '', geography: '', assumptions: [], doubts: [] };

/** Páginas guardadas de las corridas: cada una con su caso, objetivo, brief (perfil de profiles/ si existe), URL y título. */
export function loadReplayCorpus(pipelineDir, { runs = ['runs'], profilesDir = 'profiles' } = {}) {
  const profiles = existsSync(join(pipelineDir, profilesDir)) ? readdirSync(join(pipelineDir, profilesDir)).filter((f) => f.endsWith('.json')) : [];
  const pages = [];
  for (const run of runs) {
    const root = join(pipelineDir, run); if (!existsSync(root)) continue;
    for (const caseId of readdirSync(root).sort()) {
      const eventsPath = join(root, caseId, 'events.jsonl'); if (!existsSync(eventsPath)) continue;
      const events = readFileSync(eventsPath, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
      const start = events.find((e) => e.type === 'run_start'); const profileFile = profiles.find((f) => f.startsWith(`${caseId}-`) || f === `${caseId}.json`);
      const brief = profileFile ? JSON.parse(readFileSync(join(pipelineDir, profilesDir, profileFile), 'utf8')) : start?.brief || {};
      const objective = start?.objective && start.objective !== '-' ? start.objective : (brief.fundingTypes || ['grant'])[0];
      const today = start?.today || null;
      for (const p of events.filter((e) => e.type === 'page' && e.path)) {
        const file = join(root, caseId, p.path); if (!existsSync(file)) continue;
        pages.push({ run, case: caseId, objective, today, brief, profile: profileFile || null, url: p.url, title: p.title || '', sha256: p.sha256 || basename(p.path, '.txt'), ref: p.ref || null, text: readFileSync(file, 'utf8') });
      }
    }
  }
  return pages;
}

/** Muestra determinista y repartida entre casos (round-robin por caso, orden por sha256). */
export function sampleCorpus(pages, n) {
  const byCase = new Map(); for (const p of [...pages].sort((a, b) => a.sha256.localeCompare(b.sha256))) { const k = `${p.run}/${p.case}`; byCase.set(k, [...(byCase.get(k) || []), p]); }
  const seen = new Set(); const out = []; const lists = [...byCase.keys()].sort().map((k) => byCase.get(k));
  for (let i = 0; out.length < n && lists.some((l) => l.length > i); i++) for (const l of lists) { const p = l[i]; if (p && !seen.has(p.sha256) && out.length < n) { seen.add(p.sha256); out.push(p); } }
  return out;
}

/** Prompt y cuerpo de la petición tal como los arma el bucle (mismo system con regla de idioma, mismo recorte de página). */
export function buildReplayRequest(page, variantName, { model, reasoningEffort = '', ref = 'p1' } = {}) {
  const v = REPLAY_VARIANTS[variantName]; if (!v) throw new Error(`unknown variant ${variantName}`);
  const text = clipPage(page.text); const args = { objective: page.objective, brief: page.brief, page: { url: page.url, title: page.title, text }, ref, today: page.today };
  const prompt = v.contract === 'full' ? assessPrompt({ ...args, understood: V3_EMPTY_UNDERSTOOD })
    : assessLitePrompt({ ...args, understood: understandFromBrief(page.brief), triageNote: triageNote(triagePage({ url: page.url, title: page.title, text, today: page.today })) });
  const body = { model, temperature: 0, messages: [{ role: 'system', content: withLanguageRule(prompt.system) }, { role: 'user', content: v.shape ? `${prompt.user}\n\nReply with one JSON object that validates against this JSON Schema (all required keys, no extra keys):\n${JSON.stringify(prompt.schema)}` : prompt.user }],
    response_format: v.format === 'json_schema' ? { type: 'json_schema', json_schema: { name: 'assess', schema: v.relax ? relaxForModel(prompt.schema) : prompt.schema } } : { type: 'json_object' },
    ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}), ...(v.maxTokens ? { max_tokens: v.maxTokens } : {}) };
  return { variant: variantName, ...v, prompt, body, prompt_chars: prompt.system.length + prompt.user.length };
}

export function checkContract(raw, contract, objective) {
  const ids = AGENT_CRITERIA[objective] || AGENT_CRITERIA.grant;
  const r = contract === 'full' ? validateAssess(raw) : validateAssessLite(raw, ids);
  return { ok: r.ok, errors: (r.errors || []).slice(0, 3) };
}

/** Una medición. Nunca inventa: si la llamada falla, queda el error y los números en null. */
export async function measureOnce(endpoint, page, variantName, { fetcher = fetch, timeoutMs = 120_000, stream = true, reasoningEffort = '' } = {}) {
  const req = buildReplayRequest(page, variantName, { model: endpoint.model, reasoningEffort });
  const base = { endpoint: endpoint.name, model: endpoint.model, variant: variantName, contract: req.contract, format: req.format, max_tokens: req.maxTokens || null, case: page.case, run: page.run, sha256: page.sha256, url: page.url, prompt_chars: req.prompt_chars };
  const started = Date.now(); const progress = {};
  try {
    let content; let usage; let finish; let ttft = null; let decodeMs = null; let reasoningChars = 0; let chunks = null;
    if (stream) {
      const r = await postChatStream(endpoint, req.body, { timeoutMs, fetcher, progress, apiKey: endpoint.apiKey });
      content = r.content; usage = r.usage; finish = r.finish_reason; ttft = r.ttft_ms; decodeMs = r.decode_ms; reasoningChars = r.reasoning.length; chunks = r.chunks;
    } else {
      const d = await postChat(endpoint, { ...req.body, stream: false }, { timeoutMs, fetcher, apiKey: endpoint.apiKey });
      content = d?.choices?.[0]?.message?.content || ''; usage = d?.usage; finish = d?.choices?.[0]?.finish_reason || null; reasoningChars = String(d?.choices?.[0]?.message?.reasoning_content || '').length;
    }
    const totalMs = Date.now() - started; const completion = Number(usage?.completion_tokens) || chunks || 0;
    let parsed = null; let jsonOk = false; try { parsed = parseJsonContent(content); jsonOk = true; } catch { /* JSON inválido */ }
    const contract = jsonOk ? checkContract(parsed, req.contract, page.objective) : { ok: false, errors: ['no JSON'] };
    return { ...base, ok: true, total_ms: totalMs, ttft_ms: ttft, decode_ms: decodeMs, prompt_tokens: Number(usage?.prompt_tokens) || null, completion_tokens: completion || null, usage_reported: Boolean(usage?.completion_tokens),
      reasoning_chars: reasoningChars, content_chars: String(content || '').length, finish_reason: finish, json_ok: jsonOk, contract_ok: contract.ok, contract_errors: contract.errors,
      tok_s_e2e: completion && totalMs ? round(completion / (totalMs / 1000)) : null, tok_s_decode: completion && decodeMs ? round(completion / (decodeMs / 1000)) : null };
  } catch (error) {
    return { ...base, ok: false, total_ms: Date.now() - started, error: String(error?.message || error).slice(0, 300), partial_chunks: error?.partial?.chunks ?? progress.chunks ?? null, ttft_ms: error?.partial?.ttft_ms ?? null, json_ok: false, contract_ok: false };
  }
}

const round = (x) => Math.round(x * 10) / 10;
export const quantile = (xs, q) => { const a = xs.filter((x) => Number.isFinite(x)).sort((x, y) => x - y); if (!a.length) return null; const i = (a.length - 1) * q; const lo = Math.floor(i); const hi = Math.ceil(i); return round(a[lo] + (a[hi] - a[lo]) * (i - lo)); };
const mean = (xs) => { const a = xs.filter((x) => Number.isFinite(x)); return a.length ? round(a.reduce((n, x) => n + x, 0) / a.length) : null; };

/** Resumen por (endpoint, variante): n, éxitos, JSON y contrato válidos, latencia p50/p95, tokens/s. */
export function summarizeReplay(calls) {
  const groups = new Map(); for (const c of calls) { const k = `${c.endpoint}\u0000${c.variant}`; groups.set(k, [...(groups.get(k) || []), c]); }
  return [...groups.values()].map((g) => ({ endpoint: g[0].endpoint, model: g[0].model, variant: g[0].variant, n: g.length, ok: g.filter((c) => c.ok).length,
    json_ok: g.filter((c) => c.json_ok).length, contract_ok: g.filter((c) => c.contract_ok).length, truncated: g.filter((c) => c.finish_reason === 'length').length, errors: g.filter((c) => !c.ok).length,
    latency_p50_ms: quantile(g.map((c) => c.total_ms), 0.5), latency_p95_ms: quantile(g.map((c) => c.total_ms), 0.95), ttft_p50_ms: quantile(g.map((c) => c.ttft_ms), 0.5),
    prompt_tokens_mean: mean(g.map((c) => c.prompt_tokens)), completion_tokens_mean: mean(g.map((c) => c.completion_tokens)),
    tok_s_e2e_p50: quantile(g.map((c) => c.tok_s_e2e), 0.5), tok_s_decode_p50: quantile(g.map((c) => c.tok_s_decode), 0.5) }));
}

/** ¿Responde el endpoint y sirve el modelo pedido? Devuelve el id real o lanza un error claro. */
export async function checkEndpoint(endpoint, { fetcher = fetch, timeoutMs = 5000 } = {}) {
  let r; try { r = await fetcher(`${endpoint.url}/models`, { headers: endpoint.apiKey ? { Authorization: `Bearer ${endpoint.apiKey}` } : {}, signal: AbortSignal.timeout(timeoutMs) }); }
  catch (e) { throw new Error(`${endpoint.name}: ${endpoint.url} no responde (${e?.cause?.code || e?.message || e})`); }
  if (!r.ok) throw new Error(`${endpoint.name}: ${endpoint.url}/models devolvió HTTP ${r.status}`);
  const ids = ((await r.json().catch(() => ({})))?.data || []).map((m) => m.id);
  if (endpoint.model && !ids.includes(endpoint.model)) throw new Error(`${endpoint.name}: el modelo ${endpoint.model} no está servido en ${endpoint.url} (sirve: ${ids.join(', ') || 'nada'})`);
  return endpoint.model || ids[0];
}

/** "nombre=url#modelo,nombre=url#modelo" → endpoints. */
export const parseEndpoints = (spec) => String(spec || '').split(',').map((x) => x.trim()).filter(Boolean).map((x) => {
  const [name, rest] = x.includes('=') ? x.split(/=(.*)/s) : [x, x]; const [url, model] = String(rest).split('#');
  return { name: name.trim(), url: url.trim().replace(/\/+$/, ''), model: (model || '').trim() };
});
