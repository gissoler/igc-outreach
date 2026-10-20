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
const ajv = new Ajv({ allErrors: true, strict: false });
const checkUnderstand = ajv.compile(UNDERSTAND_SCHEMA); const checkStep = ajv.compile(STEP_SCHEMA); const checkAssess = ajv.compile(ASSESS_SCHEMA);
const result = (check, raw) => check(raw) ? { ok: true, value: raw, errors: [] } : { ok: false, value: null, errors: (check.errors || []).map((e) => `${e.instancePath || '/'} ${e.message}`) };
export const validateUnderstand = (raw) => result(checkUnderstand, raw);
export const validateAssess = (raw) => result(checkAssess, raw);
const liteChecks = new Map(); const checkMin = ajv.compile(ASSESS_MIN_SCHEMA);
export function validateAssessLite(raw, ids = []) {
  const key = ids.join('|'); if (!liteChecks.has(key)) liteChecks.set(key, new Ajv({ allErrors: true, strict: false }).compile(assessLiteSchema(ids))); // un Ajv por lista de criterios: el $id es fijo y Ajv rechaza dos esquemas con el mismo $id
  return result(liteChecks.get(key), raw);
}
export const validateAssessMin = (raw) => result(checkMin, raw);
/** Validador por contrato; `ids` son los criterios del objetivo (fijos en el contrato ligero). */
export const assessValidator = (contract, ids = []) => contract === 'full' ? validateAssess : contract === 'min' ? validateAssessMin : (raw) => validateAssessLite(raw, ids);
export function validateStep(raw, { lastObservation = null } = {}) {
  const out = result(checkStep, raw);
  if (out.ok && lastObservation === 'page' && raw.assessment === null) return { ok: false, value: null, errors: ['/assessment required after page'] };
  if (out.ok && raw.action.tool === 'ask_user' && (!Array.isArray(raw.action.args?.questions) || raw.action.args.questions.length > 3)) return { ok: false, value: null, errors: ['/action/args/questions must contain 1 to 3 questions'] };
  return out;
}
