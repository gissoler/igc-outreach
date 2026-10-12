// V7 (C2/H5 y C6/H1): caché por capas. Escribe solo en la caché propia de la carpeta de salida v7 y, si no encuentra
// la entrada, la busca en cachés de carpetas anteriores abiertas en SOLO LECTURA (no se modifican). Un acierto en una
// capa de lectura se copia a la caché propia, así la misma página con la misma longitud da siempre la misma extracción
// (clave LLM = prompt + texto + semilla) y una búsqueda ya pagada no se vuelve a pagar (cached=true en el evento).
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { createBenchCache } from '../../agent/cache.mjs';

/** Abre una caché SQLite existente en solo lectura. layers: [{ path, namespace }]. */
export function openReadOnlyCache({ path, namespace }) {
  const db = new DatabaseSync(path, { readOnly: true });
  const stmt = db.prepare('SELECT value_json, meta_json FROM entries WHERE namespace=? AND kind=? AND key=?');
  return {
    path, namespace,
    get(kind, key) { const row = stmt.get(namespace, kind, key); return row ? { value: JSON.parse(row.value_json), meta: JSON.parse(row.meta_json) } : null; },
    all(kind) { return db.prepare('SELECT key, value_json, meta_json FROM entries WHERE namespace=? AND kind=?').all(namespace, kind).map(r => ({ key: r.key, value: JSON.parse(r.value_json), meta: JSON.parse(r.meta_json) })); },
    close() { db.close(); }
  };
}

/**
 * primary: { path, namespace } de la caché propia (lectura y escritura).
 * readLayers: [{ path, namespace }] en orden de prioridad; las que no existen se ignoran.
 * kinds: tipos que se leen de las capas (por defecto search, fetch y llm).
 */
export function createLayeredCache({ primary, readLayers = [], kinds = ['search', 'fetch', 'llm'] }) {
  const own = createBenchCache(primary);
  const layers = readLayers.filter(l => existsSync(l.path)).map(openReadOnlyCache);
  const stats = { own_hits: 0, layer_hits: {}, misses: 0 };
  return {
    layers: layers.map(l => l.path), stats,
    get(kind, key) {
      const hit = own.get(kind, key); if (hit) { stats.own_hits++; return hit; }
      if (kinds.includes(kind)) for (const l of layers) {
        const h = l.get(kind, key);
        if (h) { own.put(kind, key, h.value, h.meta); stats.layer_hits[`${kind}`] = (stats.layer_hits[`${kind}`] ?? 0) + 1; return h; }
      }
      stats.misses++; return null;
    },
    put(kind, key, value, meta = {}) { own.put(kind, key, value, meta); },
    close() { own.close(); for (const l of layers) l.close(); }
  };
}
