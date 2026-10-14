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
const ajv = new Ajv({ allErrors: true, strict: false });
const checkUnderstand = ajv.compile(UNDERSTAND_SCHEMA); const checkStep = ajv.compile(STEP_SCHEMA); const checkAssess = ajv.compile(ASSESS_SCHEMA);
const result = (check, raw) => check(raw) ? { ok: true, value: raw, errors: [] } : { ok: false, value: null, errors: (check.errors || []).map((e) => `${e.instancePath || '/'} ${e.message}`) };
export const validateUnderstand = (raw) => result(checkUnderstand, raw);
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
export const validateAssess = (raw) => result(checkAssess, raw && typeof raw === 'object' ? clipToSchema(raw, ASSESS_SCHEMA) : raw);
export function validateStep(raw, { lastObservation = null } = {}) {
  const out = result(checkStep, raw);
  if (out.ok && lastObservation === 'page' && raw.assessment === null) return { ok: false, value: null, errors: ['/assessment required after page'] };
  if (out.ok && raw.action.tool === 'ask_user' && (!Array.isArray(raw.action.args?.questions) || raw.action.args.questions.length > 3)) return { ok: false, value: null, errors: ['/action/args/questions must contain 1 to 3 questions'] };
  return out;
}
