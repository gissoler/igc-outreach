/* ─────────────────────────────────────────────────────────────────────────────
   Live Agent Run: eventos estructurados emitidos donde ocurre cada operación real
   (petición HTTP, navegación con Playwright, captura, evaluación…), difundidos por
   SSE y persistidos con el trabajo para poder reproducirlos después.
   Nada aquí infiere estado a partir de textos: cada evento lo crea el código que
   ejecuta la operación.
   ───────────────────────────────────────────────────────────────────────────── */
import { randomBytes } from 'node:crypto';

export const LIVE_PHASES = [
  'planning',
  'source_started',
  'browser_opened',
  'page_loaded',
  'screenshot',
  'api_request',
  'api_response',
  'reading',
  'evaluating',
  'drafting',
  'source_completed',
  'warning',
  'error',
  'completed',
];
const STATUSES = new Set(['pending', 'running', 'success', 'warning', 'error']);
/** Fases que nunca se descartan aunque se alcance el límite de eventos. */
const ESSENTIAL = new Set(['source_started', 'source_completed', 'warning', 'error', 'evaluating', 'drafting', 'completed']);

/* ───────── Sanitización ───────── */
const SENSITIVE_KEY = /(^|[_-])(api[_-]?key|apikey|key|token|access[_-]?token|refresh[_-]?token|auth|authorization|bearer|secret|client[_-]?secret|password|passwd|pwd|session|sessionid|sid|cookie|set-cookie|signature|sig|credential|credentials|mailto|email)$/i;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const HAS_EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const TOKEN_PATTERNS = [
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [hidden]'],
  [/\bapify_api_[A-Za-z0-9]+/g, '[hidden token]'],
  [/\bfc-[A-Za-z0-9]{16,}/g, '[hidden token]'],
  [/\bsgai-[A-Za-z0-9-]{16,}/g, '[hidden token]'],
  [/\bsk-[A-Za-z0-9_-]{12,}/g, '[hidden token]'],
  [/\b(api[_-]?key|apikey|token|access_token|secret|password|key)=([^&\s"']+)/gi, '$1=[hidden]'],
];
export const isSensitiveKey = (key) => SENSITIVE_KEY.test(String(key));

/** Valores de variables de entorno que nunca deben aparecer en eventos, URLs ni muestras. */
export function secretValues(env = {}) {
  return Object.entries(env)
    .filter(([key, value]) => /(KEY|TOKEN|SECRET|PASSWORD|PASS|COOKIE|CREDENTIAL)/i.test(key) && typeof value === 'string' && value.length >= 6)
    .map(([, value]) => value)
    .sort((a, b) => b.length - a.length);
}

export function redactText(value, secrets = []) {
  let text = String(value ?? '');
  for (const secret of secrets) if (secret && text.includes(secret)) text = text.split(secret).join('[secreto oculto]');
  for (const [pattern, replacement] of TOKEN_PATTERNS) text = text.replace(pattern, replacement);
  return text.replace(EMAIL, '[hidden email]');
}

/** URL pública apta para el frontend: sin credenciales, fragmentos, parámetros sensibles ni correos. */
export function sanitizeUrl(value, secrets = []) {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol)) return null;
  url.username = '';
  url.password = '';
  url.hash = '';
  for (const key of new Set(url.searchParams.keys())) {
    const values = url.searchParams.getAll(key);
    if (isSensitiveKey(key) || values.some((v) => HAS_EMAIL.test(v) || secrets.some((s) => s && v.includes(s)))) url.searchParams.delete(key);
  }
  const href = redactText(url.href, secrets);
  return href.length > 400 ? `${href.slice(0, 399)}…` : href;
}

/** Copia acotada y segura de un JSON: sin claves sensibles, correos ni secretos; strings y listas truncadas. */
export function safeSample(data, { secrets = [], maxChars = 1400, maxDepth = 4, maxItems = 2, maxKeys = 14, maxString = 180 } = {}) {
  const walk = (value, depth) => {
    if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      const clean = redactText(value, secrets);
      return clean.length > maxString ? `${clean.slice(0, maxString)}…` : clean;
    }
    if (depth >= maxDepth) return Array.isArray(value) ? `[${value.length} items]` : '{…}';
    if (Array.isArray(value)) {
      const items = value.slice(0, maxItems).map((item) => walk(item, depth + 1));
      if (value.length > maxItems) items.push(`… ${value.length - maxItems} more items`);
      return items;
    }
    if (typeof value === 'object') {
      const out = {};
      const keys = Object.keys(value).filter((key) => !isSensitiveKey(key));
      for (const key of keys.slice(0, maxKeys)) out[key] = walk(value[key], depth + 1);
      if (keys.length > maxKeys) out['…'] = `${keys.length - maxKeys} more fields`;
      return out;
    }
    return null;
  };
  const text = JSON.stringify(walk(data, 0), null, 2) || '';
  return text.length > maxChars ? `${text.slice(0, maxChars)}
… (truncated)` : text;
}

