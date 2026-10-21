/* ────────────────────────────────────────────────────────────────────────
   Fuentes de grants más allá de «buscar palabras en Grants.gov»:
     · NIH RePORTER como INTELIGENCIA: proyectos parecidos ya financiados → aviso (NOFO) de origen → ese aviso se busca en Grants.gov
       y entra al mismo motor de lectura; además, montos típicos, tipos de organización e institutos que financian.
     · NSF Awards: premios parecidos → programas que los financian → se buscan como convocatorias.
     · SBIR.gov: solicitudes abiertas (aplica a empresas con fines de lucro).
     · Jurisdicción: catálogo de portales estatales/regionales/nacionales → páginas índice que el motor recorre (snowball).
   Regla de siempre: aquí solo se traen datos y se cuentan; qué convocatoria sirve y a quién, lo lee y decide el modelo en el motor.
   Formas de API tomadas de la documentación; NO probadas en vivo (por eso todo falla en silencio y queda en el audit).
   ──────────────────────────────────────────────────────────────────────── */
import { readFileSync } from 'node:fs';
import { candidate, evidence, norm, safeUrl } from './core.mjs';

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const median = (xs) => { const a = xs.filter((x) => Number.isFinite(x) && x > 0).sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : null; };
const tally = (items) => { const m = new Map(); for (const i of items.map(clean).filter(Boolean)) m.set(i, (m.get(i) || 0) + 1); return [...m].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })); };
const usd = (n) => (n ? `$${Math.round(n).toLocaleString('en-US')}` : null);

/** Identificadores de avisos (PA-25-301, PAR-24-123, RFA-AG-26-005): se extraen como identificador, no se interpreta nada. */
const FOA_ID = /\b(?:PAR|RFA|PA|NOT|OTA)-(?:[A-Z]{2,4}-)?\d{2}-\d{2,4}\b/gi;
export const foaIdsIn = (value) => [...new Set((String(value || '').match(FOA_ID) || []).map((x) => x.toUpperCase()))];

/** Códigos de solicitante de Grants.gov por tipo de organización del brief (filtro estructurado; el modelo decide la elegibilidad real al leer). */
export const ELIGIBILITY_CODES = { for_profit: '22|23', nonprofit: '12|13', academic: '06|20' };
export const eligibilityFilter = (brief) => ELIGIBILITY_CODES[brief.entityType] || null;

/** Una búsqueda en Grants.gov; si el filtro no es aceptado, se repite sin él (la forma exacta del filtro no está probada en vivo). */
export async function grantsGovSearch(client, body, { emit = () => {} } = {}) {
  const base = { oppStatuses: 'posted|forecasted', rows: 15, ...body };
  const ask = async (b) => { const r = await client.json('https://api.grants.gov/v1/api/search2', b); if (r.errorcode !== 0 || !Array.isArray(r.data?.oppHits)) throw new Error(`invalid response${r.msg ? `: ${String(r.msg).slice(0, 80)}` : ''}`); return r.data.oppHits; };
  const filters = ['eligibilities', 'agencies', 'aln', 'fundingCategories', 'fundingInstruments'].filter((k) => base[k]);
  try { return { hits: await ask(base), filtered: filters.length > 0, filters }; } catch (e) {
    if (!filters.length) throw e;
    emit('warning', `Grants.gov: the filter (${filters.join(', ')}) was not accepted (${e.message}); searching without it.`);
    const plain = { ...base }; for (const k of filters) delete plain[k];
    return { hits: await ask(plain), filtered: false, filters: [], fellBack: true };
  }
}

/**
 * Simpler.Grants.gov adapter. The official API uses UUIDs and snake_case while
 * the existing pipeline expects the compact Grants.gov hit shape. Keep the
 * translation here so ranking, evidence and eligibility remain source-agnostic.
 */
