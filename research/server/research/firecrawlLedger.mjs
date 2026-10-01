/* ─────────────────────────────────────────────────────────────────────────────
   Gasto de Firecrawl: caché persistente por URL y presupuesto de créditos (por corrida y por día).
   · Caché: la respuesta CRUDA de Firecrawl (markdown / json del extractor / filas de búsqueda) por
     URL normalizada + tipo de llamada + versión (esquema y prompt del extractor, opciones). TTL:
     FIRECRAWL_CACHE_TTL_HOURS (72 h por defecto; 0 la apaga). Un acierto cuesta 0 créditos.
     La caché NO guarda decisiones: el motor vuelve a pasar lo cacheado por extractedFacts/verifyFinding
     con la fecha de hoy, igual que una respuesta nueva.
   · Presupuesto: FIRECRAWL_DAILY_CREDITS por día UTC (sin definir → DEFAULT_DAILY_CREDITS = 100, ≈ 3 000/mes;
     "unlimited" lo quita). Opcional FIRECRAWL_RUN_CREDITS por corrida. Antes de cada llamada se RESERVA el coste
     estimado de forma síncrona (llamadas concurrentes no pueden pasarse del tope) y al terminar se liquida con
     el coste que informa Firecrawl (creditsUsed) o el estimado. Lo gastado del día vive en SQLite (lo comparten
     el servidor y los scripts); las reservas en curso viven en memoria del proceso.
   · Coste por llamada (estimado, se usa para reservar): scrape 1, extracción JSON 5, búsqueda 2 por cada 10
     resultados + 1 por página si trae markdown.
   · Almacenamiento: FIRECRAWL_CACHE_DB o, por defecto, firecrawl-cache.sqlite junto a RESEARCH_DB
     (data/research.sqlite). Bajo `node --test` sin FIRECRAWL_CACHE_DB no hay caché ni tope salvo que la prueba
     inyecte un ledger (createFirecrawlLedger), para que las pruebas no compartan estado en disco.
   ───────────────────────────────────────────────────────────────────────────── */
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export const DEFAULT_DAILY_CREDITS = 100;
export const DEFAULT_CACHE_TTL_HOURS = 72;
export const CREDIT_COST = {
  scrape: () => 1,
  extract: () => 5,
  search: ({ limit = 5, markdown = false } = {}) => 2 * Math.ceil(Math.max(1, limit) / 10) + (markdown ? Math.max(1, limit) : 0),
};

const TRACKING = /^(utm_[a-z]+|gclid|fbclid|mc_cid|mc_eid|ref|ref_src|_hsenc|_hsmi)$/i;
/** URL canónica para la clave de caché: host en minúsculas, sin www, sin fragmento, sin parámetros de rastreo, sin barra final. */
export function normalizeUrl(url) {
  try {
    const u = new URL(String(url).trim());
    u.hash = ''; u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
    if ((u.protocol === 'https:' && u.port === '443') || (u.protocol === 'http:' && u.port === '80')) u.port = '';
    const params = [...u.searchParams.entries()].filter(([k]) => !TRACKING.test(k)).sort(([a], [b]) => a.localeCompare(b));
    u.search = params.length ? `?${new URLSearchParams(params)}` : '';
    u.pathname = u.pathname.replace(/\/+$/, '') || '/';
    return u.toString().replace(/^http:\/\//, 'https://');
  } catch { return String(url || '').trim(); }
}
export const versionOf = (...parts) => createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 16);
export const cacheKey = (kind, id, version = '') => `${kind}|${version}|${kind === 'search' ? id : normalizeUrl(id)}`;

/** Tope diario de créditos a partir del env. Devuelve Infinity solo si se pide explícitamente ("unlimited"). */
export function dailyCap(env = {}) {
  const raw = String(env.FIRECRAWL_DAILY_CREDITS ?? '').trim().toLowerCase();
  if (!raw) return DEFAULT_DAILY_CREDITS;
  if (/^(unlimited|off|none|sin-tope)$/.test(raw)) return Infinity;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_DAILY_CREDITS;
}
export function cacheTtlMs(env = {}) {
  if (String(env.FIRECRAWL_CACHE || '').toLowerCase() === 'off') return 0;
  const raw = env.FIRECRAWL_CACHE_TTL_HOURS;
  const h = raw === undefined || raw === '' ? DEFAULT_CACHE_TTL_HOURS : Number(raw);
  return Number.isFinite(h) && h > 0 ? h * 3_600_000 : 0;
}
export function runCap(env = {}) { const n = Number(env.FIRECRAWL_RUN_CREDITS); return String(env.FIRECRAWL_RUN_CREDITS ?? '').trim() !== '' && Number.isFinite(n) && n >= 0 ? n : Infinity; }

/** Contador de una corrida (se pasa como `meter` a las funciones de Firecrawl y termina en el audit). */
export function createRunMeter(env = {}) {
  return { credits: 0, possiblyCharged: 0, reserved: 0, cap: runCap(env), calls: { scrape: 0, extract: 0, search: 0 }, cacheHits: { scrape: 0, extract: 0, search: 0 }, capSkipped: { scrape: 0, extract: 0, search: 0 }, capReached: false, failed: 0 };
}

/**
 * @param {{ path?: string, env?: object, now?: () => number, cache?: boolean, cap?: number }} o
 *   path ':memory:' para pruebas; `cap` y `cache` pisan lo que diga el env.
 */
