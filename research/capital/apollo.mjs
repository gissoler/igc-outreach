import { createHash } from 'node:crypto';
import { validateCapital } from './contracts.mjs';

const API = 'https://api.apollo.io/api/v1';
const clip = (value, n = 300) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const safeError = (data, status) => clip(data?.error_details?.message || data?.error || data?.message || `Apollo HTTP ${status}`, 240);
const codeOf = (data) => clip(data?.error_details?.code || data?.error_code || '', 120);
const nowDate = (clock) => clock().toISOString().slice(0, 10);

export class ApolloApiError extends Error {
  constructor(message, { status = null, code = '', retryAfter = null } = {}) {
    super(message); this.name = 'ApolloApiError'; this.status = status; this.code = code; this.retryAfter = retryAfter;
  }
}

export class ApolloCache {
  constructor({ ttlMs = 24 * 3600_000, clock = () => new Date() } = {}) { this.ttlMs = ttlMs; this.clock = clock; this.values = new Map(); this.hits = 0; }
  key(path, body) { return createHash('sha256').update(`${path}|${JSON.stringify(body || {})}`).digest('hex'); }
  get(path, body) { const key = this.key(path, body); const row = this.values.get(key); if (!row || row.expires <= this.clock().getTime()) { this.values.delete(key); return null; } this.hits++; return row.value; }
  put(path, body, value) { this.values.set(this.key(path, body), { value, expires: this.clock().getTime() + this.ttlMs }); }
}

export const sharedApolloCache = new ApolloCache();
const sharedDailyCredits = new Map();

export class ApolloBudget {
  constructor({ perRun = 8, perOrganization = 3, perDay = 30, clock = () => new Date(), dailyLedger = sharedDailyCredits } = {}) { this.caps = { perRun, perOrganization, perDay }; this.clock = clock; this.run = 0; this.byOrg = new Map(); this.byDay = dailyLedger; }
  consume({ organization = '', credits = 0 } = {}) {
    const day = nowDate(this.clock); const daily = this.byDay.get(day) || 0; const org = this.byOrg.get(organization) || 0;
    if (this.run + credits > this.caps.perRun) throw Object.assign(new Error('Apollo run credit cap reached.'), { code: 'APOLLO_RUN_CAP', budget: true });
    if (organization && org + credits > this.caps.perOrganization) throw Object.assign(new Error('Apollo organization credit cap reached.'), { code: 'APOLLO_ORG_CAP', budget: true });
    if (daily + credits > this.caps.perDay) throw Object.assign(new Error('Apollo daily credit cap reached.'), { code: 'APOLLO_DAILY_CAP', budget: true });
    this.run += credits; if (organization) this.byOrg.set(organization, org + credits); this.byDay.set(day, daily + credits);
  }
}

export function createApolloClient({ apiKey, fetcher = fetch, timeoutMs = 15000, cache = sharedApolloCache, budget = new ApolloBudget(), clock = () => new Date(), baseUrl = API } = {}) {
  const key = clip(apiKey, 1000);
  const stats = { calls: 0, creditsEstimated: 0 };
  async function request(path, { method = 'GET', body = null, creditEstimate = 0, organization = '', cacheable = true } = {}) {
    if (!key) throw Object.assign(new Error('APOLLO_API_KEY not configured.'), { code: 'APOLLO_NOT_CONFIGURED' });
    const cached = cacheable ? cache.get(path, body) : null; if (cached) return { ...cached, cached: true };
    budget.consume({ organization, credits: creditEstimate }); stats.creditsEstimated += creditEstimate; stats.calls++;
    const started = clock().getTime();
    const response = await fetcher(`${baseUrl}${path}`, {
      method, headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', 'x-api-key': key },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(timeoutMs),
    });
    const data = await response.json().catch(() => ({}));
    const latencyMs = Math.max(0, clock().getTime() - started);
    if (!response.ok) throw new ApolloApiError(safeError(data, response.status), { status: response.status, code: codeOf(data), retryAfter: response.headers?.get?.('retry-after') || null });
    const result = { data, status: response.status, latencyMs, headers: {
      minuteLimit: response.headers?.get?.('x-rate-limit-minute') || null,
      minuteLeft: response.headers?.get?.('x-minute-requests-left') || null,
      dailyLimit: response.headers?.get?.('x-rate-limit-24-hour') || null,
      dailyLeft: response.headers?.get?.('x-24-hour-requests-left') || null,
    }, cached: false };
    if (cacheable) cache.put(path, body, result);
    return result;
  }
  return {
    stats, cache, budget,
    health: () => request('/auth/health', { cacheable: false }),
    creditUsage: () => request('/usage_stats/credit_usage_stats', { method: 'POST', body: {}, cacheable: false }),
    apiUsage: () => request('/usage_stats/api_usage_stats', { method: 'POST', body: {}, cacheable: false }),
    organizationSearch: ({ domain, name, location, perPage = 1 } = {}) => request('/mixed_companies/search', { method: 'POST', body: { ...(domain ? { q_organization_domains_list: [domain] } : {}), ...(name ? { q_organization_name: name } : {}), ...(location ? { organization_locations: [location] } : {}), page: 1, per_page: Math.min(10, Math.max(1, perPage)) }, creditEstimate: 1, organization: domain || name || '' }),
    // People Enrichment: con el id de la búsqueda devuelve nombre completo, LinkedIn y correo de trabajo (≈1 crédito; sin teléfono ni correo personal).
    peopleMatch: ({ id, organization = '' } = {}) => request(`/people/match?${new URLSearchParams({ id: String(id || ''), reveal_personal_emails: 'false', reveal_phone_number: 'false' })}`, { method: 'POST', body: {}, creditEstimate: 1, organization }),
    peopleSearch: ({ domain, organizationId, titles = [], perPage = 5 } = {}) => request('/mixed_people/api_search', { method: 'POST', body: { ...(domain ? { q_organization_domains_list: [domain] } : {}), ...(organizationId ? { organization_ids: [organizationId] } : {}), ...(titles.length ? { person_titles: titles, include_similar_titles: true } : {}), page: 1, per_page: Math.min(10, Math.max(1, perPage)) }, organization: domain || organizationId || '' }),
  };
}

