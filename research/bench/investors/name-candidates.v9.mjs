// V9: candidatos por conocimiento del modelo ("como Claude o Gemini"). Un modelo recibe el brief y propone hasta N fondos con
// nombre y dominio oficial. Son PISTAS: cada uno entra solo si su sitio oficial pasa el extractor con cita literal (regla sin cambios).
// Proveedores: fleet (el LLM propio del motor, gpt-oss), anthropic (ANTHROPIC_API_KEY, con búsqueda web si la API la acepta) y
// gemini (GEMINI_API_KEY, con Google Search). Resultado en caché: las réplicas reciben la misma lista. Sin nombres de firma en el código.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fleetTransport } from '../../agent/llm.mjs';
import { parseJsonContent } from '../../server/analysis/fleet.mjs';
import { loadInvestorPrompt } from './prompts.mjs';
import { flattenProfile } from './list-discovery.v8.mjs';

const sha = s => createHash('sha256').update(String(s)).digest('hex');
export const DEFAULT_MODELS = { anthropic: ['claude-sonnet-5-5', 'claude-opus-5-5'], gemini: ['gemini-3.1-pro-preview', 'gemini-3-flash-preview', 'gemini-2.5-pro'], fleet: [null] };
export const keyFor = (provider, env) => provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : provider === 'gemini' ? 'GEMINI_API_KEY' : 'ENGINE_LLM_URL';
export const availableProviders = (env = process.env) => ['fleet', 'anthropic', 'gemini'].filter(p => String(env[keyFor(p)] ?? '').trim().length >= 8);
const BRIEF_FIELDS = ['sector', 'subsectors', 'product', 'description', 'business_model', 'funding_stage', 'capital_sought_usd', 'round_type', 'incorporation_country', 'operating_regions', 'target_markets', 'accepted_investor_types', 'excluded_investor_types', 'comparable_companies', 'lead_or_follow', 'impact_focus'];
/** Brief del caso sin el nombre de la empresa (marcas "(SYN)" fuera). */
export function briefFor(profile) {
  const f = flattenProfile(profile), name = String(f.name ?? '').replace(/\s*\(SYN\)\s*/g, '').trim();
  const strip = v => typeof v === 'string' ? (name ? v.split(name).join('the company') : v).replace(/\(SYN\)/g, '').trim() : Array.isArray(v) ? v.map(strip) : v;
  return Object.fromEntries(Object.keys(f).filter(k => BRIEF_FIELDS.includes(k) && f[k] != null && !(Array.isArray(f[k]) && !f[k].length)).map(k => [k, strip(f[k])]));
}
const DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/;
export function normalizeFirms(raw, max) {
  const out = [], seen = new Set();
  for (const x of (Array.isArray(raw?.firms) ? raw.firms : [])) {
    const name = String(x?.name ?? '').replace(/\s+/g, ' ').trim(); if (!name || name.length > 80) continue;
    const k = name.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim(); if (!k || seen.has(k)) continue; seen.add(k);
    let d = x?.domain == null ? null : String(x.domain).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[/?#].*$/, '');
    if (d && !DOMAIN.test(d)) d = null;
    out.push({ name, domain: d, reason: String(x?.reason ?? '').slice(0, 300) });
    if (out.length >= max) break;
  }
  return out;
}
const SCHEMA = { type: 'object', properties: { firms: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, domain: { type: ['string', 'null'] }, reason: { type: 'string' } }, required: ['name', 'domain', 'reason'] } } }, required: ['firms'] };
async function callFleet({ env, system, user }) {
  const tx = fleetTransport(env, 'engine');
  const r = await tx({ body: { messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: 0, seed: 0, max_tokens: 8000, response_format: { type: 'json_schema', json_schema: { name: 'candidate_firms', schema: SCHEMA } } }, meta: { benchmark: 'investors' } });
  return { json: parseJsonContent(r.content), model: r.model ?? env.ENGINE_LLM_MODEL ?? 'fleet', web: false, tokens: Number(r.usage?.prompt_tokens ?? 0) + Number(r.usage?.completion_tokens ?? 0) };
}
async function callAnthropic({ env, system, user, model, web, fetcher }) {
  const go = async withWeb => {
    const body = { model, max_tokens: 8000, temperature: 0, system, messages: [{ role: 'user', content: user }], ...(withWeb ? { tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 6 }] } : {}) };
    const r = await fetcher('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': env.ANTHROPIC_API_KEY.trim(), 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(240000) });
    const t = await r.text(); if (!r.ok) throw Object.assign(new Error(`Anthropic HTTP ${r.status}: ${t.slice(0, 200)}`), { status: r.status });
    const d = JSON.parse(t), text = (d.content ?? []).filter(b => b.type === 'text').map(b => b.text).join('\n');
    return { json: parseJsonContent(text.slice(text.indexOf('{"firms"') >= 0 ? text.lastIndexOf('{"firms"') : 0)), model: d.model ?? model, web: withWeb, tokens: (d.usage?.input_tokens ?? 0) + (d.usage?.output_tokens ?? 0) };
  };
  if (!web) return go(false);
  try { return await go(true); } catch (e) { if (e.status === 400) return go(false); throw e; }
}
async function callGemini({ env, system, user, model, web, fetcher }) {
  const go = async withWeb => {
    const body = { systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: user }] }], generationConfig: { temperature: 0, ...(withWeb ? {} : { responseMimeType: 'application/json' }) }, ...(withWeb ? { tools: [{ google_search: {} }] } : {}) };
    const r = await fetcher(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { method: 'POST', headers: { 'x-goog-api-key': env.GEMINI_API_KEY.trim(), 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(240000) });
    const t = await r.text(); if (!r.ok) throw Object.assign(new Error(`Gemini HTTP ${r.status}: ${t.slice(0, 200)}`), { status: r.status });
    const d = JSON.parse(t), text = (d.candidates?.[0]?.content?.parts ?? []).map(p => p.text ?? '').join('\n');
    return { json: parseJsonContent(text.replace(/```json|```/g, '')), model, web: withWeb, tokens: d.usageMetadata?.totalTokenCount ?? 0 };
  };
  if (!web) return go(false);
  try { return await go(true); } catch (e) { if (e.status === 400) return go(false); throw e; }
}
/**
 * Devuelve nameCandidates({profile}) → { firms:[{name,domain,reason}], model, web, tokens, cached }.
 * opts: { provider, env, cache, max = 40, web = true, models, fetcher, manifest = 'manifest.v9.json' }
 */
