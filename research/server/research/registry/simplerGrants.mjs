/* Registro federal de oportunidades de EE. UU. como HERRAMIENTA GENÉRICA del motor (no es una lista de financiadores):
     · Simpler Grants (api.simpler.grants.gov, sucesor de Grants.gov) si hay SIMPLER_GRANTS_API_KEY;
     · si no hay clave o falla, la API pública de Grants.gov (search2 + fetchOpportunity), sin clave.
   Sirve a dos consumidores:
     1. la fuente «Grants.gov» del pipeline: búsqueda con los campos del brief, solo posted/forecasted y tipo de solicitante compatible;
     2. el juez de Node: un número de aviso que GPT Researcher encontró (PA-27-100, RFA-XX-27-010…) se convierte en la oportunidad
        oficial con su fecha de cierre exacta.
   Cada oportunidad sale como una «página» de texto con etiquetas (Close date: January 5, 2027…) para que pase por el MISMO juez
   y la misma auditoría de citas que cualquier página web: el juez cita, el código comprueba la cita y la fecha.
   Formas de la API tomadas del código fuente de HHS/simpler-grants-gov (api/src/api/opportunities_v1/opportunity_schemas.py). */

const SIMPLER = 'https://api.simpler.grants.gov/v1/opportunities/search';
const LEGACY_SEARCH = 'https://api.grants.gov/v1/api/search2';
const LEGACY_FETCH = 'https://api.grants.gov/v1/api/fetchOpportunity';

/** Tipos de solicitante del registro (enum ApplicantType) compatibles con el tipo de entidad del brief. Genérico: no nombra agencias. */
export const APPLICANT_TYPES = {
  for_profit: ['small_businesses', 'for_profit_organizations_other_than_small_businesses'],
  nonprofit: ['nonprofits_non_higher_education_with_501c3', 'nonprofits_non_higher_education_without_501c3'],
  academic: ['public_and_state_institutions_of_higher_education', 'private_institutions_of_higher_education'],
  individual: ['individuals'],
};
const OPEN_TYPES = ['unrestricted', 'other'];
// Códigos heredados de Grants.gov para los mismos tipos (search2 → eligibilities).
const LEGACY_CODES = { small_businesses: '23', for_profit_organizations_other_than_small_businesses: '22', nonprofits_non_higher_education_with_501c3: '12', nonprofits_non_higher_education_without_501c3: '13', public_and_state_institutions_of_higher_education: '06', private_institutions_of_higher_education: '20', individuals: '21', unrestricted: '99', other: '25' };
const LEGACY_DESC = [[/small business/i, 'small_businesses'], [/for.profit/i, 'for_profit_organizations_other_than_small_businesses'], [/nonprofit/i, 'nonprofits_non_higher_education_with_501c3'], [/higher education/i, 'public_and_state_institutions_of_higher_education'], [/individual/i, 'individuals'], [/unrestricted/i, 'unrestricted'], [/^other/i, 'other']];

export const applicantTypesFor = (brief = {}) => APPLICANT_TYPES[String(brief.entityType || '').toLowerCase()] || null;
/** ¿El registro dice que este tipo de solicitante puede aplicar? Sin datos de tipo → no se descarta (lo decide el juez leyendo). */
export function applicantOk(types, brief) {
  const want = applicantTypesFor(brief); if (!want || !Array.isArray(types) || !types.length) return true;
  return types.some((t) => want.includes(t) || OPEN_TYPES.includes(t));
}

const iso = (v) => {
  if (!v) return null; const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); if (mdy) return `${mdy[3]}-${mdy[1].padStart(2, '0')}-${mdy[2].padStart(2, '0')}`;
  const t = Date.parse(s.replace(/\s+\d{1,2}:\d{2}(:\d{2})?\s*(AM|PM)?\s*[A-Z]{2,4}$/i, '')); return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null;
};
const longDate = (d) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : null);
const plain = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const usd = (n) => (Number(n) > 0 ? `$${Math.round(Number(n)).toLocaleString('en-US')}` : null);

