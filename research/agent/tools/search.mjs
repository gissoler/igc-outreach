/**
 * Adapta proveedores de búsqueda a una interfaz estable.
 * No descarga resultados ni evalúa relevancia.
 * Contratos: resultados normalizados de búsqueda.
 * No conoce ningún dominio: todo lo específico llega por el DomainPack.
 */
import { createHash } from 'node:crypto';
import { norm } from '../../server/research/core.mjs';
import { PROVIDER_FN } from '../../server/research/searchApis.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const isoDate = value => {
  const match = String(value || '').match(/^(\d{4}-\d{2}-\d{2})(?:[T\s].*)?$/);
  return match ? match[1] : null;
};

/**
 * Crea una búsqueda cacheada con resultados y errores normalizados.
 * Efectos: puede llamar red y escribir en el caché inyectado.
 * @param {object} input Proveedor, entorno, transporte, caché, límites y reloj.
 * @returns {object} Herramienta con método search.
 */
export function createSearchTool({
  provider,
  env = process.env,
  transport,
  cache,
  resultsPerQuery = 10,
  recency = '',
  clock = Date.now,
}) {
  const searchProvider = transport || PROVIDER_FN[provider];
  if (!searchProvider) throw new Error(`Unknown search provider ${provider}`);
  return {
    async search(query) {
      const key = sha(`${provider}|${resultsPerQuery}|${recency}|${norm(query)}`);
      const started = clock();
      const hit = cache?.get('search', key);
      if (hit) {
        return {
          results: hit.value,
          latency: {
            actual_ms: clock() - started,
            nominal_ms: hit.meta.latency_ms,
          },
          error: null,
        };
      }
      try {
        const rows = await searchProvider(query, { env, limit: resultsPerQuery, recency });
        const results = rows.map((row, index) => ({
          rank: row.rank || index + 1,
          url: row.url,
          title: row.title || '',
          snippet: row.snippet ?? row.description ?? '',
          published: isoDate(row.published),
        }));
        const milliseconds = clock() - started;
        cache?.put('search', key, results, { latency_ms: milliseconds });
        return {
          results,
          latency: { actual_ms: milliseconds, nominal_ms: milliseconds },
          error: null,
        };
      } catch (error) {
        const milliseconds = clock() - started;
        return {
          results: [],
          latency: { actual_ms: milliseconds, nominal_ms: milliseconds },
          error: {
            code: /timeout|abort/i.test(error.message) ? 'SEARCH_TIMEOUT' : 'SEARCH_HTTP',
            message: error.message.slice(0, 300),
          },
        };
      }
    },
  };
}
