// Módulo 5: motor de elegibilidad de grants (Grants.gov / NIH) para Rohit.
// Cada regla sale del texto oficial con su cita literal; se evalúa contra el perfil de la organización.
// Veredicto por regla y global: ✔ (cumple), ✖ (no cumple) o ? (falta un dato o la regla es ambigua).
// Un "?" nunca se convierte en ✔: el global es ✔ solo si todas las reglas evaluadas son ✔.
import { chatJSON, fleetConfig } from './fleet.mjs';
import { plainText, quoteInPage } from './deals.mjs';

export const RULE_TYPES = ['entity_type', 'small_business', 'foreign_entity', 'foreign_component', 'pi_us', 'pi_employment', 'ownership', 'cost_sharing', 'budget_cap', 'deadline', 'other'];

/**
 * Perfil de elegibilidad. null = desconocido (produce "?"). Cada dato conocido lleva su fuente.
 * Valores por defecto para IGC: solo lo documentado en el Project (doc del 24-sep); el resto lo completa Rohit.
 */
export const IGC_PROFILE = {
  name: 'IGC Pharma',
  entityType: { value: 'for_profit', source: 'Project RESEARCH-AGENT, doc del 24-sep-2026: empresa con fines de lucro, pública' },
  publiclyTraded: { value: true, source: 'Project RESEARCH-AGENT, doc del 24-sep-2026' },
  usEntity: { value: true, source: 'Project RESEARCH-AGENT: incorporada en Maryland (EE. UU.)' },
  smallBusiness: { value: null, source: 'Pendiente: ¿≤500 empleados con afiliadas (definición SBA)?' },
  ownershipUS51: { value: null, source: 'Pendiente: ¿≥51 % de propiedad de ciudadanos/residentes de EE. UU.? (empresa pública: requiere análisis)' },
  piInUS: { value: null, source: 'Pendiente: ¿el PI propuesto reside y trabaja en EE. UU.?' },
  piPrimaryEmployment: { value: null, source: 'Pendiente: ¿el PI tiene empleo principal (>50 %) en IGC?' },
  foreignComponent: { value: null, source: 'Pendiente: ¿parte del trabajo se haría en Colombia, India o Canadá?' },
  canCostShare: { value: null, source: 'Pendiente: ¿IGC puede aportar costo compartido?' },
  requestedBudget: { value: null, source: 'Pendiente: monto que se pediría (US$)' },
};