/** Normaliza una oportunidad de Simpler Grants (OpportunityV1Schema). */
export function fromSimpler(o = {}) {
  const s = o.summary || {};
  return {
    source: 'simpler', id: o.opportunity_id || null, legacyId: o.legacy_opportunity_id || null, number: o.opportunity_number || null, title: plain(o.opportunity_title),
    agency: o.agency_name || o.top_level_agency_name || o.agency_code || null, agencyCode: o.agency_code || null, status: o.opportunity_status || null,
    isForecast: Boolean(s.is_forecast) || o.opportunity_status === 'forecasted',
    postDate: iso(s.post_date), closeDate: iso(s.close_date), closeDateText: plain(s.close_date_description),
    forecastClose: iso(s.forecasted_close_date), forecastCloseText: plain(s.forecasted_close_date_description), forecastPost: iso(s.forecasted_post_date),
    awardCeiling: s.award_ceiling ?? null, awardFloor: s.award_floor ?? null, applicantTypes: s.applicant_types || [],
    eligibilityText: plain(s.applicant_eligibility_description), description: plain(s.summary_description),
    moreInfoUrl: s.additional_info_url || null, contactEmail: s.agency_email_address || null, contactText: plain(s.agency_contact_description),
    url: o.opportunity_id ? `https://simpler.grants.gov/opportunity/${o.opportunity_id}` : null,
  };
}
/** Normaliza un resultado de la API pública de Grants.gov (search2 + fetchOpportunity opcional). */
export function fromLegacy(hit = {}, detail = null) {
  const syn = detail?.synopsis || {}; const fc = detail?.forecast || {};
  const forecast = String(hit.oppStatus || '').toLowerCase() === 'forecasted' || String(hit.docType || '').toLowerCase() === 'forecast';
  const types = (syn.applicantTypes || fc.applicantTypes || []).map((a) => LEGACY_DESC.find(([re]) => re.test(a.description || ''))?.[1]).filter(Boolean);
  return {
    source: 'grants.gov', id: null, legacyId: hit.id ? Number(hit.id) : null, number: hit.number || detail?.opportunityNumber || null, title: plain(hit.title || detail?.opportunityTitle),
    agency: hit.agency || hit.agencyName || syn.agencyName || hit.agencyCode || null, agencyCode: hit.agencyCode || null, status: String(hit.oppStatus || '').toLowerCase() || null, isForecast: forecast,
    postDate: iso(hit.openDate || syn.postingDate), closeDate: iso(forecast ? null : (syn.responseDate || hit.closeDate)), closeDateText: plain(syn.responseDateDesc),
    forecastClose: iso(fc.estApplicationResponseDate || (forecast ? hit.closeDate : null)), forecastCloseText: plain(fc.estApplicationResponseDateDesc), forecastPost: iso(fc.estSynopsisPostingDate),
    awardCeiling: Number(String(syn.awardCeiling || fc.awardCeiling || '').replace(/[^0-9.]/g, '')) || null, awardFloor: Number(String(syn.awardFloor || '').replace(/[^0-9.]/g, '')) || null,
    applicantTypes: [...new Set(types)], eligibilityText: plain(syn.applicantEligibilityDesc || fc.applicantEligibilityDesc), description: plain(syn.synopsisDesc || fc.forecastDesc),
    moreInfoUrl: syn.fundingDescLinkUrl || null, contactEmail: syn.agencyContactEmail || fc.agencyContactEmail || null, contactText: plain(syn.agencyContactName || fc.agencyContactName),
    url: hit.id ? `https://www.grants.gov/search-results-detail/${hit.id}` : null,
  };
}

/** Texto «página» de una oportunidad: cada fecha en su propia línea con su etiqueta, para que el juez la cite y el código la verifique. */
export function opportunityPage(o) {
  const lines = [
    `Official federal grants registry record (${o.source === 'simpler' ? 'Simpler.Grants.gov' : 'Grants.gov'}).`,
    `Opportunity title: ${o.title || 'not stated'}`,
    o.number ? `Funding opportunity number: ${o.number}` : null,
    o.agency ? `Agency: ${o.agency}` : null,
    `Opportunity status: ${o.isForecast ? 'Forecasted (applications not yet being accepted)' : o.status || 'unknown'}`,
    o.postDate ? `Posted date: ${longDate(o.postDate)}` : null,
    o.closeDate ? `Application close date: ${longDate(o.closeDate)}` : null,
    o.closeDateText ? `Close date explanation: ${o.closeDateText}` : null,
    o.forecastPost ? `Estimated post date: ${longDate(o.forecastPost)}` : null,
    o.forecastClose ? `Estimated application due date: ${longDate(o.forecastClose)}` : null,
    o.forecastCloseText ? `Estimated due date explanation: ${o.forecastCloseText}` : null,
    usd(o.awardCeiling) ? `Award ceiling: ${usd(o.awardCeiling)}` : null,
    usd(o.awardFloor) ? `Award floor: ${usd(o.awardFloor)}` : null,
    o.applicantTypes?.length ? `Eligible applicant types: ${o.applicantTypes.map((t) => t.replace(/_/g, ' ')).join('; ')}` : null,
    o.eligibilityText ? `Additional eligibility information: ${o.eligibilityText.slice(0, 2500)}` : null,
    o.description ? `Description: ${o.description.slice(0, 6000)}` : null,
    o.moreInfoUrl ? `More information: ${o.moreInfoUrl}` : null,
    o.contactText || o.contactEmail ? `Agency contact: ${[o.contactText, o.contactEmail].filter(Boolean).join(' · ')}` : null,
  ].filter(Boolean);
  return { url: o.url, title: [o.number, o.title].filter(Boolean).join(' · '), text: lines.join('\n'), registry: o };
}