/** Parámetros públicos de una petición (query o cuerpo JSON), sin claves sensibles. */
export function publicParams(url, body, secrets = []) {
  const params = {};
  try {
    for (const [key, value] of new URL(url).searchParams) if (!isSensitiveKey(key)) params[key] = redactText(value, secrets).slice(0, 300);
  } catch {
    /* URL inválida: sin parámetros */
  }
  if (body && typeof body === 'object') {
    const sample = JSON.parse(safeSample(body, { secrets, maxChars: 100000, maxDepth: 3, maxItems: 6, maxString: 300 }) || '{}');
    if (sample && typeof sample === 'object' && !Array.isArray(sample)) Object.assign(params, sample);
  }
  return params;
}

/** Número de registros en respuestas conocidas (lista raíz o primera lista de datos). */
export function countRecords(data) {
  if (Array.isArray(data)) return data.length;
  if (!data || typeof data !== 'object') return null;
  for (const key of ['results', 'studies', 'organic', 'news', 'items', 'hits']) if (Array.isArray(data[key])) return data[key].length;
  if (Array.isArray(data.data?.oppHits)) return data.data.oppHits.length;
  if (data.data && typeof data.data === 'object' && !Array.isArray(data.data)) return 1;
  return null;
}

/* ───────── Difusión (SSE) ───────── */
export function createLiveHub() {
  const listeners = new Map();
  return {
    subscribe(jobId, listener) {
      if (!listeners.has(jobId)) listeners.set(jobId, new Set());
      listeners.get(jobId).add(listener);
      return () => {
        const set = listeners.get(jobId);
        if (!set) return;
        set.delete(listener);
        if (!set.size) listeners.delete(jobId);
      };
    },
    publish(jobId, message) {
      for (const listener of Array.from(listeners.get(jobId) || [])) {
        try {
          listener(message);
        } catch {
          /* un cliente roto no detiene a los demás */
        }
      }
    },
    end(jobId, status) {
      this.publish(jobId, { type: 'end', status });
    },
    listenerCount(jobId) {
      return jobId ? listeners.get(jobId)?.size || 0 : [...listeners.values()].reduce((n, set) => n + set.size, 0);
    },
    close() {
      for (const jobId of Array.from(listeners.keys())) this.publish(jobId, { type: 'end', status: 'server_shutdown' });
      listeners.clear();
    },
  };
}

/* ───────── Registro de eventos por trabajo ───────── */
export function createRecorder(job, { store = null, hub = null, env = {}, maxEvents = 400 } = {}) {
  job.run ||= { version: 1, events: [], dropped: 0 };
  const secrets = secretValues(env);
  let sequence = job.run.events.at(-1)?.sequence || 0;
  const record = (input) => {
    if (!LIVE_PHASES.includes(input.phase)) throw new Error(`Unknown event phase: ${input.phase}`);
    const total = job.run.events.length;
    if (total >= maxEvents && (!ESSENTIAL.has(input.phase) || total >= maxEvents + 80)) {
      job.run.dropped++;
      return null;
    }
    sequence += 1;
    const event = {
      id: `${job.id}:${sequence}`,
      sequence,
      at: new Date().toISOString(),
      phase: input.phase,
      title: redactText(input.title || '', secrets).slice(0, 160),
      message: redactText(input.message || '', secrets).slice(0, 600),
    };
    if (input.provider) event.provider = String(input.provider).slice(0, 80);
    if (input.publicUrl) {
      const url = sanitizeUrl(input.publicUrl, secrets);
      if (url) event.publicUrl = url;
    }
    if (input.frameId) event.frameId = input.frameId;
    if (Number.isFinite(input.resultCount)) event.resultCount = input.resultCount;
    if (Number.isFinite(input.durationMs)) event.durationMs = Math.max(0, Math.round(input.durationMs));
    if (STATUSES.has(input.status)) event.status = input.status;
    if (input.detail) event.detail = JSON.parse(redactText(JSON.stringify(input.detail), secrets));
    job.run.events.push(event);
    store?.save(job);
    hub?.publish(job.id, { type: 'event', event });
    return event;
  };
  record.scope = (provider) => {
    const scoped = (input) => record({ provider, ...input });
    scoped.scope = record.scope;
    scoped.secrets = secrets;
    return scoped;
  };
  record.secrets = secrets;
  record.finish = (status) => hub?.end(job.id, status);
  return record;
}
/** Registro nulo para clientes sin trabajo asociado (p. ej. pruebas unitarias). */
export const noopRecorder = Object.assign(() => null, { scope: () => noopRecorder, secrets: [], finish: () => {} });

