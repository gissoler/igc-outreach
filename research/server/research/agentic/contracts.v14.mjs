/* Contratos cerrados para la comprensión inicial y cada paso del agente V14. */
import Ajv from 'ajv';

const text = (maxLength) => ({ type: 'string', maxLength });
const criterion = { type: 'object', additionalProperties: false, required: ['verdict', 'quote', 'reason'], properties: {
  verdict: { enum: ['yes', 'no', 'unknown'] }, quote: { type: ['string', 'null'] }, reason: text(500),
} };
const date = { type: 'object', additionalProperties: false, required: ['role', 'date', 'estimated', 'quote'], properties: {
  role: { enum: ['application_deadline', 'loi_deadline', 'opens', 'award', 'project_start', 'posted', 'other'] },
  date: { type: ['string', 'null'], pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, estimated: { type: 'boolean' }, quote: text(1000),
} };
const lead = { type: ['object', 'null'], additionalProperties: false, required: ['kind', 'funder', 'recipient', 'amount', 'quote', 'next'], properties: {
  kind: { enum: ['funding_news', 'awardee_list', 'cohort', 'portfolio', 'other'] }, funder: { type: ['string', 'null'] },
  recipient: { type: ['string', 'null'] }, amount: { type: ['string', 'null'] }, quote: text(1000),
  next: { type: 'array', maxItems: 5, items: text(300) },
} };
const assessment = { type: ['object', 'null'], additionalProperties: false, required: ['ref', 'page_type', 'about', 'dates', 'date_missing_next', 'criteria', 'candidate', 'lead'], properties: {
  ref: text(80), page_type: { enum: ['call', 'forecast_notice', 'program_page', 'funder_about', 'investor_about', 'portfolio', 'deal_news', 'awardee_list', 'cohort_announcement', 'directory', 'news', 'blog', 'report', 'event', 'other'] },
  about: text(300), dates: { type: 'array', maxItems: 20, items: date }, date_missing_next: { type: ['string', 'null'], maxLength: 500 },
  criteria: { type: 'object', additionalProperties: criterion }, candidate: { type: 'boolean' }, lead,
} };
export const UNDERSTAND_SCHEMA = { $id: 'agent.understand/1', type: 'object', additionalProperties: false,
  required: ['product_one_line', 'who_pays', 'sector', 'neighbor_sectors', 'stage', 'geography', 'assumptions', 'doubts'], properties: {
    product_one_line: text(500), who_pays: text(300), sector: text(200), neighbor_sectors: { type: 'array', maxItems: 10, items: text(200) },
    stage: text(100), geography: text(200), assumptions: { type: 'array', maxItems: 10, items: text(500) },
    doubts: { type: 'array', maxItems: 10, items: { type: 'object', additionalProperties: false, required: ['question', 'options', 'impact'], properties: {
      question: text(500), options: { type: 'array', minItems: 1, maxItems: 8, items: text(300) }, impact: { enum: ['changes_search', 'changes_criteria', 'none'] },
    } } },
  } };
export const STEP_SCHEMA = { $id: 'agent.step/1', type: 'object', additionalProperties: false, required: ['thought', 'assessment', 'notes', 'action'], properties: {
  thought: text(400), assessment, notes: { type: 'array', maxItems: 3, items: text(500) },
  action: { type: 'object', additionalProperties: false, required: ['tool', 'args', 'from_lead'], properties: {
    tool: { enum: ['search', 'open', 'apollo', 'entity_funding', 'registry', 'note', 'ask_user', 'finish'] }, args: { type: 'object' }, from_lead: { type: ['string', 'null'] },
  } },
} };
export const ASSESS_SCHEMA = { ...assessment, $id: 'agent.assess/1', type: 'object' };

/* P0.3 · Lectura ligera: veredicto y cita corta por criterio (sin `reason`), solo plazos de aplicación y LOI (máx. 6),
   claves de criterio fijas por objetivo (un esquema cerrado es más barato de decodificar) y lead con 3 búsquedas.
   P0.4 · Lectura mínima: el reintento de respaldo cuando la lectura falla; sin criterios (quedan `unknown`). */
export const PAGE_TYPES = assessment.properties.page_type.enum;
const liteCriterion = { type: 'object', additionalProperties: false, required: ['verdict', 'quote'], properties: { verdict: { enum: ['yes', 'no', 'unknown'] }, quote: { type: ['string', 'null'], maxLength: 300 } } };
const liteDate = { type: 'object', additionalProperties: false, required: ['role', 'date', 'estimated', 'quote'], properties: {
  role: { enum: ['application_deadline', 'loi_deadline'] }, date: { type: ['string', 'null'], pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, estimated: { type: 'boolean' }, quote: text(300),
} };
const liteLead = { type: ['object', 'null'], additionalProperties: false, required: ['kind', 'funder', 'recipient', 'amount', 'quote', 'next'], properties: {
  kind: lead.properties.kind, funder: { type: ['string', 'null'], maxLength: 200 }, recipient: { type: ['string', 'null'], maxLength: 200 }, amount: { type: ['string', 'null'], maxLength: 100 },
  quote: text(400), next: { type: 'array', maxItems: 3, items: text(150) },
} };
export function assessLiteSchema(ids = []) {
  return { $id: 'agent.assess_lite/1', type: 'object', additionalProperties: false, required: ['ref', 'page_type', 'about', 'dates', 'criteria', 'candidate', 'lead'], properties: {
    ref: text(80), page_type: { enum: PAGE_TYPES }, about: text(200), dates: { type: 'array', maxItems: 6, items: liteDate },
    criteria: { type: 'object', additionalProperties: false, required: [...ids], properties: Object.fromEntries(ids.map((id) => [id, liteCriterion])) },
    candidate: { type: 'boolean' }, lead: liteLead,
  } };
}
export const ASSESS_MIN_SCHEMA = { $id: 'agent.assess_min/1', type: 'object', additionalProperties: false, required: ['ref', 'page_type', 'about', 'candidate', 'deadline'], properties: {
  ref: text(80), page_type: { enum: PAGE_TYPES }, about: text(200), candidate: { type: 'boolean' },
  deadline: { type: ['object', 'null'], additionalProperties: false, required: ['role', 'date', 'quote'], properties: { role: liteDate.properties.role, date: liteDate.properties.date, quote: text(300) } },
} };
export const ASSESS_CONTRACTS = ['lite', 'full', 'min'];
/** Contrato de lectura activo: `ENGINE_AGENT_ASSESS_CONTRACT=full` conserva el contrato agent.assess/1 para comparar. */
export const assessContractOf = (env = {}) => String(env.ENGINE_AGENT_ASSESS_CONTRACT || '').trim().toLowerCase() === 'full' ? 'full' : 'lite';

/** Lleva una lectura ligera o mínima a la forma agent.assess/1 que usan ingest, juez y auditoría. */
export function liftAssess(raw, contract, ids = []) {
  if (!raw || contract === 'full') return raw ? { ...raw, contract: 'full' } : raw;
  const criteria = Object.fromEntries(ids.map((id) => {
    const c = contract === 'lite' ? raw.criteria?.[id] : null;
    return [id, { verdict: c?.verdict || 'unknown', quote: c?.quote ?? null, reason: '' }];
  }));
  const dates = contract === 'lite' ? (raw.dates || []).map((d) => ({ role: d.role, date: d.date, estimated: Boolean(d.estimated), quote: d.quote }))
    : raw.deadline ? [{ role: raw.deadline.role, date: raw.deadline.date, estimated: false, quote: raw.deadline.quote }] : [];
  const leadOut = contract === 'lite' && raw.lead ? { ...raw.lead, next: raw.lead.next || [] } : null;
  return { ref: raw.ref, page_type: raw.page_type, about: raw.about, dates, date_missing_next: null, criteria, candidate: Boolean(raw.candidate), lead: leadOut, contract };
}
/* Esquema para el modelo, sin `maxLength` (medido el 20/10 con Qwen3-30B en vLLM, una sola página): esa restricción bajaba la
   decodificación guiada de ~209 a ~14 tok/s; quitar enum, pattern, maxItems, null o objetos cerrados no cambió nada.
   El largo se pide en el prompt y se recorta en código (`clipLengths`) antes de validar con el esquema original. */
const SCHEMA_MAPS = ['properties', 'patternProperties', '$defs', 'definitions']; const SCHEMA_LISTS = ['anyOf', 'oneOf', 'allOf']; const SCHEMA_ONE = ['items', 'additionalProperties', 'not', 'if', 'then', 'else'];
export function relaxForModel(schema) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return schema;
  const out = {};
  for (const [k, v] of Object.entries(schema)) {
    if (k === 'maxLength') continue;
    if (SCHEMA_MAPS.includes(k) && v && typeof v === 'object') out[k] = Object.fromEntries(Object.entries(v).map(([name, sub]) => [name, relaxForModel(sub)]));
    else if (SCHEMA_LISTS.includes(k) && Array.isArray(v)) out[k] = v.map(relaxForModel);
    else if (SCHEMA_ONE.includes(k) && v && typeof v === 'object') out[k] = relaxForModel(v);
    else out[k] = v;
  }
  return out;
}
/** Recorta los textos que pasan de su `maxLength`. Un recorte de una cita literal sigue siendo literal (es un prefijo). */
export function clipLengths(value, schema) {
  let clipped = 0;
  const walk = (v, s) => {
    if (!s || typeof s !== 'object') return v;
    if (typeof v === 'string') { if (Number.isInteger(s.maxLength) && v.length > s.maxLength) { clipped += 1; return v.slice(0, s.maxLength); } return v; }
    if (Array.isArray(v)) return s.items && typeof s.items === 'object' ? v.map((x) => walk(x, s.items)) : v;
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, s.properties?.[k] ?? (s.additionalProperties && typeof s.additionalProperties === 'object' ? s.additionalProperties : null))]));
    return v;
  };
  const out = walk(value, schema); return { value: out, clipped };
}
const ajv = new Ajv({ allErrors: true, strict: false });
const checkUnderstand = ajv.compile(UNDERSTAND_SCHEMA); const checkStep = ajv.compile(STEP_SCHEMA); const checkAssess = ajv.compile(ASSESS_SCHEMA);
const result = (check, raw, schema) => {
  const { value, clipped } = schema ? clipLengths(raw, schema) : { value: raw, clipped: 0 };
  return check(value) ? { ok: true, value, errors: [], ...(clipped ? { clipped } : {}) } : { ok: false, value: null, errors: (check.errors || []).map((e) => `${e.instancePath || '/'} ${e.message}`) };
};
export const validateUnderstand = (raw) => result(checkUnderstand, raw, UNDERSTAND_SCHEMA);
/** Recorta textos y listas a los topes del contrato en vez de rechazar la página entera (14-10: una razón de 600 caracteres tiró una página). */
export function clipToSchema(value, schema) {
  if (!schema || value === null || value === undefined) return value;
  if (typeof value === 'string') return Number.isFinite(schema.maxLength) && value.length > schema.maxLength ? value.slice(0, schema.maxLength) : value;
  if (Array.isArray(value)) { const out = Number.isFinite(schema.maxItems) ? value.slice(0, schema.maxItems) : value; return schema.items ? out.map((v) => clipToSchema(v, schema.items)) : out; }
  if (typeof value === 'object') {
    const out = {}; for (const [k, v] of Object.entries(value)) { const sub = schema.properties?.[k] || (typeof schema.additionalProperties === 'object' ? schema.additionalProperties : null); out[k] = sub ? clipToSchema(v, sub) : v; }
    return out;
  }
  return value;
}
export const validateAssess = (raw) => result(checkAssess, raw && typeof raw === 'object' ? clipToSchema(raw, ASSESS_SCHEMA) : raw, ASSESS_SCHEMA);
const liteChecks = new Map(); const checkMin = ajv.compile(ASSESS_MIN_SCHEMA);
export function validateAssessLite(raw, ids = []) {
  const key = ids.join('|');
  if (!liteChecks.has(key)) { const schema = assessLiteSchema(ids); liteChecks.set(key, { schema, check: new Ajv({ allErrors: true, strict: false }).compile(schema) }); }   // un Ajv por lista de criterios: el $id es fijo y Ajv rechaza dos esquemas con el mismo $id
  const { schema, check } = liteChecks.get(key);
  return result(check, raw, schema);
}
export const validateAssessMin = (raw) => result(checkMin, raw, ASSESS_MIN_SCHEMA);
/** Validador por contrato; `ids` son los criterios del objetivo (fijos en el contrato ligero). */
export const assessValidator = (contract, ids = []) => contract === 'full' ? validateAssess : contract === 'min' ? validateAssessMin : (raw) => validateAssessLite(raw, ids);
export function validateStep(raw, { lastObservation = null } = {}) {
  const out = result(checkStep, raw, STEP_SCHEMA);
  if (out.ok && lastObservation === 'page' && raw.assessment === null) return { ok: false, value: null, errors: ['/assessment required after page'] };
  if (out.ok && raw.action.tool === 'ask_user' && (!Array.isArray(raw.action.args?.questions) || raw.action.args.questions.length > 3)) return { ok: false, value: null, errors: ['/action/args/questions must contain 1 to 3 questions'] };
  return out;
}