export function createNameCandidates({ provider = 'fleet', env = process.env, cache = null, max = 40, web = true, models = null, fetcher = fetch, manifest = 'manifest.v9.json', promptVersion = 'v1' } = {}) {
  const prompt = loadInvestorPrompt('candidates', promptVersion, { manifest });
  const list = models ?? (env.CANDIDATES_MODEL ? [env.CANDIDATES_MODEL] : DEFAULT_MODELS[provider]);
  return async function nameCandidates({ profile }) {
    const brief = briefFor(profile), system = prompt.system.replaceAll('{{max}}', String(max)), user = prompt.user.replace('{{brief}}', JSON.stringify(brief, null, 1));
    const key = sha(['candidates', prompt.sha256, provider, list.join(','), web, max, user].join('|'));
    const hit = cache?.get('llm', key); if (hit) return { ...hit.value, cached: true, tokens: 0 };
    let last = null;
    for (const model of list) {
      try {
        const r = provider === 'anthropic' ? await callAnthropic({ env, system, user, model, web, fetcher }) : provider === 'gemini' ? await callGemini({ env, system, user, model, web, fetcher }) : await callFleet({ env, system, user });
        const value = { provider, model: r.model, web: r.web, firms: normalizeFirms(r.json, max) };
        if (!value.firms.length) throw new Error('lista vacía');
        cache?.put('llm', key, value, { tokens: r.tokens });
        return { ...value, cached: false, tokens: r.tokens };
      } catch (e) { last = e; if (e.status && [401, 403].includes(e.status)) break; }
    }
    throw Object.assign(new Error(`candidatos (${provider}): ${String(last?.message ?? last).slice(0, 300)}`), { code: 'CANDIDATES_FAILED' });
  };
}