const post = async (fetcher, url, body, { headers = {}, signal, timeoutMs = 15000 } = {}) => {
  const s = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
  const r = await fetcher(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers }, body: JSON.stringify(body), signal: s });
  if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json();
};

/** Una búsqueda en el registro. `query` libre o `number` exacto; `statuses` por defecto posted+forecasted. Devuelve oportunidades normalizadas. */
export async function searchRegistry({ query = '', number = '', applicantTypes = null, statuses = ['posted', 'forecasted'], size = 25 } = {}, { env = process.env, fetcher = fetch, signal, details = 8 } = {}) {
  const errors = [];
  if (env.SIMPLER_GRANTS_API_KEY) {
    try {
      const body = { query: number ? (/\s/.test(number) ? bare(number) : number) : query, query_operator: number ? 'AND' : 'OR', filters: { opportunity_status: { one_of: statuses }, ...(applicantTypes?.length && !number ? { applicant_type: { one_of: [...applicantTypes, ...OPEN_TYPES] } } : {}) },
        pagination: { page_offset: 1, page_size: Math.min(100, size), sort_order: [{ order_by: 'relevancy', sort_direction: 'descending' }] } };
      const data = await post(fetcher, env.SIMPLER_GRANTS_API_URL || SIMPLER, body, { headers: { 'X-API-Key': env.SIMPLER_GRANTS_API_KEY }, signal });
      const rows = (Array.isArray(data?.data) ? data.data : []).map(fromSimpler);
      return { via: 'simpler', rows: number ? rows.filter((o) => sameNumber(o.number, number)) : rows, errors };
    } catch (e) { if (signal?.aborted) throw e; errors.push(`simpler: ${e.message}`); }
  }
  try {
    const codes = (applicantTypes || []).map((t) => LEGACY_CODES[t]).filter(Boolean);
    const body = { oppStatuses: statuses.join('|'), rows: Math.min(50, size), ...(number ? { oppNum: /\s/.test(number) ? bare(number) : number } : { keyword: query }), ...(codes.length && !number ? { eligibilities: [...codes, '99', '25'].join('|') } : {}) };
    const data = await post(fetcher, LEGACY_SEARCH, body, { signal });
    if (data?.errorcode !== 0 || !Array.isArray(data?.data?.oppHits)) throw new Error(`invalid response${data?.msg ? `: ${String(data.msg).slice(0, 80)}` : ''}`);
    const hits = data.data.oppHits.filter((h) => !number || sameNumber(h.number, number));
    const rows = [];
    for (const [i, h] of hits.entries()) {
      let detail = null;
      if (i < details) { try { const d = await post(fetcher, LEGACY_FETCH, { opportunityId: Number(h.id) }, { signal }); if (d?.errorcode === 0) detail = d.data; } catch (e) { if (signal?.aborted) throw e; } }
      rows.push(fromLegacy(h, detail));
    }
    return { via: 'grants.gov', rows, errors };
  } catch (e) { if (signal?.aborted) throw e; errors.push(`grants.gov: ${e.message}`); return { via: 'none', rows: [], errors }; }
}
// «NSF 26-511» en una página y «26-511» en el registro: el prefijo separado por espacio es opcional.
const bare = (x) => String(x || '').toUpperCase().trim().replace(/^[A-Z]{1,5}\s+(?=\d)/, '').replace(/\s+/g, '');
const sameNumber = (a, b) => bare(a) === bare(b);

/** Números de aviso dentro de URLs o textos (PA-27-100, RFA-AG-27-010, HRSA-26-101, NSF 26-511). Patrón genérico «LETRAS-AA-NNN». */
export function noticeNumbers(texts = []) {
  const out = new Set();
  for (const raw of texts) {
    let t = String(raw || ''); try { t = decodeURIComponent(t); } catch { /* tal cual */ }
    for (const m of t.matchAll(/(?:^|[^A-Za-z0-9])([A-Z]{1,5}(?:-[A-Z]{2,4})?[- ]\d{2}-\d{3,4})(?![0-9])/gi)) out.add(m[1].toUpperCase());
  }
  return [...out];
}