const DOCS = [
  'https://docs.apollo.io/reference/authentication',
  'https://docs.apollo.io/reference/organization-search',
  'https://docs.apollo.io/reference/people-api-search',
  'https://docs.apollo.io/reference/view-credit-usage-stats',
  'https://docs.apollo.io/reference/view-api-usage-stats',
  'https://docs.apollo.io/docs/api-pricing',
];
const count = (value, keys) => { for (const key of keys) if (Array.isArray(value?.[key])) return value[key].length; return 0; };
const check = (name, ok, response = null, error = null, records = 0) => ({ name, ok, http_status: response?.status ?? error?.status ?? null, latency_ms: response?.latencyMs || 0, records, error: error ? clip(error.message, 240) : null });
const classifyError = (error) => {
  if (error?.status === 401) return 'authentication_failed';
  if (error?.status === 402 || /credit/i.test(`${error?.code || ''} ${error?.message || ''}`)) return 'insufficient_credits';
  if (error?.status === 403) return 'unsupported_by_plan';
  if (error?.status === 429) return 'connected_limited';
  return 'error';
};

/** Read-only: no enrichment, writes, sequences, contact creation or messages. Organization search may consume one credit. */
export async function preflightApollo({ apiKey, domain = 'apollo.io', asOf = new Date().toISOString().slice(0, 10), client = null, clientOptions = {} } = {}) {
  const started = Date.now(); const checks = []; const errors = []; const scope = [];
  if (!clip(apiKey) && !client) return validateCapital('apollo_preflight', { schema_version: 'apollo_preflight/1', as_of: asOf, status: 'not_configured', configured: false, read_only: true, test_domain: null, checks, quota: { known: false, credit_types: {}, cycle: null }, scope, latency_ms: 0, errors: [], documentation: DOCS.map((url) => ({ url, consulted_at: asOf })) });
  const apollo = client || createApolloClient({ apiKey, ...clientOptions });
  let status = 'connected'; let quota = { known: false, credit_types: {}, cycle: null };
  try {
    const health = await apollo.health(); const ok = health.data?.healthy === true && health.data?.is_logged_in === true;
    checks.push(check('authentication', ok, health)); if (!ok) status = 'authentication_failed'; else scope.push('auth_health');
  } catch (error) { checks.push(check('authentication', false, null, error)); errors.push(clip(error.message)); status = classifyError(error); }
  if (status === 'authentication_failed' || status === 'error') return validateCapital('apollo_preflight', { schema_version: 'apollo_preflight/1', as_of: asOf, status, configured: true, read_only: true, test_domain: domain, checks, quota, scope, latency_ms: Date.now() - started, errors, documentation: DOCS.map((url) => ({ url, consulted_at: asOf })) });
  try {
    const credits = await apollo.creditUsage(); const raw = credits.data?.credit_usage_stats || {};
    quota = { known: true, credit_types: Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, { limit: Number.isFinite(Number(value?.limit)) ? Number(value.limit) : null, consumed: Number.isFinite(Number(value?.consumed)) ? Number(value.consumed) : null, left_over: Number.isFinite(Number(value?.left_over)) ? Number(value.left_over) : null }])), cycle: credits.data?.current_credit_cycle || null };
    checks.push(check('credit_usage', true, credits)); scope.push('credit_usage_stats');
  } catch (error) { checks.push(check('credit_usage', false, null, error)); errors.push(clip(error.message)); if (error?.status === 403) status = 'quota_unknown'; else if (status === 'connected') status = classifyError(error); }
  try { const usage = await apollo.apiUsage(); checks.push(check('api_usage', true, usage)); scope.push('api_usage_stats'); }
  catch (error) { checks.push(check('api_usage', false, null, error)); errors.push(clip(error.message)); if (status === 'connected') status = error?.status === 403 ? 'connected_limited' : classifyError(error); }
  let orgId = '';
  try { const org = await apollo.organizationSearch({ domain, perPage: 1 }); const rows = org.data?.organizations || org.data?.accounts || []; orgId = rows[0]?.id || rows[0]?.organization_id || ''; checks.push(check('organization_search', true, org, null, rows.length)); scope.push('organization_search'); }
  catch (error) { checks.push(check('organization_search', false, null, error)); errors.push(clip(error.message)); status = classifyError(error); }
  if (!['authentication_failed', 'insufficient_credits', 'unsupported_by_plan', 'error'].includes(status)) {
    try { const people = await apollo.peopleSearch({ domain, organizationId: orgId, perPage: 1 }); const rows = people.data?.people || []; checks.push(check('people_search', true, people, null, rows.length)); scope.push('people_search'); }
    catch (error) { checks.push(check('people_search', false, null, error)); errors.push(clip(error.message)); status = classifyError(error); }
  }
  return validateCapital('apollo_preflight', { schema_version: 'apollo_preflight/1', as_of: asOf, status, configured: true, read_only: true, test_domain: domain, checks, quota, scope: [...new Set(scope)], latency_ms: Math.max(0, Date.now() - started), errors, documentation: DOCS.map((url) => ({ url, consulted_at: asOf })) });
}