const simplerDate = (value) => {
  const match = String(value || '').match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
};
// V15 · En la API v1 de Simpler los campos de la convocatoria vienen ANIDADOS en `summary` (objeto): summary_description,
// applicant_types (enum como small_businesses), applicant_eligibility_description, close_date, award_ceiling… Antes se leía
// row.summary como texto y quedaba «[object Object]»: la ficha llegaba al juez sin alcance ni requisitos.
const summaryOf = (row) => (row?.summary && typeof row.summary === 'object' ? row.summary : {});
const simplerApplicantTypes = (row) => {
  const values = summaryOf(row).applicant_types || row?.applicant_types || row?.applicantTypes || row?.current_opportunity_summary?.applicant_types || [];
  return (Array.isArray(values) ? values : []).map((value) => ({ description: clean(value?.description || value?.applicant_type || value) })).filter((value) => value.description);
};
export function simplerOpportunity(row) {
  const id = clean(row?.opportunity_id || row?.opportunityId);
  if (!id) return null;
  const number = clean(row?.opportunity_number || row?.opportunityNumber) || id;
  const title = clean(row?.opportunity_title || row?.opportunityTitle) || number;
  const agency = clean(row?.agency_name || row?.agencyName || row?.agency_code || row?.agencyCode) || 'Federal agency';
  const status = clean(row?.opportunity_status || row?.opportunityStatus).toLowerCase();
  const sum = summaryOf(row);
  const summary = clean((typeof row?.summary === 'string' ? row.summary : '') || sum.summary_description || row?.description || row?.synopsis || row?.opportunity_summary?.summary_description).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const eligibility = clean(sum.applicant_eligibility_description || row?.applicant_eligibility_description || row?.applicantEligibilityDescription).replace(/<[^>]+>/g, ' ');
  const hit = {
    id,
    number,
    title,
    agency,
    oppStatus: status,
    closeDate: simplerDate(sum.close_date || row?.close_date || row?.closeDate),
    forecastCloseDate: simplerDate(sum.forecasted_close_date),
    url: `https://simpler.grants.gov/opportunity/${id}`,
    provider: 'Simpler.Grants.gov',
  };
  const detail = {
    synopsis: {
      synopsisDesc: summary,
      applicantTypes: simplerApplicantTypes(row),
      applicantEligibilityDesc: eligibility,
      awardCeiling: Number(sum.award_ceiling ?? row?.award_ceiling ?? row?.awardCeiling) || null,
      awardFloor: Number(sum.award_floor ?? row?.award_floor ?? row?.awardFloor) || null,
      agencyName: agency,
      fundingDescLinkUrl: safeUrl(clean(sum.additional_info_url || row?.additional_info_url || row?.additionalInfoUrl)) || null,
      forecastedCloseDate: simplerDate(sum.forecasted_close_date) || null,
    },
    cfdas: (row?.assistance_listings || row?.assistanceListings || []).map((item) => ({
      cfdaNumber: clean(item?.assistance_listing_number || item?.program_number || item?.number || item),
      programTitle: clean(item?.program_title || item?.title),
    })).filter((item) => item.cfdaNumber),
  };
  return { hit, detail };
}

export async function simplerGrantsSearch(client, body, { apiKey, emit = () => {} } = {}) {
  if (!apiKey) throw new Error('SIMPLER_GRANTS_API_KEY is not configured');
  const query = clean(body?.keyword || body?.oppNum).slice(0, 100);
  const payload = {
    ...(query ? { query } : {}),
    query_operator: 'AND',
    filters: { opportunity_status: { one_of: ['posted', 'forecasted'] } },
    pagination: {
      page_offset: 1,
      page_size: Math.min(100, Math.max(1, Number(body?.rows) || 15)),
      sort_order: [{ order_by: query ? 'relevancy' : 'close_date', sort_direction: query ? 'descending' : 'ascending' }],
    },
  };
  const data = await client.json('https://api.simpler.grants.gov/v1/opportunities/search', payload, { 'X-API-Key': apiKey });
  if (!Array.isArray(data?.data)) throw new Error(`invalid response${data?.message ? `: ${clean(data.message).slice(0, 80)}` : ''}`);
  const rows = data.data.map(simplerOpportunity).filter(Boolean);
  emit('searching', `Simpler.Grants.gov: ${rows.length} official opportunities returned.`);
  return { hits: rows.map(({ hit, detail }) => ({ ...hit, _simplerDetail: detail })), filtered: true, filters: ['opportunity_status'] };
}

