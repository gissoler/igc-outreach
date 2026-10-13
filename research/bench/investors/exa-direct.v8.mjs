// V8 (PROMPT-v10): llamada directa a Exa /search con category y numResults hasta 100 (el cliente de searchApis.mjs limita a 20
// y no admite category; searchApis.mjs y search-failover.mjs no se tocan). Caché por clave; registro de costo por llamada.
// Costo: tarifa exa.ai/pricing (consultada 2026-10-12): auto 7 USD/1.000 hasta 10 resultados, +1 USD/1.000 por resultado extra,
// contenido 1 USD/1.000 páginas por tipo. El cobro real medido es 0.0089 USD por llamada de 10 resultados con texto y highlights
// (nominal 0.027). Para que exa_spend.mjs --usd-per-call 0.0089 no subestime llamadas más caras, cada llamada se registra como
// unidades = ceil(nominal / 0.027) intentos pagados (mínimo 1): 10 resultados con o sin texto = 1; 25 sin texto = 1; 50 sin texto = 2.
import { createHash } from 'node:crypto';
export const NOMINAL_REF = 0.027, USD_PER_UNIT = 0.0089;
export const nominalUsd = ({ numResults = 10, textChars = 0, highlights = false }) => 0.007 + 0.001 * Math.max(0, numResults - 10) + 0.001 * numResults * ((textChars ? 1 : 0) + (highlights ? 1 : 0));
export const units = o => Math.max(1, Math.ceil(nominalUsd(o) / NOMINAL_REF - 1e-9));
export const BALANCE_RE = /\b40[123]\b|\b429\b|credit|balance|quota|insufficient/i;
const sha = s => createHash('sha256').update(String(s)).digest('hex');
export const exaKey = ({ query, numResults = 10, category = null, textChars = 0, highlights = false, type = 'auto' }) =>
  sha(`v8|${type}|${category ?? ''}|${numResults}|${textChars}|${highlights ? 'h' : ''}|${String(query).trim().toLowerCase()}`);

/** Una búsqueda Exa. Devuelve { rows, cached, units, nominal_usd, exa_cost_usd, error }. No lanza: el error va en el resultado. */
export async function exaSearchV8(req, { env = process.env, fetcher = fetch, cache = null, timeoutMs = 45000 } = {}) {
  const { query, numResults = 10, category = null, textChars = 0, highlights = false, type = 'auto' } = req;
  const key = exaKey(req), u = units(req), nominal = +nominalUsd(req).toFixed(4);
  const hit = cache?.get('exa_v8', key);
  if (hit) return { rows: hit.value, cached: true, units: 0, nominal_usd: 0, exa_cost_usd: 0, error: null, key };
  const apiKey = String(env.EXA_API_KEY ?? '').trim();
  if (!apiKey) return { rows: [], cached: false, units: 0, nominal_usd: 0, exa_cost_usd: 0, error: 'EXA_API_KEY ausente', key };
  const contents = textChars || highlights ? { ...(textChars ? { text: { maxCharacters: textChars } } : {}), ...(highlights ? { highlights: true } : {}) } : null;
  const body = { query: String(query).slice(0, 1000), type, numResults, ...(category ? { category } : {}), ...(contents ? { contents } : {}) };
  try {
    const r = await fetcher('https://api.exa.ai/search', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'x-api-key': apiKey }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
    const text = await r.text().catch(() => '');
    if (!r.ok) return { rows: [], cached: false, units: u, nominal_usd: nominal, exa_cost_usd: 0, error: `Exa HTTP ${r.status}: ${text.replace(/\s+/g, ' ').slice(0, 200)}`, status: r.status, key };
    const data = JSON.parse(text);
    const rows = (data.results ?? []).map((x, i) => ({ rank: i + 1, url: x.url, title: x.title ?? '', text: textChars ? String(x.text ?? '').slice(0, textChars) : '' }));
    cache?.put('exa_v8', key, rows, { nominal_usd: nominal, units: u, exa_cost_usd: Number(data?.costDollars?.total) || 0 });
    return { rows, cached: false, units: u, nominal_usd: nominal, exa_cost_usd: Number(data?.costDollars?.total) || 0, error: null, key };
  } catch (e) {
    return { rows: [], cached: false, units: u, nominal_usd: nominal, exa_cost_usd: 0, error: `Exa ${String(e.message).slice(0, 200)}`, key };
  }
}
/** Intentos con el formato que lee exa_spend.mjs: una entrada por unidad (la primera lleva el número de resultados). */
export const spendAttempts = res => res.cached ? [{ provider: 'exa', cached: true, results: res.rows.length, error: null }]
  : Array.from({ length: res.units }, (_, i) => ({ provider: 'exa', cached: false, results: i ? 0 : res.rows.length, error: res.error, unit: `${i + 1}/${res.units}` }));
