/* V13 · Contratos del agente de compilación y del agente juez.
   Los esquemas viven en docs/contracts/v13/ (no en docs/contracts/: ese directorio lo carga agent/contracts.mjs completo y los v1/v2 no se tocan).
   Aquí solo se normaliza la forma (espacios, mayúsculas de los enum) y se valida. Una salida inválida NO se corrige: devuelve ok:false. */
import Ajv2020 from 'ajv/dist/2020.js';
import { readFileSync } from 'node:fs';

const load = (name) => JSON.parse(readFileSync(new URL(`../../../../docs/contracts/v13/${name}.schema.json`, import.meta.url), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: true, strictTypes: false, strictRequired: false, allowUnionTypes: true });
const COMPILATION = load('page_compilation');
const JUDGMENT = load('page_judgment');
const vCompilation = ajv.compile(COMPILATION);
const vJudgment = ajv.compile(JUDGMENT);

export const DATE_ROLES = COMPILATION.properties.dates.items.properties.role.enum;
export const PAGE_TYPES = COMPILATION.properties.page_type.enum;
export const CRITERIA_IDS = JUDGMENT.properties.criteria.propertyNames.enum;
export const CONTRACT_VERSION = 'v13';

const low = (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v);
const str = (v) => (typeof v === 'string' ? v.trim() : v);
/** Un rol fuera del catálogo se lee como «other»: nunca puede pasar por application_deadline. */
const roleOf = (v) => { const r = low(v); return typeof r === 'string' && !DATE_ROLES.includes(r) && r ? 'other' : r; };
/** Recorta cadenas y listas que exceden el esquema (una cita larga es prefijo literal de la página; el auditor la sigue comprobando). Las listas de fechas no se recortan. */
function clipTo(value, schema) {
  if (!schema || value == null) return value;
  if (typeof value === 'string') return Number.isInteger(schema.maxLength) && value.length > schema.maxLength ? value.slice(0, schema.maxLength) : value;
  if (Array.isArray(value)) { const items = schema.items; const kept = Number.isInteger(schema.maxItems) && items?.type !== 'object' ? value.slice(0, schema.maxItems) : value; return kept.map((v) => clipTo(v, items)); }
  if (typeof value === 'object' && schema.properties) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clipTo(v, schema.properties[k])]));
  return value;
}
const cleanDates = (list) => (Array.isArray(list) ? list.filter((d) => d && typeof d === 'object').map((d) => ({ ...d, role: roleOf(d.role), date: typeof d.date === 'string' && d.date.trim() ? d.date.trim() : d.date === undefined ? undefined : d.date === '' ? null : d.date, quote: str(d.quote), ...(typeof d.estimated === 'string' ? { estimated: /^(true|yes)$/i.test(d.estimated) } : {}) })) : list);
const errorsOf = (fn) => (fn.errors || []).slice(0, 8).map((e) => `${e.instancePath || '/'} ${e.message}`);

/** Forma mínima antes de validar: no inventa campos; recorta lo que excede el esquema y manda roles de fecha desconocidos a «other». */
export function normalizeCompilation(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  return clipTo({
    ...raw, page_type: low(raw.page_type),
    ...(raw.identity && typeof raw.identity === 'object' ? { identity: { ...raw.identity, kind: low(raw.identity.kind), name: str(raw.identity.name) } } : {}),
    dates: cleanDates(raw.dates),
    ...(raw.money === undefined ? {} : { money: low(raw.money) }), ...(raw.non_dilutive === undefined ? {} : { non_dilutive: low(raw.non_dilutive) }),
    ...(raw.eligibility && typeof raw.eligibility === 'object' ? { eligibility: { ...raw.eligibility, for_profit_allowed: raw.eligibility.for_profit_allowed === undefined ? undefined : low(raw.eligibility.for_profit_allowed) } } : {}),
  }, COMPILATION);
}
export function normalizeJudgment(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const criteria = raw.criteria && typeof raw.criteria === 'object' && !Array.isArray(raw.criteria)
    ? Object.fromEntries(Object.entries(raw.criteria).map(([k, c]) => [low(k), c && typeof c === 'object' ? { ...c, verdict: low(c.verdict), ...(c.compiler === undefined ? {} : { compiler: low(c.compiler) }) } : c]))
    : raw.criteria;
  return { ...raw, page_type: low(raw.page_type), dates: cleanDates(raw.dates), criteria };
}

export function validateCompilation(raw) {
  const value = normalizeCompilation(raw);
  return vCompilation(value) ? { ok: true, value, errors: [] } : { ok: false, value: null, errors: errorsOf(vCompilation) };
}
export function validateJudgment(raw) {
  const value = normalizeJudgment(raw);
  return vJudgment(value) ? { ok: true, value, errors: [] } : { ok: false, value: null, errors: errorsOf(vJudgment) };
}
export { COMPILATION as COMPILATION_SCHEMA, JUDGMENT as JUDGMENT_SCHEMA };
