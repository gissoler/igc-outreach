/**
 * Adapta fixtures deterministas a las interfaces externas.
 * No realiza red ni altera las respuestas grabadas.
 * Contratos: world-v1 y respuestas LLM de prueba.
 * No conoce ningún dominio: todo lo específico llega por el DomainPack.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { norm } from '../server/research/core.mjs';
import { normalizeUrl } from './docs.mjs';

/**
 * Conserva el contrato público de createFixtureTransport para que sus consumidores compartan una sola implementación.
 * @param {unknown} input Entrada definida por el contrato de la función.
 * @returns {unknown} Resultado definido por el contrato de la función.
 */
export function createFixtureTransport(F, { condition, profileId }) {
  const data = JSON.parse(readFileSync(resolve(F, 'llm.json'), 'utf8'));
  const calls = [];
  let now = 0;
  const transport = async ({ body, meta = {} }) => {
    const promptId = meta.promptId || meta.prompt_id || ({ extraction: 'extractor', planner_output: 'planner',
      judge_output: 'eligibility_judge', preannotator_output: 'preannotator' }[body.response_format?.json_schema?.name]);
    calls.push({ promptId, meta });
    now += 10;
    let resp;
    if (promptId === 'extractor') {
      const world = JSON.parse(readFileSync(resolve(F, 'world.json'), 'utf8'));
      const page = world.pages.find(p => new URL(p.url).href.toLowerCase() === new URL(meta.url).href.toLowerCase());
      resp = data.extractor[normalizeUrl(page?.url || meta.url)] || data.extractor[page?.url] || data.extractor[meta.url];
    } else if (promptId === 'eligibility_judge') resp = data.eligibility_judge[`${profileId}|${meta.stable_id}`]
      || data.eligibility_judge[meta.stable_id];
    else if (promptId === 'planner') resp = data.planner[condition]?.[meta.call_index];
    else if (promptId === 'preannotator') resp = data.preannotator[meta.stable_id];
    if (!resp) throw new Error(`fixture: no response for ${promptId} ${JSON.stringify(meta)}`);
    return { content: JSON.stringify(resp), model: 'fixture-model', usage: { prompt_tokens: 1000, completion_tokens: 100 },
      latency_ms: 10 };
  };
  transport.calls = calls;
  transport.modelKey = 'fixture-model';
  transport.clock = () => now;
  return transport;
}

/**
 * Conserva el contrato público de createFixtureSearch para que sus consumidores compartan una sola implementación.
 * @param {unknown} input Entrada definida por el contrato de la función.
 * @returns {unknown} Resultado definido por el contrato de la función.
 */
export function createFixtureSearch(F) {
  const world = JSON.parse(readFileSync(resolve(F, 'world.json'), 'utf8'));
  const fn = async (query, { limit = 10 } = {}) => {
    const tokens = new Set(norm(query).split(' ').filter(Boolean));
    return world.pages.map((p, i) => ({ p, i, score: [...new Set(p.keywords.map(norm))].filter(k => tokens.has(k)).length }))
      .filter(x => x.score >= 2).sort((a, b) => b.score - a.score || a.i - b.i).slice(0, limit)
      .map((x, i) => ({ rank: i + 1, url: x.p.url, title: x.p.title, description: x.p.snippet, published: null }));
  };
  return fn;
}

/**
 * Conserva el contrato público de createFixtureFetch para que sus consumidores compartan una sola implementación.
 * @param {unknown} input Entrada definida por el contrato de la función.
 * @returns {unknown} Resultado definido por el contrato de la función.
 */
export function createFixtureFetch(F) {
  const world = JSON.parse(readFileSync(resolve(F, 'world.json'), 'utf8'));
  return async url => {
    const p = world.pages.find(x => normalizeUrl(x.url) === normalizeUrl(url));
    if (!p) return null;
    return { ok: true, url: p.url, title: p.title, text: readFileSync(resolve(F, p.file), 'utf8'), via: 'direct', http_status: 200 };
  };
}