export function createFirecrawlLedger({ path = ':memory:', env = {}, now = () => Date.now(), cache, cap } = {}) {
  const ttl = cache === false ? 0 : cacheTtlMs(env);
  const limit = cap ?? dailyCap(env);
  let db = null; let dbError = null;
  const mem = { usage: new Map(), cache: new Map() };   // si SQLite no abre, todo sigue en memoria (nunca rompe la corrida)
  try {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    db = new DatabaseSync(path);
    db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;
      CREATE TABLE IF NOT EXISTS firecrawl_cache (key TEXT PRIMARY KEY, kind TEXT NOT NULL, url TEXT, created_at INTEGER NOT NULL, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS firecrawl_usage (day TEXT PRIMARY KEY, used REAL NOT NULL DEFAULT 0, possible REAL NOT NULL DEFAULT 0, calls INTEGER NOT NULL DEFAULT 0, cache_hits INTEGER NOT NULL DEFAULT 0, cap_hits INTEGER NOT NULL DEFAULT 0);`);
    if (ttl) db.prepare('DELETE FROM firecrawl_cache WHERE created_at < ?').run(now() - Math.max(ttl, 30 * 86_400_000));
  } catch (error) { db = null; dbError = String(error?.message || error).slice(0, 160); }
  let inFlight = 0;   // reservas de este proceso aún sin liquidar
  const day = () => new Date(now()).toISOString().slice(0, 10);
  const row = () => {
    if (!db) return mem.usage.get(day()) || { used: 0, possible: 0, calls: 0, cache_hits: 0, cap_hits: 0 };
    return db.prepare('SELECT used, possible, calls, cache_hits, cap_hits FROM firecrawl_usage WHERE day = ?').get(day()) || { used: 0, possible: 0, calls: 0, cache_hits: 0, cap_hits: 0 };
  };
  const bump = (fields) => {
    const d = day();
    if (!db) { const r = { ...row() }; for (const [k, v] of Object.entries(fields)) r[k] = (r[k] || 0) + v; mem.usage.set(d, r); return; }
    db.prepare('INSERT OR IGNORE INTO firecrawl_usage (day) VALUES (?)').run(d);
    const cols = Object.keys(fields);
    db.prepare(`UPDATE firecrawl_usage SET ${cols.map((c) => `${c} = ${c} + ?`).join(', ')} WHERE day = ?`).run(...cols.map((c) => fields[c]), d);
  };
  return {
    path, ttlMs: ttl, cap: limit, dbError,
    get(kind, key) {
      if (!ttl) return null;
      let hit = null;
      if (db) { const r = db.prepare('SELECT created_at, value FROM firecrawl_cache WHERE key = ?').get(key); if (r) hit = { at: Number(r.created_at), value: r.value }; }
      else hit = mem.cache.get(key) || null;
      if (!hit || now() - hit.at > ttl) return null;
      try { bump({ cache_hits: 1 }); return { value: JSON.parse(hit.value), ageMs: now() - hit.at }; } catch { return null; }
    },
    put(kind, key, value, url = '') {
      if (!ttl) return;
      const text = JSON.stringify(value);
      if (db) db.prepare('INSERT OR REPLACE INTO firecrawl_cache (key, kind, url, created_at, value) VALUES (?, ?, ?, ?, ?)').run(key, kind, url, now(), text);
      else mem.cache.set(key, { at: now(), value: text });
    },
    /** Reserva síncrona: con varias llamadas en vuelo nunca se pasa del tope. `force` (búsqueda principal) cuenta pero no bloquea. */
    reserve(credits, { force = false, meter = null } = {}) {
      const used = Number(row().used) || 0;
      const runOver = meter && meter.credits + meter.reserved + credits > meter.cap;
      if (!force && (used + inFlight + credits > limit || runOver)) { bump({ cap_hits: 1 }); return { ok: false, used, inFlight, cap: limit, run: Boolean(runOver) }; }
      inFlight += credits; if (meter) meter.reserved += credits;
      return { ok: true, credits };
    },
    /** Liquida una reserva: `actual` créditos cobrados (0 si falló), `possible` créditos de intentos fallidos que pudieron cobrarse. */
    settle(reserved, actual, { possible = 0, meter = null } = {}) {
      inFlight = Math.max(0, inFlight - reserved); if (meter) meter.reserved = Math.max(0, meter.reserved - reserved);
      bump({ used: actual + possible, possible, calls: 1 });
    },
    usage() { const r = row(); return { day: day(), used: Number(r.used) || 0, possiblyCharged: Number(r.possible) || 0, calls: Number(r.calls) || 0, cacheHits: Number(r.cache_hits) || 0, capHits: Number(r.cap_hits) || 0, inFlight, cap: Number.isFinite(limit) ? limit : null, capReached: Number.isFinite(limit) && (Number(r.used) || 0) >= limit }; },
    close() { try { db?.close(); } catch { /* nada */ } },
  };
}

/** Ledger que no cachea ni limita (pruebas sin ledger inyectado). Cuenta igual, para que el audit tenga datos. */
export function passthroughLedger() { return createFirecrawlLedger({ path: ':memory:', cache: false, cap: Infinity }); }

const shared = new Map();
/** Ledger por defecto del proceso (uno por ruta de base). */
export function defaultLedger(env = process.env) {
  if (process.env.NODE_TEST_CONTEXT && !env.FIRECRAWL_CACHE_DB) { if (!shared.has('__test')) shared.set('__test', passthroughLedger()); return shared.get('__test'); }
  const path = resolve(env.FIRECRAWL_CACHE_DB || join(dirname(env.RESEARCH_DB || 'data/research.sqlite'), 'firecrawl-cache.sqlite'));
  const k = `${path}|${dailyCap(env)}|${cacheTtlMs(env)}`;
  if (!shared.has(k)) shared.set(k, createFirecrawlLedger({ path, env }));
  return shared.get(k);
}
export function resetDefaultLedgers() { for (const l of shared.values()) l.close(); shared.clear(); }
