/* Preflight de rendimiento de modelos (P0.7): una inferencia real de ~500 tokens con el esquema de lectura
   (agent.assess_lite/1) por endpoint, en streaming. Decide pasa/no pasa contra un umbral de tokens/s. Sin búsquedas ni Apollo. */
import { fleetConfig, postChatStream, parseJsonContent, withLanguageRule } from '../../analysis/fleet.mjs';
import { assessLitePrompt, AGENT_CRITERIA } from './prompts.v14.mjs';
import { relaxForModel, validateAssessLite } from './contracts.v14.mjs';
import { checkEndpoint, parseEndpoints } from './replay.mjs';

export const PREFLIGHT_EXIT = Object.freeze({ ok: 0, down: 2, slow: 3, unmeasurable: 4 });

/** Endpoints a probar: los de `spec` ("nombre=url#modelo,…") o los roles agent, compiler y judge configurados, sin duplicar. */
export function preflightTargets(spec, env = process.env) {
  if (spec) return parseEndpoints(spec);
  const roles = fleetConfig(env).roles; const seen = new Set(); const list = [];
  for (const name of ['agent', 'compiler', 'judge']) { const r = roles[name]; if (!r?.ready) continue; const key = `${r.url}#${r.model}`; if (seen.has(key)) continue; seen.add(key); list.push({ name, url: r.url, model: r.model, apiKey: r.apiKey || '' }); }
  return list;
}

// Página sintética fija (no es un caso real): pide citar plazos y varios criterios, para generar unos cientos de tokens.
export const PREFLIGHT_PAGE = { url: 'https://preflight.example.org/call', title: 'Preflight Research Program 2027 (synthetic)', text: [
  'Preflight Research Program 2027. This synthetic page is used only to measure model throughput.',
  'Letter of intent due date: November 4, 2026. Full application due date: February 9, 2027. Awards announced: June 2027.',
  'Eligibility: accredited research institutions and for-profit companies in any country may apply; the principal investigator must hold a doctoral degree.',
  'Funding: up to USD 500,000 over two years as a grant, with no equity and no repayment.',
  'Scope: computational and AI/ML approaches to neurodegenerative disease biomarkers, imaging and clinical validation.',
  'Stage: early-stage research projects with preliminary data are encouraged. Contact the program office through the official portal to submit.',
].join(' ').repeat(3) };

export function preflightBody(model, { maxTokens = 600, effort = 'low', today = new Date().toISOString().slice(0, 10) } = {}) {
  const prompt = assessLitePrompt({ objective: 'grant', brief: { company: 'Preflight', product: 'Synthetic throughput probe', industry: 'neurodegeneration research' }, page: PREFLIGHT_PAGE, ref: 'p1', today });
  return { model, temperature: 0, messages: [{ role: 'system', content: withLanguageRule(prompt.system) }, { role: 'user', content: prompt.user }],
    response_format: { type: 'json_schema', json_schema: { name: 'assess', schema: relaxForModel(prompt.schema) } }, max_tokens: maxTokens, ...(/gpt-oss/i.test(model) && effort ? { reasoning_effort: effort } : {}) };
}

/** Prueba cada endpoint y devuelve { rows, code }. `metric`: decode (por defecto) o e2e. Nunca inventa una medición. */
export async function runPreflight(targets, { minToks = 80, metric = 'decode', maxTokens = 600, timeoutMs = 90_000, effort = 'low', fetcher = fetch, log = () => {} } = {}) {
  const rows = []; let code = PREFLIGHT_EXIT.ok;
  for (const t of targets) {
    try { t.model = await checkEndpoint(t, { fetcher }); }
    catch (e) { rows.push({ name: t.name, url: t.url, model: t.model, error: e.message }); code = Math.max(code, PREFLIGHT_EXIT.down); log(`✖ ${e.message}`); continue; }
    try {
      const t0 = Date.now(); const r = await postChatStream(t, preflightBody(t.model, { maxTokens, effort }), { timeoutMs, fetcher, apiKey: t.apiKey });
      const total = Date.now() - t0; const completion = Number(r.usage?.completion_tokens) || r.chunks || 0;
      let contractOk = false; try { contractOk = validateAssessLite(parseJsonContent(r.content), AGENT_CRITERIA.grant).ok; } catch { /* JSON inválido */ }
      const decode = completion && r.decode_ms ? Math.round((completion / (r.decode_ms / 1000)) * 10) / 10 : null;
      const e2e = completion && total ? Math.round((completion / (total / 1000)) * 10) / 10 : null;
      const value = metric === 'e2e' ? e2e : decode ?? e2e;
      const row = { name: t.name, url: t.url, model: t.model, prompt_tokens: Number(r.usage?.prompt_tokens) || null, completion_tokens: completion || null, usage_reported: Boolean(r.usage?.completion_tokens),
        ttft_ms: r.ttft_ms, total_ms: total, decode_ms: r.decode_ms, tok_s_decode: decode, tok_s_e2e: e2e, finish_reason: r.finish_reason, contract_ok: contractOk, metric, value, min: minToks, pass: Number.isFinite(value) && value >= minToks };
      rows.push(row);
      if (!Number.isFinite(value)) { code = Math.max(code, PREFLIGHT_EXIT.unmeasurable); log(`✖ ${t.name} (${t.model}): sin tokens medibles (${completion} tokens, finish ${r.finish_reason}).`); }
      else { if (!row.pass) code = Math.max(code, PREFLIGHT_EXIT.slow); log(`${row.pass ? '✔' : '✖'} ${t.name} (${t.model}): ${value} tok/s ${metric} (umbral ${minToks}) · ${completion} tokens de salida, ${row.prompt_tokens ?? '?'} de entrada · TTFT ${r.ttft_ms} ms · total ${total} ms · contrato ${contractOk ? 'ok' : 'no'} · finish ${r.finish_reason}`); }
    } catch (e) { rows.push({ name: t.name, url: t.url, model: t.model, error: e.message, partial: e.partial || null }); code = Math.max(code, PREFLIGHT_EXIT.down); log(`✖ ${t.name}: la inferencia falló (${e.message})`); }
  }
  return { rows, code };
}