/* ── NIH RePORTER como inteligencia ─────────────────────────────────── */
export async function reporterIntel(client, brief, plan, { years = 3, limit = 50 } = {}) {
  const now = new Date().getFullYear();
  const data = await client.json('https://api.reporter.nih.gov/v2/projects/search', {
    criteria: { advanced_text_search: { operator: 'and', search_field: 'projecttitle,abstracttext', search_text: plan.query }, use_relevance: true, fiscal_years: Array.from({ length: years }, (_, i) => now - i) },
    limit, offset: 0,
  });
  if (!Array.isArray(data.results)) throw new Error('NIH RePORTER: unexpected format.');
  const rows = data.results;
  const foas = new Map();
  for (const p of rows) {
    // Campo del aviso: varía de nombre entre versiones; se miran los campos de texto cortos (no el resumen) en busca de identificadores.
    const hay = Object.entries(p).filter(([k, v]) => typeof v === 'string' && !/abstract|terms|title|phr/i.test(k)).map(([, v]) => v).join(' ');
    for (const id of foaIdsIn(`${p.full_foa || ''} ${p.foa || ''} ${p.opportunity_number || ''} ${hay}`)) {
      const e = foas.get(id) || { id, projects: 0, amounts: [], orgs: [], orgTypes: [], institutes: [], officers: [], titles: [] };
      e.projects++; e.amounts.push(Number(p.award_amount)); e.orgs.push(p.organization?.org_name); e.orgTypes.push(p.organization?.org_type_name || p.organization?.org_type);
      e.institutes.push(p.agency_ic_admin?.name || p.agency_ic_admin?.abbreviation); e.officers.push(...(p.program_officers || []).map((o) => o.full_name)); e.titles.push(p.project_title);
      foas.set(id, e);
    }
  }
  const all = { n: rows.length, medianAward: median(rows.map((p) => Number(p.award_amount))), orgTypes: tally(rows.map((p) => p.organization?.org_type_name || p.organization?.org_type)).slice(0, 5), institutes: tally(rows.map((p) => p.agency_ic_admin?.name || p.agency_ic_admin?.abbreviation)).slice(0, 5), officers: tally(rows.flatMap((p) => (p.program_officers || []).map((o) => o.full_name))).slice(0, 5) };
  const notices = [...foas.values()].sort((a, b) => b.projects - a.projects).map((e) => ({ id: e.id, projects: e.projects, medianAward: median(e.amounts), orgTypes: tally(e.orgTypes).slice(0, 3), institutes: tally(e.institutes).slice(0, 2), officers: tally(e.officers).slice(0, 2), example: e.titles[0] || null }));
  return { all, notices };
}

/* ── NSF Awards: premios parecidos → programas ──────────────────────── */
export async function nsfIntel(client, plan, { limit = 25, years = 3 } = {}) {
  const since = new Date(); since.setFullYear(since.getFullYear() - years);
  const mdy = `${String(since.getMonth() + 1).padStart(2, '0')}/${String(since.getDate()).padStart(2, '0')}/${since.getFullYear()}`;
  const q = new URLSearchParams({ keyword: plan.query, printFields: 'id,title,fundProgramName,awardeeName,fundsObligatedAmt,startDate', rpp: String(limit), dateStart: mdy });
  const data = await client.json(`https://api.nsf.gov/services/v1/awards.json?${q}`);
  const awards = data?.response?.award;
  if (!Array.isArray(awards)) throw new Error('NSF Awards: unexpected format.');
  return { n: awards.length, medianAward: median(awards.map((a) => Number(a.fundsObligatedAmt))), programs: tally(awards.map((a) => a.fundProgramName)).slice(0, 6), awardees: tally(awards.map((a) => a.awardeeName)).slice(0, 5) };
}

/** Inteligencia completa de una corrida de grants; nunca rompe la búsqueda: cada pieza falla por separado. */
export async function grantIntel(client, brief, plan, { emit = () => {}, reporter = reporterIntel, nsf = nsfIntel, env = process.env } = {}) {
  const out = { reporter: null, nsf: null, errors: [] };
  if (env.GRANT_INTEL === 'off') return { ...out, off: true };
  await Promise.all([
    (async () => { try { out.reporter = await reporter(client, brief, plan); emit('searching', `NIH RePORTER: ${out.reporter.all.n} similar funded projects, ${out.reporter.notices.length} funding notices behind them.`); } catch (e) { out.errors.push(`NIH RePORTER: ${e.message}`); } })(),
    (async () => { try { out.nsf = await nsf(client, plan); emit('searching', `NSF Awards: ${out.nsf.n} similar awards, ${out.nsf.programs.length} programs.`); } catch (e) { out.errors.push(`NSF Awards: ${e.message}`); } })(),
  ]);
  return out;
}

