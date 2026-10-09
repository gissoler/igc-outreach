/**
 * Adapta proveedores de descarga a una interfaz estable.
 * No extrae hechos ni decide oficialidad.
 * Contratos: respuesta normalizada de descarga.
 * No conoce ningún dominio: todo lo específico llega por el DomainPack.
 */
import { createHash } from 'node:crypto';
import { fetchPage, isPublicUrl } from '../../server/research/localSearch.mjs';
import { crawl4aiRead } from '../../server/research/crawl4ai.mjs';
import { jinaRead } from '../../server/research/searchApis.mjs';
import { normalizeUrl } from '../docs.mjs';

function failure(code, message, latency, extras = {}) {
  return {
    ok: false,
    text: '',
    title: '',
    via: 'none',
    http_status: null,
    latency,
    error: { code, message },
    ...extras,
  };
}

/**
 * Envuelve fetch para registrar, sin cambiar el resultado, qué devolvió cada lector
 * (status HTTP, content-type o error). Solo observabilidad (FIX-13).
 */
function recordingFetcher(attempt) {
  return async (input, init) => {
    try {
      const res = await fetch(input, init);
      attempt.http_status = res.status;
      attempt.content_type = res.headers?.get?.('content-type')?.split(';')[0] || null;
      return res;
    } catch (error) {
      attempt.error = (/timeout|abort/i.test(error?.message || error?.name || '') ? 'TIMEOUT: ' : 'NETWORK: ') + String(error?.message || error).slice(0, 160);
      throw error;
    }
  };
}

async function readWithFallbacks(url, env, transport) {
  const attempts = [];
  const direct = { reader: 'direct', http_status: null, content_type: null, error: null, chars: null };
  attempts.push(direct);
  let result = transport ? await transport(url) : await fetchPage(url, { env, fetcher: recordingFetcher(direct) });
  direct.chars = result?.text?.length ?? null;
  let via = result?.via || 'direct';
  if ((!result || result.text?.length < 400) && !transport) {
    const attempt = { reader: 'crawl4ai', http_status: null, content_type: null, error: null, chars: null };
    attempt.skipped = env.CRAWL4AI_URL ? null : 'CRAWL4AI_URL unset';
    attempts.push(attempt);
    if (env.CRAWL4AI_URL) {
      const got = await crawl4aiRead(url, { env, fetcher: recordingFetcher(attempt) });
      attempt.chars = got?.text?.length ?? null;
      result = got || result;
      if (result) via = 'crawl4ai';
    }
  }
  if ((!result || result.text?.length < 400) && !transport) {
    const attempt = { reader: 'jina', http_status: null, content_type: null, error: null, chars: null };
    attempt.skipped = env.JINA_API_KEY ? null : 'JINA_API_KEY unset';
    attempts.push(attempt);
    const got = await jinaRead(url, { env, fetcher: recordingFetcher(attempt) });
    attempt.chars = got?.text?.length ?? null;
    result = got || result;
    if (result) via = 'jina';
  }
  return { result, via, attempts };
}

/**
 * Crea una descarga cacheada con fallback y errores normalizados.
 * Efectos: puede llamar red y escribir en el caché inyectado.
 * @param {object} input Entorno, transporte opcional, caché y reloj.
 * @returns {object} Herramienta con método fetch.
 */
export function createFetchTool({ env = process.env, transport, cache, clock = Date.now }) {
  return {
    async fetch(url) {
      const started = clock();
      if (!isPublicUrl(url)) {
        return failure('FETCH_BLOCKED', 'URL is not public', { actual_ms: 0, nominal_ms: 0 });
      }
      const key = normalizeUrl(url);
      const hit = cache?.get('fetch', key);
      if (hit) {
        return {
          ...hit.value,
          latency: {
            actual_ms: clock() - started,
            nominal_ms: hit.meta.latency_ms,
          },
          cached: true,
        };
      }
      try {
        const { result, via, attempts } = await readWithFallbacks(url, env, transport);
        const milliseconds = clock() - started;
        const latency = { actual_ms: milliseconds, nominal_ms: milliseconds };
        if (!result || String(result.text || '').length < 200) {
          return {
            ...failure('FETCH_EMPTY', 'Page text shorter than 200 characters', latency),
            text: String(result?.text || ''),
            title: result?.title || '',
            via,
            http_status: result?.http_status || null,
            reader_attempts: attempts,
          };
        }
        const value = {
          ok: true,
          text: result.text,
          title: result.title || '',
          via,
          http_status: result.http_status || 200,
          text_sha256: createHash('sha256').update(result.text).digest('hex'),
          reader_attempts: attempts,
        };
        cache?.put('fetch', key, value, { latency_ms: milliseconds });
        return { ...value, latency, cached: false };
      } catch (error) {
        const milliseconds = clock() - started;
        const code = /timeout|abort/i.test(error.message) ? 'FETCH_TIMEOUT' : 'FETCH_HTTP';
        return failure(code, error.message.slice(0, 300), {
          actual_ms: milliseconds,
          nominal_ms: milliseconds,
        });
      }
    },
  };
}