/* ───────── Capturas en memoria con límites ───────── */
export function createFrameStore({ maxPerJob = 18, maxTotalBytes = 40_000_000, ttlMs = 45 * 60_000, sweepMs = 60_000, now = () => Date.now() } = {}) {
  const frames = new Map();
  const jobs = new Map();
  let bytes = 0;
  const drop = (id) => {
    const frame = frames.get(id);
    if (!frame) return;
    bytes -= frame.buffer.length;
    frames.delete(id);
    jobs.get(frame.jobId)?.ids.delete(id);
  };
  const store = {
    canStore(jobId) {
      return (jobs.get(jobId)?.count || 0) < maxPerJob;
    },
    put(jobId, buffer, contentType = 'image/jpeg') {
      if (!Buffer.isBuffer(buffer) || !buffer.length) return null;
      const entry = jobs.get(jobId) || { count: 0, ids: new Set(), expiresAt: null };
      if (entry.count >= maxPerJob) return null;
      // Primero se liberan capturas de trabajos terminados; nunca se supera el total.
      if (bytes + buffer.length > maxTotalBytes) {
        for (const [id, frame] of frames) {
          if (bytes + buffer.length <= maxTotalBytes) break;
          if (jobs.get(frame.jobId)?.expiresAt) drop(id);
        }
        if (bytes + buffer.length > maxTotalBytes) return null;
      }
      const id = randomBytes(12).toString('hex');
      frames.set(id, { jobId, buffer, contentType, at: now() });
      entry.count += 1;
      entry.ids.add(id);
      jobs.set(jobId, entry);
      bytes += buffer.length;
      return id;
    },
    get(id) {
      return frames.get(id) || null;
    },
    countFor(jobId) {
      return jobs.get(jobId)?.count || 0;
    },
    /** El trabajo terminó: sus capturas caducan después del TTL. */
    expireJob(jobId, afterMs = ttlMs) {
      const entry = jobs.get(jobId);
      if (entry) entry.expiresAt = now() + afterMs;
    },
    dropJob(jobId) {
      for (const id of Array.from(jobs.get(jobId)?.ids || [])) drop(id);
      jobs.delete(jobId);
    },
    sweep() {
      for (const [jobId, entry] of Array.from(jobs)) if (entry.expiresAt && entry.expiresAt <= now()) store.dropJob(jobId);
    },
    stats() {
      return { frames: frames.size, bytes, jobs: jobs.size };
    },
    close() {
      clearInterval(timer);
      frames.clear();
      jobs.clear();
      bytes = 0;
    },
  };
  const timer = setInterval(() => store.sweep(), sweepMs);
  timer.unref?.();
  return store;
}

/* ───────── Datos reales para la visualización (títulos, consulta) ───────── */
const at = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
const pick = (obj, paths) => {
  for (const path of paths) {
    const value = at(obj, path);
    if (value != null && value !== '' && typeof value !== 'object') return String(value);
  }
  return null;
};
const TITLE_PATHS = ['title', 'opportunityTitle', 'project_title', 'display_name', 'protocolSection.identificationModule.briefTitle', 'fullName', 'name', 'headline'];
const SUBTITLE_PATHS = ['agency', 'agencyName', 'synopsis.agencyName', 'agency_ic_admin.name', 'organization.org_name', 'protocolSection.sponsorCollaboratorsModule.leadSponsor.name', 'primary_location.source.display_name', 'companyName', 'currentPositions.0.companyName', 'currentPosition.0.companyName', 'jobTitle', 'publication_year', 'closeDate', 'link', 'url'];
/** Hasta `limit` registros reales de la respuesta (título + subtítulo), recortados y redactados. */
export function previewRecords(data, { secrets = [], limit = 6 } = {}) {
  let list = Array.isArray(data) ? data : null;
  if (!list && data && typeof data === 'object') {
    for (const key of ['results', 'studies', 'organic', 'news', 'items', 'hits']) if (Array.isArray(data[key])) { list = data[key]; break; }
    if (!list && Array.isArray(data.data?.oppHits)) list = data.data.oppHits;
    if (!list && data.data && typeof data.data === 'object' && !Array.isArray(data.data)) list = [data.data];
  }
  if (!list) return [];
  const clip = (value, n) => { const text = redactText(value, secrets).replace(/\s+/g, ' ').trim(); return text.length > n ? `${text.slice(0, n - 1)}…` : text; };
  return list.slice(0, limit).flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const title = pick(item, TITLE_PATHS);
    if (!title) return [];
    const subtitle = pick(item, SUBTITLE_PATHS);
    return [{ title: clip(title, 140), subtitle: subtitle ? clip(subtitle, 90) : null }];
  });
}
const QUERY_KEYS = ['keyword', 'search', 'q', 'query', 'query.cond', 'query.term', 'search_text', 'text', 'searchTerm'];
/** Texto de búsqueda público de una petición (el que se "teclea" en la visualización). */
export function queryOf(params, depth = 0) {
  if (!params || typeof params !== 'object' || depth > 4) return null;
  for (const key of QUERY_KEYS) if (typeof params[key] === 'string' && params[key].trim()) return params[key].trim().slice(0, 300);
  for (const value of Object.values(params)) {
    const found = queryOf(value, depth + 1);
    if (found) return found;
  }
  if (Array.isArray(params.companies)) return params.companies.join(', ').slice(0, 300);
  return null;
}
