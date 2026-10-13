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
const cleanDates = (list) => (Array.isArray(list) ? list.filter((d) => d && typeof d === 'object').map((d) => ({ ...d, role: low(d.role), date: typeof d.date === 'string' && d.date.trim() ? d.date.trim() : d.date === undefined ? undefined : d.date === '' ? null : d.date, quote: str(d.quote), ...(typeof d.estimated === 'string' ? { estimated: /^(true|yes)$/i.test(d.estimated) } : {}) })) : list);
const errorsOf = (fn) => (fn.errors || []).slice(0, 8).map((e) => `${e.instancePath || '/'} ${e.message}`);

/** Forma mínima antes de validar: no inventa campos, no cambia valores. */
export function normalizeCompilation(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  return {
    ...raw, page_type: low(raw.page_type),
    ...(raw.identity && typeof raw.identity === 'object' ? { identity: { ...raw.identity, kind: low(raw.identity.kind), name: str(raw.identity.name) } } : {}),
    dates: cleanDates(raw.dates),
    ...(raw.eligibility && typeof raw.eligibility === 'object' ? { eligibility: { ...raw.eligibility, for_profit_allowed: raw.eligibility.for_profit_allowed === undefined ? undefined : low(raw.eligibility.for_profit_allowed) } } : {}),
  };
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