/** ¿Sigue abierta según el registro? Cierre futuro, o pronóstico (fecha estimada futura o sin fecha), o abierta sin fecha de cierre (continua). */
export function stillOpen(o, today) {
  const t = String(today).slice(0, 10);
  if (o.isForecast) return !o.forecastClose || o.forecastClose >= t;
  if (o.closeDate) return o.closeDate >= t;
  return o.status === 'posted';
}

/** Oportunidades del registro listas para el juez: búsquedas con el brief + números de aviso hallados por otro motor. */
export async function registrySeeds({ brief = {}, queries = [], numbers = [], today, env = process.env, fetcher = fetch, signal, max = Number(env.REGISTRY_SEEDS_MAX) || 15, log = () => {} } = {}) {
  const types = applicantTypesFor(brief); const t = String(today || new Date().toISOString()).slice(0, 10);
  const seen = new Map(); const stats = { queries: 0, numbers: 0, returned: 0, kept: 0, closed: 0, notEligible: 0, via: new Set(), errors: [] };
  const add = (o, why) => {
    const key = (o.number || o.url || o.title || '').toUpperCase(); if (!key || seen.has(key)) return;
    if (!stillOpen(o, t)) { stats.closed++; return; }
    if (!applicantOk(o.applicantTypes, brief)) { stats.notEligible++; return; }
    seen.set(key, { ...opportunityPage(o), why });
  };
  for (const number of numbers.slice(0, 12)) {
    stats.numbers++; const r = await searchRegistry({ number, statuses: ['posted', 'forecasted'] }, { env, fetcher, signal, details: 2 });
    r.errors.forEach((e) => stats.errors.push(e)); stats.via.add(r.via); stats.returned += r.rows.length; r.rows.forEach((o) => add(o, `number:${number}`));
  }
  for (const query of [...new Set(queries.map((q) => String(q || '').trim()).filter((q) => q.length >= 3))].slice(0, 6)) {
    stats.queries++; const r = await searchRegistry({ query, applicantTypes: types }, { env, fetcher, signal, details: 6 });
    r.errors.forEach((e) => stats.errors.push(e)); stats.via.add(r.via); stats.returned += r.rows.length;
    for (const o of r.rows.slice(0, 10)) add(o, `query:${query}`);
  }
  const seeds = [...seen.values()];
  // Primero lo que otro motor ya encontró por número; luego por relevancia, sin dejar que una sola agencia llene el cupo.
  const byNumber = seeds.filter((s) => s.why.startsWith('number:')); const rest = seeds.filter((s) => !s.why.startsWith('number:'));
  const per = new Map(); const picked = [...byNumber];
  for (const s of rest) { const a = s.registry.agencyCode || s.registry.agency || '?'; if ((per.get(a) || 0) >= 4) continue; per.set(a, (per.get(a) || 0) + 1); picked.push(s); }
  stats.kept = Math.min(max, picked.length); stats.via = [...stats.via].filter((v) => v && v !== 'none');
  log(`registro: ${stats.queries} búsquedas + ${stats.numbers} números → ${stats.returned} oportunidades, ${stats.closed} cerradas, ${stats.notEligible} no elegibles por tipo de solicitante, ${stats.kept} al juez (vía ${stats.via.join('+') || 'ninguna'})${stats.errors.length ? ` · errores: ${stats.errors.slice(0, 2).join(' | ')}` : ''}`);
  return { seeds: picked.slice(0, max), stats };
}

/** Consultas para el registro hechas solo con el brief (y los términos que ya expandió el plan): frases cortas, sin agencias. */
export function registryQueries(brief = {}, plan = null) {
  const short = (s, n = 6) => String(s || '').replace(/[^\p{L}\p{N}\s-]/gu, ' ').split(/\s+/).filter((w) => w.length > 2 && !/^(the|and|for|that|with|from|this|tells|tool|patient|develop|suggest|goal|serve|people)$/i.test(w)).slice(0, n).join(' ');
  return [...new Set([
    plan?.topic, ...(plan?.terms || []).map((t) => t.term),
    short(brief.oneLiner, 5), short(brief.product, 4), short(brief.description, 5), brief.industry,
    ...String(brief.criteria || '').split(/[,;\n]/),
  ].map((q) => String(q || '').trim()).filter((q) => q.length >= 3))].slice(0, 6);
}