// Frases estándar de NOFOs de NIH y Grants.gov. Cada patrón produce una regla con la oración literal como cita.
const PATTERNS = [
  { type: 'foreign_entity', requirement: 'not_allowed', rx: /non-domestic \(non-u\.?s\.?\) entities \(foreign (?:institutions|organizations)\) are not eligible|foreign (?:institutions|organizations) are not eligible/i },
  { type: 'foreign_entity', requirement: 'allowed', rx: /non-domestic \(non-u\.?s\.?\) entities \(foreign (?:institutions|organizations)\) are eligible|foreign (?:institutions|organizations) are eligible/i },
  { type: 'foreign_component', requirement: 'not_allowed', rx: /foreign components?,? as defined in the nih grants policy statement,? (?:are|is) not allowed/i },
  { type: 'foreign_component', requirement: 'allowed', rx: /foreign components?,? as defined in the nih grants policy statement,? (?:are|is) allowed/i },
  { type: 'cost_sharing', requirement: 'not_required', rx: /cost sharing is not required/i },
  { type: 'cost_sharing', requirement: 'required', rx: /cost sharing (?:is|will be) required/i },
  { type: 'pi_employment', requirement: 'primary_employment_small_business', rx: /primary employment[^.]{0,120}(?:small business|sbc)|(?:more than one half|more than 50\s?%)[^.]{0,80}(?:employed|employment)[^.]{0,60}(?:small business|sbc)/i },
  { type: 'ownership', requirement: 'us_owned_51', rx: /(?:51|fifty-one)\s?(?:%|percent)[^.]{0,160}(?:owned|ownership)[^.]{0,120}(?:citizens|permanent resident)/i },
  { type: 'small_business', requirement: 'small_business_concern', rx: /only (?:united states )?small business concerns? (?:\(sbcs?\) )?are eligible|must (?:be|qualify as) a small business concern/i },
];
const sentences = (text) => plainText(text).split(/(?<=[.;])\s+(?=[A-Z(])/);

/** Reglas por patrones (sin LLM): siempre con la oración literal como cita. */
export function patternRules(text, url) {
  const out = [];
  for (const s of sentences(text)) for (const p of PATTERNS) if (p.rx.test(s)) out.push({ type: p.type, requirement: p.requirement, quote: s.trim(), url, method: 'patrón' });
  return dedupeRules(out);
}

/** Reglas desde los campos estructurados de Grants.gov (applicantTypes, awardCeiling, closeDate). */
export function structuredRules(opp) {
  const url = opp.url;
  const out = [];
  const types = (opp.applicantTypes || []).map((a) => (typeof a === 'string' ? a : a.description)).filter(Boolean);
  if (types.length) out.push({ type: 'entity_type', requirement: types, quote: `Eligible applicant types: ${types.join('; ')}`, url, method: 'official field' });
  if (Number(opp.awardCeiling) > 0) out.push({ type: 'budget_cap', requirement: Number(opp.awardCeiling), quote: `Award ceiling: ${opp.awardCeiling}`, url, method: 'official field' });
  if (opp.closeDate) out.push({ type: 'deadline', requirement: opp.closeDate, quote: `Close date: ${opp.closeDate}`, url, method: 'official field' });
  return out;
}

const RULE_SCHEMA = { type: 'object', properties: { rules: { type: 'array', items: { type: 'object', properties: { type: { type: 'string', enum: RULE_TYPES }, requirement: { type: 'string' }, quote: { type: 'string' } }, required: ['type', 'requirement', 'quote'] } } }, required: ['rules'] };
const RULE_SYSTEM = `You extract eligibility rules from an official call (NOFO). Reply only JSON.
Types: ${RULE_TYPES.join(', ')}. "requirement" in a few words (e.g. "not_allowed", "required", "small_business_concern", "US only").
"quote" is the sentence copied LITERALLY from the text. Don't infer unwritten rules.`;

/** Reglas con la flota (qwen-30b), verificadas literal; se suman a las de patrones. */
export async function llmRules(text, url, { env = process.env, fetcher = fetch } = {}) {
  if (!fleetConfig(env).roles.chat.ready) return [];
  const { json } = await chatJSON({ system: RULE_SYSTEM, user: plainText(text).slice(0, 30_000), schema: RULE_SCHEMA, name: 'reglas' }, { env, fetcher });
  return (json.rules || []).filter((r) => RULE_TYPES.includes(r.type) && quoteInPage(r.quote, text)).map((r) => ({ ...r, quote: plainText(r.quote), url, method: 'flota' }));
}

const dedupeRules = (rules) => [...new Map(rules.map((r) => [`${r.type}|${JSON.stringify(r.requirement)}`, r])).values()];
const val = (p, k) => p?.[k]?.value ?? null;

/** Evalúa una regla contra el perfil. */
export function evaluateRule(rule, profile, { today = new Date() } = {}) {
  const v = (verdict, why) => ({ ...rule, verdict, why });
  switch (rule.type) {
    case 'entity_type': {
      const types = (Array.isArray(rule.requirement) ? rule.requirement : [rule.requirement]).map((t) => String(t).toLowerCase()).filter(Boolean);
      const forProfit = val(profile, 'entityType') === 'for_profit';
      const small = val(profile, 'smallBusiness');
      if (types.some((t) => /^unrestricted|open to any type/.test(t))) return v('✔', 'No applicant-type restriction.');
      if (forProfit && types.some((t) => /for.profit organizations other than small businesses/.test(t))) return v('✔', 'Accepts for-profit companies (not small).');
      if (forProfit && types.some((t) => /small business/.test(t))) return small === true ? v('✔', 'Accepts small businesses and the profile says it is one.') : small === false ? (types.some((t) => /for.profit/.test(t)) ? v('✔', 'Accepts other for-profit companies.') : v('✖', 'Small businesses only, and the profile says it isn\'t.')) : v('?', 'Small businesses only: confirm whether IGC qualifies (SBA definition).');
      if (types.some((t) => /others \(see text/.test(t))) return v('?', 'Eligibility depends on additional call text.');
      if (forProfit) return v('✖', 'Listed applicant types exclude for-profit companies.');
      return v('?', 'Profile entity type unknown.');
    }
    case 'small_business': { const s = val(profile, 'smallBusiness'); return s === true ? v('✔', 'Profile indicates a small business.') : s === false ? v('✖', 'Requires a small business; the profile says it isn\'t.') : v('?', 'Requires a small business: missing from the profile.'); }
    case 'foreign_entity': { if (rule.requirement === 'allowed') return v('✔', 'Accepts foreign entities.'); const us = val(profile, 'usEntity'); return us === true ? v('✔', 'The applicant is US-based.') : us === false ? v('✖', 'No foreign entities.') : v('?', 'Applicant country missing.'); }
    case 'foreign_component': { if (rule.requirement === 'allowed') return v('✔', 'Allows foreign components.'); const f = val(profile, 'foreignComponent'); return f === false ? v('✔', 'All work would be in the US.') : f === true ? v('✖', 'No foreign work, and the plan includes Colombia/India/Canada.') : v('?', 'No foreign components: confirm where work will happen.'); }
    case 'pi_us': { const p = val(profile, 'piInUS'); return p === true ? v('✔', 'PI in the US.') : p === false ? v('✖', 'Requires a US-based PI.') : v('?', 'Confirm whether the PI is in the US.'); }
    case 'pi_employment': { const p = val(profile, 'piPrimaryEmployment'); return p === true ? v('✔', 'The PI is primarily employed by the company.') : p === false ? v('✖', 'Requires the PI\'s primary employment at the company.') : v('?', 'Confirm the PI\'s primary employment.'); }
    case 'ownership': { const o = val(profile, 'ownershipUS51'); return o === true ? v('✔', 'Meets ≥51% US ownership.') : o === false ? v('✖', 'Doesn\'t meet ≥51% US ownership.') : v('?', 'Ownership requirement: needs analysis for a public company (not legal advice).'); }
    case 'cost_sharing': { if (rule.requirement === 'not_required') return v('✔', 'No cost share required.'); const c = val(profile, 'canCostShare'); return c === true ? v('✔', 'Can cost-share.') : c === false ? v('✖', 'Requires cost share.') : v('?', 'Requires cost share: confirm whether IGC can.'); }
    case 'budget_cap': { const b = val(profile, 'requestedBudget'); return b == null ? v('✔', `Ceiling US$${Number(rule.requirement).toLocaleString('en-US')}; fit the budget to that ceiling.`) : b <= rule.requirement ? v('✔', 'Requested amount fits the ceiling.') : v('✖', 'Requested amount exceeds the ceiling.'); }
    case 'deadline': { const d = Date.parse(`${String(rule.requirement).slice(0, 10)}T23:59:59Z`); if (!Number.isFinite(d)) return v('?', 'Close date unreadable.'); const days = Math.floor((d - today.getTime()) / 86400000); return days < 0 ? v('✖', 'The call has closed.') : v('✔', `Closes in ${days} days.`); }
    default: return v('?', 'No automatic check for this rule: review manually.');
  }
}

/** Evaluación completa de una convocatoria. opp: {id, number, title, agency, url, closeDate, awardCeiling, applicantTypes, text} */
export async function evaluateOpportunity(opp, { profile = IGC_PROFILE, env = {}, fetcher = fetch, today = new Date(), useFleet = true } = {}) {
  const text = [opp.applicantEligibilityDesc, opp.text].filter(Boolean).join('\n');
  let rules = [...structuredRules(opp), ...patternRules(text, opp.url)];
  let method = 'official fields + patterns';
  if (useFleet && text) { try { const extra = await llmRules(text, opp.url, { env, fetcher }); if (extra.length) { rules = dedupeRules([...rules, ...extra]); method += ' + fleet'; } } catch (e) { method += ` (fleet unavailable: ${e.message})`; } }
  const evaluated = rules.map((r) => evaluateRule(r, profile, { today }));
  const eligibility = evaluated.filter((r) => r.type !== 'deadline' && r.type !== 'budget_cap');
  const verdict = !eligibility.length ? '?' : eligibility.some((r) => r.verdict === '✖') ? '✖' : eligibility.some((r) => r.verdict === '?') ? '?' : '✔';
  const deadline = evaluated.find((r) => r.type === 'deadline');
  const closed = deadline?.verdict === '✖';
  return { id: opp.id || opp.number, number: opp.number, title: opp.title, agency: opp.agency, url: opp.url, closeDate: opp.closeDate || null, awardCeiling: opp.awardCeiling || null, verdict: closed ? '✖' : verdict, closed, rules: evaluated, method, questions: [...new Set(evaluated.filter((r) => r.verdict === '?').map((r) => r.why))], evaluatedAt: today.toISOString() };
}

/** Convierte un lead de grant del pipeline actual (providers.grantLead) en convocatoria evaluable. */
export function opportunityFromLead(lead) {
  const elig = lead.evidence.filter((e) => e.field === 'eligibility').map((e) => e.quote);
  const url = lead.evidence[0]?.url;
  return { id: lead.externalId, number: lead.externalId, title: lead.title, agency: lead.org, url, closeDate: lead.deadline, awardCeiling: lead.amount, applicantTypes: elig[0] ? elig[0].split(/;\s*/) : [], applicantEligibilityDesc: elig.slice(1).join('\n') };
}

/** Alertas de plazo a 60, 30 y 7 días. */
export function deadlineAlerts(evals, { today = new Date(), marks = [60, 30, 7] } = {}) {
  return evals.filter((e) => e.closeDate && !e.closed).map((e) => {
    const days = Math.floor((Date.parse(`${String(e.closeDate).slice(0, 10)}T23:59:59Z`) - today.getTime()) / 86400000);
    const mark = [...marks].sort((a, b) => a - b).find((m) => days <= m) ?? null;
    return { id: e.id, title: e.title, closeDate: e.closeDate, days, verdict: e.verdict, alert: mark ? `≤ ${mark} days` : null, level: mark === 7 ? 'urgente' : mark === 30 ? 'pronto' : mark === 60 ? 'aviso' : 'lejano' };
  }).filter((a) => a.days >= 0).sort((a, b) => a.days - b.days);
}

/** Calendario ICS con alarmas a 60, 30 y 7 días (para importar en Google Calendar u Outlook). */
export function toICS(evals, { now = new Date() } = {}) {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const esc = (s) => String(s || '').replace(/[\\;,]/g, (m) => `\\${m}`).replace(/\n/g, '\\n');
  const events = evals.filter((e) => e.closeDate && !e.closed).map((e) => {
    const d = String(e.closeDate).slice(0, 10).replace(/-/g, '');
    return ['BEGIN:VEVENT', `UID:${esc(e.id)}@igc-outreach`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${d}`, `SUMMARY:${esc(`Closes ${e.number || ''} ${e.title}`.trim())} [${e.verdict}]`, `DESCRIPTION:${esc(`${e.agency || ''} · ${e.url || ''}`)}`, ...[60, 30, 7].flatMap((n) => ['BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(`Closes in ${n} days: ${e.title}`)}`, `TRIGGER:-P${n}D`, 'END:VALARM']), 'END:VEVENT'].join('\r\n');
  });
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//IGC Outreach//Grants//EN', ...events, 'END:VCALENDAR'].join('\r\n');
}

/** Exactitud del veredicto frente a etiquetas manuales (Módulo 5: 30 convocatorias revisadas). */
export function verdictAccuracy(evals, labels) {
  const by = new Map(evals.map((e) => [String(e.id), e.verdict]));
  const rows = labels.filter((l) => by.has(String(l.id)) && ['✔', '✖', '?'].includes(l.veredicto_manual));
  const ok = rows.filter((l) => by.get(String(l.id)) === l.veredicto_manual).length;
  const confusion = {};
  for (const l of rows) { const k = `${l.veredicto_manual}→${by.get(String(l.id))}`; confusion[k] = (confusion[k] || 0) + 1; }
  const falsePass = rows.filter((l) => l.veredicto_manual !== '✔' && by.get(String(l.id)) === '✔').length;
  return { n: rows.length, accuracy: rows.length ? ok / rows.length : null, confusion, falsePass, questionRate: rows.length ? rows.filter((l) => by.get(String(l.id)) === '?').length / rows.length : null };
}
