import { createHash } from 'node:crypto';
import { bundle, validate } from './contracts.mjs';
import { LlmError } from './errors.mjs';
import { fleetConfig, parseJsonContent, postChat } from '../server/analysis/fleet.mjs';

const hash = s => createHash('sha256').update(String(s)).digest('hex');
const retryText = 'Your previous reply was not valid JSON for the schema. Reply only with valid JSON.';

export function fleetTransport(env, role) {
  const cfg = fleetConfig(env); const target = cfg.roles[role];
  return async ({ body }) => {
    if (!target?.ready) throw Object.assign(new Error(`Fleet role ${role} is not configured`), { code: 'LLM_HTTP' });
    const start = Date.now();
    const data = await postChat(target, { model: target.model, stream: false, ...body }, { apiKey: target.apiKey || cfg.apiKey, timeoutMs: cfg.timeoutMs });
    return { content: data?.choices?.[0]?.message?.content || '', model: data?.model || target.model, usage: data?.usage || null, latency_ms: Date.now() - start };
  };
}

export function createLlm({ env = process.env, role = 'engine', transport, cache, family, clock = Date.now }) {
  const tx = transport || fleetTransport(env, role);
  const modelKey = transport?.modelKey || fleetConfig(env).roles[role]?.model || 'fixture-model';
  return { family, async call(req) {
    const key = hash([req.promptRef.id, req.promptRef.sha256, modelKey, hash(req.system), hash(req.user), req.temperature, req.seed].join('|'));
    const started = clock(); const hit = cache?.get('llm', key);
    if (hit) return { json: hit.value.json, modelId: hit.value.modelId, tokens: { ...hit.meta.tokens_breakdown, total: 0, nominal_total: hit.meta.tokens, cached: true }, latency: { actual_ms: Math.max(0, clock() - started), nominal_ms: hit.meta.latency_ms } };
    const schema = bundle(req.schemaName);
    let messages = [{ role: 'system', content: req.system }, { role: 'user', content: req.user }];
    let tokenPrompt = 0, tokenCompletion = 0, estimated = false, nominalLatency = 0, lastKind = 'LLM_BAD_JSON';
    for (let attempt = 0; attempt < 2; attempt++) {
      const body = { messages, temperature: req.temperature, seed: req.seed, max_tokens: req.maxTokens, response_format: { type: 'json_schema', json_schema: { name: req.schemaName, schema } } };
      let response;
      try { response = await tx({ body, meta: req.meta }); }
      catch (error) { const timeout = error?.name === 'AbortError' || error?.name === 'TimeoutError'; throw new LlmError(timeout ? 'LLM_TIMEOUT' : 'LLM_HTTP', error.message); }
      nominalLatency += Number(response.latency_ms ?? Math.max(0, clock() - started));
      const usage = response.usage;
      tokenPrompt += Number(usage?.prompt_tokens ?? Math.ceil((req.system.length + req.user.length) / 4));
      tokenCompletion += Number(usage?.completion_tokens ?? Math.ceil(String(response.content).length / 4));
      estimated ||= !usage;
      try {
        const parsed = parseJsonContent(response.content);
        try { validate(req.schemaName, parsed); } catch { lastKind = 'LLM_SCHEMA'; throw new Error('schema'); }
        const total = tokenPrompt + tokenCompletion;
        const tokens = { prompt: tokenPrompt, completion: tokenCompletion, total, nominal_total: total, estimated, cached: false };
        const latency = { actual_ms: Math.max(0, clock() - started), nominal_ms: nominalLatency };
        cache?.put('llm', key, { json: parsed, modelId: response.model }, { tokens: total, tokens_breakdown: { prompt: tokenPrompt, completion: tokenCompletion, estimated }, latency_ms: nominalLatency });
        return { json: parsed, modelId: response.model, tokens, latency };
      } catch {
        if (lastKind !== 'LLM_SCHEMA') lastKind = 'LLM_BAD_JSON';
        if (attempt === 0) messages = [...messages, { role: 'assistant', content: response.content }, { role: 'user', content: retryText }];
      }
    }
    throw new LlmError(lastKind, `Model failed to return valid ${req.schemaName}`);
  }};
}