/** Consultas extra para Grants.gov a partir de la inteligencia: avisos por número (los 6 más repetidos) y programas de la NSF. */
export function intelQueries(intel, { maxNotices = 6, maxPrograms = 4 } = {}) {
  const q = [];
  for (const n of (intel?.reporter?.notices || []).slice(0, maxNotices)) q.push({ query: n.id, body: { oppNum: n.id, oppStatuses: 'posted|forecasted' }, dimension: 'funded-similar', label: `NOFO ${n.id}`, intel: { type: 'notice', ...n } });
  for (const p of (intel?.nsf?.programs || []).slice(0, maxPrograms)) q.push({ query: p.name, dimension: 'nsf-program', label: p.name, intel: { type: 'nsf-program', ...p } });
  return q;
}

/** Texto de inteligencia de una convocatoria (para mostrarlo junto a la evidencia): lo que se financió con ese aviso. */
export function intelNote(intel) {
  if (!intel) return null;
  if (intel.type === 'notice') return `NIH RePORTER: ${intel.projects} funded project(s) similar to this brief came from this notice${intel.medianAward ? `; median award ${usd(intel.medianAward)}` : ''}${intel.orgTypes?.length ? `; organization types: ${intel.orgTypes.map((x) => `${x.name} (${x.count})`).join(', ')}` : ''}${intel.institutes?.length ? `; institute: ${intel.institutes.map((x) => x.name).join(', ')}` : ''}${intel.officers?.length ? `; program officer on those awards: ${intel.officers.map((x) => x.name).join(', ')}` : ''}.`;
  if (intel.type === 'nsf-program') return `NSF Awards: ${intel.count} similar award(s) were funded under the program "${intel.name}".`;
  return null;
}

/* ── SBIR.gov ───────────────────────────────────────────────────────── */
const toIso = (s) => { const t = clean(s); let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t); if (m) return `${m[1]}-${m[2]}-${m[3]}`; m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(t); return m ? `${m[3]}-${m[1]}-${m[2]}` : null; };
export function sbirLeads(data) {
  const list = Array.isArray(data) ? data : Array.isArray(data?.results) ? data.results : Array.isArray(data?.solicitations) ? data.solicitations : null;
  if (!list) throw new Error('SBIR.gov: unexpected format.');
  return list.filter((s) => s && (s.solicitation_title || s.solicitation_number)).map((s) => {
    const url = safeUrl(clean(s.solicitation_agency_url)) || `https://www.sbir.gov/solicitations`;
    const official = safeUrl(clean(s.solicitation_agency_url));
    const close = toIso(s.close_date) || toIso(s.application_due_date);
    const topics = (s.solicitation_topics || []).slice(0, 12).map((t) => `${clean(t.topic_number)} ${clean(t.topic_title)}`.trim()).filter(Boolean);
    const number = clean(s.solicitation_number) || clean(s.solicitation_title);
    const ev = [evidence('SBIR.gov', url, clean(s.solicitation_title) || number, 'opportunity'), evidence('SBIR.gov', url, JSON.stringify({ agency: s.agency, status: s.current_status, closeDate: s.close_date, number }), 'registry')];
    if (topics.length) ev.push(evidence('SBIR.gov', url, `Topics: ${topics.join(' | ')}`.slice(0, 1000), 'scope'));
    return candidate({
      externalId: number, org: clean(s.agency) || 'SBIR', title: clean(s.solicitation_title) || number, kind: 'opportunity', fundingType: 'grant',
      status: /open/i.test(s.current_status || '') ? 'open' : 'unknown', deadline: close,
      contact: { type: 'source', value: url, provenance: 'Official SBIR.gov solicitation; check the agency page' },
      evidence: ev, risks: ['Eligibility requires checking small-business status, ownership and where the work is done'], missing: ['Fit to the project to be read from the solicitation'],
      searchText: `${s.solicitation_title} ${topics.join(' ')}`.slice(0, 4000), facts: { ...(official ? { officialUrl: official } : {}), agency: s.agency, program: s.program },
    });
  });
}
export async function sbir(client, brief, plan, { emit = () => {}, max = 12 } = {}) {
  if (brief.entityType && brief.entityType !== 'for_profit') return [];   // SBIR/STTR: empresas con fines de lucro
  const terms = [...new Set([plan.topic, ...(plan.terms || []).map((t) => t.term)].filter(Boolean))].slice(0, 3);
  const calls = [`open=1&rows=25`, ...terms.map((t) => `open=1&rows=25&keyword=${encodeURIComponent(t)}`)];
  const seen = new Map(); const errors = [];
  for (const qs of calls) {
    try { for (const l of sbirLeads(await client.json(`https://api.www.sbir.gov/public/api/solicitations?${qs}`))) if (!seen.has(l.externalId)) seen.set(l.externalId, l); } catch (e) { errors.push(e.message); }
  }
  if (!seen.size && errors.length) throw new Error(errors[0]);
  emit('searching', `SBIR.gov: ${seen.size} open solicitations.`);
  return [...seen.values()].slice(0, max);
}

