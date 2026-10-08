/**
 * Uniforma llamadas LLM, caché y metadatos de uso.
 * No compone prompts ni interpreta respuestas de dominio.
 * Contratos: schemas de salida solicitados por cada llamada.
 * No conoce ningún dominio: todo lo específico llega por el DomainPack.
 */
import { createHash } from 'node:crypto';
import { bundle, validate } from './contracts.mjs';
import { ContractError, LlmError } from './errors.mjs';
import { fleetConfig, parseJsonContent, postChat } from '../server/analysis/fleet.mjs';

const hash = value => createHash('sha256').update(String(value)).digest('hex');
const retryText = 'Your previous reply was not valid JSON for the schema. Reply only with valid JSON.';

function expectedModelGuard(expectedModelId) {
  return actual => {
    if (expectedModelId == null || actual === expectedModelId) return;
    const message = `expected_model_id mismatch: ${expectedModelId} vs ${actual}`;
    throw new ContractError('run_config', [{ message }]);
  };
}

function cachedCall(hit, started, clock, assertExpectedModel) {
  assertExpectedModel(hit.value.modelId);
  return {
    json: hit.value.json,
    modelId: hit.value.modelId,
    tokens: {
      ...hit.meta.tokens_breakdown,
      total: 0,
      nominal_total: hit.meta.tokens,
      cached: true,
    },
    latency: {
      actual_ms: Math.max(0, clock() - started),
      nominal_ms: hit.meta.latency_ms,
    },
  };
}

/**
 * Adapta la flota configurada a la interfaz mínima del núcleo.
 * Efectos: realiza una petición HTTP mediante postChat.
 * @param {object} env Variables de entorno de la flota.
 * @param {string} role Rol configurado que atenderá la llamada.
 * @returns {Function} Transporte asíncrono para createLlm.
 */
export function fleetTransport(env, role) {
  const config = fleetConfig(env);
  const target = config.roles[role];
  return async ({ body }) => {
    if (!target?.ready) {
      throw Object.assign(new Error(`Fleet role ${role} is not configured`), { code: 'LLM_HTTP' });
    }
    const started = Date.now();
    const data = await postChat(
      target,
      { model: target.model, stream: false, ...body },
      { apiKey: target.apiKey || config.apiKey, timeoutMs: config.timeoutMs },
    );
    return {
      content: data?.choices?.[0]?.message?.content || '',
      model: data?.model || target.model,
      usage: data?.usage || null,
      latency_ms: Date.now() - started,
    };
  };
}

async function requestModel(tx, body, meta) {
  try {
    return await tx({ body, meta });
  } catch (error) {
    const timeout = error?.name === 'AbortError' || error?.name === 'TimeoutError';
    throw new LlmError(timeout ? 'LLM_TIMEOUT' : 'LLM_HTTP', error.message);
  }
}

function usageFor(response, req) {
  const usage = response.usage;
  return {
    prompt: Number(usage?.prompt_tokens ?? Math.ceil((req.system.length + req.user.length) / 4)),
    completion: Number(usage?.completion_tokens ?? Math.ceil(String(response.content).length / 4)),
    estimated: !usage,
  };
}

function modelBody(req, messages, schema) {
  return {
    messages,
    temperature: req.temperature,
    seed: req.seed,
    max_tokens: req.maxTokens,
    response_format: {
      type: 'json_schema',
      json_schema: { name: req.schemaName, schema },
    },
  };
}

async function callFresh({ req, tx, cache, key, clock, started, assertExpectedModel }) {
  const schema = bundle(req.schemaName);
  let messages = [{ role: 'system', content: req.system }, { role: 'user', content: req.user }];
  let prompt = 0;
  let completion = 0;
  let estimated = false;
  let nominalLatency = 0;
  let lastKind = 'LLM_BAD_JSON';
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await requestModel(tx, modelBody(req, messages, schema), req.meta);
    assertExpectedModel(response.model);
    nominalLatency += Number(response.latency_ms ?? Math.max(0, clock() - started));
    const usage = usageFor(response, req);
    prompt += usage.prompt;
    completion += usage.completion;
    estimated ||= usage.estimated;
    try {
      const parsed = parseJsonContent(response.content);
      try {
        validate(req.schemaName, parsed);
      } catch {
        lastKind = 'LLM_SCHEMA';
        throw new Error('schema');
      }
      const total = prompt + completion;
      const tokens = { prompt, completion, total, nominal_total: total, estimated, cached: false };
      const latency = { actual_ms: Math.max(0, clock() - started), nominal_ms: nominalLatency };
      cache?.put('llm', key, { json: parsed, modelId: response.model }, {
        tokens: total,
        tokens_breakdown: { prompt, completion, estimated },
        latency_ms: nominalLatency,
      });
      return { json: parsed, modelId: response.model, tokens, latency };
    } catch {
      if (lastKind !== 'LLM_SCHEMA') lastKind = 'LLM_BAD_JSON';
      if (attempt === 0) {
        messages = [
          ...messages,
          { role: 'assistant', content: response.content },
          { role: 'user', content: retryText },
        ];
      }
    }
  }
  throw new LlmError(lastKind, `Model failed to return valid ${req.schemaName}`);
}

/**
 * Crea el cliente LLM validado, cacheado y medido del núcleo.
 * Efectos: usa el transporte y el caché inyectados.
 * @param {object} input Configuración, transporte, caché y reloj.
 * @returns {object} Cliente con familia y método call.
 */
export function createLlm({
  env = process.env,
  role = 'engine',
  transport,
  cache,
  family,
  expectedModelId,
  clock = Date.now,
}) {
  const tx = transport || fleetTransport(env, role);
  const modelKey = transport?.modelKey || fleetConfig(env).roles[role]?.model || 'fixture-model';
  const assertExpectedModel = expectedModelGuard(expectedModelId);
  return {
    family,
    async call(req) {
      const key = hash([
        req.promptRef.id,
        req.promptRef.sha256,
        modelKey,
        hash(req.system),
        hash(req.user),
        req.temperature,
        req.seed,
      ].join('|'));
      const started = clock();
      const hit = cache?.get('llm', key);
      if (hit) return cachedCall(hit, started, clock, assertExpectedModel);
      return callFresh({ req, tx, cache, key, clock, started, assertExpectedModel });
    },
  };
}
