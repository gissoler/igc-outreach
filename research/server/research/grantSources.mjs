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
let catalog = null;
export const loadPortals = (path = new URL('./grantPortals.json', import.meta.url)) => (catalog ||= JSON.parse(readFileSync(path, 'utf8')));
export const resetPortals = () => { catalog = null; };
const sameName = (a, b) => norm(a) === norm(b);
/** Portales aplicables a la jurisdicción del brief: nacionales del país + estatales/regionales del estado indicado (+ ciudad). Coincidencia por nombre normalizado o código, no por palabras sueltas. */
export function portalsFor(brief, portals = loadPortals()) {
  const country = clean(brief.country); const state = clean(brief.state); const city = clean(brief.city);
  if (!country && !state && !city) return [];
  return portals.filter((p) => {
    const inCountry = !country || [p.country, ...(p.countryNames || [])].some((n) => sameName(n, country));
    if (!inCountry) return false;
    if (p.scope === 'country') return true;
    if (p.scope === 'state') return Boolean(state) && [p.state, ...(p.stateCodes || [])].some((n) => sameName(n, state));
    if (p.scope === 'city') return Boolean(city) && sameName(p.city, city);
    return false;
  });
}
export const portalSeeds = (brief, portals) => portalsFor(brief, portals).map((p) => ({ url: p.url, title: p.name, description: p.notes || '', markdown: '', providers: ['portal-catalog'], family: 'portal', seed: 'portal-catalog' }));