/* ── Jurisdicción: catálogo de portales ─────────────────────────────── */
let catalog = null; let rhtpCatalog = null;
export const loadPortals = (path = new URL('./grantPortals.json', import.meta.url)) => (catalog ||= JSON.parse(readFileSync(path, 'utf8')));
export const loadRhtpStateSources = (path = new URL('./rhtpStateSources.json', import.meta.url)) => {
  if (rhtpCatalog) return rhtpCatalog;
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  const priority = new Map((raw.priority?.states || []).map((state, index) => [norm(state), index]));
  rhtpCatalog = (raw.sources || []).map((source) => ({
    scope: 'state', country: 'United States', countryNames: ['US', 'USA', 'United States of America', 'Estados Unidos'],
    state: source.state, stateCodes: [source.stateCode], name: `${source.state} Rural Health Transformation Program`, url: source.url,
    program: 'RHTP', catalog: raw.schema, topics: ['rural health transformation program', 'rhtp'],
    notes: 'State RHTP source page. Verify the current solicitation status, deadline and eligibility on the live page.',
    source: { ...raw.source, row: source.sourceRow }, seedPriority: priority.has(norm(source.state)) ? priority.get(norm(source.state)) : 100 + source.sourceRow,
  })).sort((a, b) => a.seedPriority - b.seedPriority);
  return rhtpCatalog;
};
export const resetPortals = () => { catalog = null; rhtpCatalog = null; };
const sameName = (a, b) => norm(a) === norm(b);
/** Portales aplicables a la jurisdicción del brief: nacionales del país + estatales/regionales del estado indicado (+ ciudad). Coincidencia por nombre normalizado o código, no por palabras sueltas. */
const US_RX = /\b(?:u\.?s\.?a?|united states|estados unidos)\b/i;
const RHTP_RX = /\b(?:rhtp|rural health transformation(?: program)?)\b/i;
/** Texto del brief sobre el que se comparan los temas de un portal (minúsculas). */
const briefTopicText = (brief) => [brief.industry, brief.searchTerms, brief.targetPopulation, brief.product, brief.description, brief.oneLiner, brief.useOfFunds, brief.company].map(clean).join(' ').toLowerCase();
/** Condiciones opcionales de un portal: entityTypes (si el brief declara tipo de entidad, debe estar en la lista) y topics (algún término en el brief). */
function portalApplies(p, brief) {
  if (p.entityTypes?.length && brief.entityType && !p.entityTypes.includes(brief.entityType)) return false;
  if (p.topics?.length) { const text = briefTopicText(brief); if (!p.topics.some((t) => text.includes(t))) return false; }
  return true;
}
export function portalsFor(brief, portals = loadPortals(), rhtpSources = loadRhtpStateSources()) {
  // Sin país explícito, un brief que dice estar en EE. UU. (geografía o domicilio) usa los portales de ese país.
  const country = clean(brief.country) || (US_RX.test(`${brief.geography || ''} ${brief.domicile || ''}`) ? 'United States' : '');
  const state = clean(brief.state); const city = clean(brief.city);
  if (!country && !state && !city) return [];
  const wantsRhtp = RHTP_RX.test(briefTopicText(brief));
  const available = wantsRhtp ? [...portals, ...rhtpSources] : portals;
  return available.filter((p) => {
    if (!portalApplies(p, brief)) return false;
    const inCountry = !country || [p.country, ...(p.countryNames || [])].some((n) => sameName(n, country));
    if (!inCountry) return false;
    if (p.scope === 'country') return true;
    if (p.scope === 'state') {
      if (p.program === 'RHTP' && wantsRhtp && !state) return true;
      return Boolean(state) && [p.state, ...(p.stateCodes || [])].some((n) => sameName(n, state));
    }
    if (p.scope === 'city') return Boolean(city) && sameName(p.city, city);
    return false;
  });
}
export const portalSeeds = (brief, portals, rhtpSources) => portalsFor(brief, portals, rhtpSources).map((p) => ({ url: p.url, title: p.name, description: p.notes || '', markdown: '', providers: ['portal-catalog'], family: 'portal', seed: p.catalog || 'portal-catalog', ...(p.source ? { source: p.source } : {}) }));
