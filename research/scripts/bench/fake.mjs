/* Simulaciones para pruebas y para `bench-overnight.sh --dry`: un modelo «honesto» que lee el texto de la página y responde
   con citas literales (nunca inventa), lectores de páginas desde un mapa y un registro oficial falso.
   No hay red. Sirve para comprobar que el CÓDIGO (ranking, promoción, juez, auditoría, filtros, contactos) no pierde nada:
   la calidad real del modelo solo se mide con los túneles abiertos. */
import { datesIn } from '../../server/research/dates.mjs';
import { AGENT_CRITERIA } from '../../server/research/agentic/prompts.v14.mjs';

// El juez ve el texto aplanado (pageExcerpt): se parte por líneas, por frases y antes de cada «Etiqueta: ».
const lines = (t) => String(t || '').split(/\n+|(?<=[.!?])\s+(?=[A-Z])|\s+(?=[A-Z][A-Za-z]*(?: [a-z]+){0,4}: )/).map((l) => l.trim()).filter(Boolean);
const find = (t, re) => lines(t).find((l) => re.test(l)) || null;
const ESTIMATED = /\b(estimated|anticipated|forecast(ed)?|projected|tentative)\b/i;
const DEADLINE = /\b(close date|closing date|due date|due|deadline|applications? (?:are )?due|closes)\b/i;

/** Lectura honesta de una página: fechas de cierre por línea etiquetada, criterios con la línea que lo dice. */
export function honestRead(text, today, objective = 'grant') {
  const t = String(today).slice(0, 10);
  const dates = [];
  for (const l of lines(text)) {
    const found = datesIn(l); if (found.length !== 1) continue;
    if (DEADLINE.test(l)) dates.push({ role: 'application_deadline', date: found[0], estimated: ESTIMATED.test(l), quote: l });
    else if (/\b(posted|published|updated)\b/i.test(l)) dates.push({ role: 'posted', date: found[0], estimated: false, quote: l });
    else if (/\bopens?\b/i.test(l)) dates.push({ role: 'opens', date: found[0], estimated: ESTIMATED.test(l), quote: l });
  }
  const next = dates.filter((d) => d.role === 'application_deadline' && d.date >= t).sort((a, b) => a.date.localeCompare(b.date))[0];
  const past = dates.filter((d) => d.role === 'application_deadline' && d.date < t);
  const c = (re, why) => { const q = find(text, re); return q ? { verdict: 'yes', quote: q, reason: why } : { verdict: 'unknown', quote: null, reason: 'not stated' }; };
  const ids = AGENT_CRITERIA[objective] || AGENT_CRITERIA.grant;
  const all = {
    deadline: next ? { verdict: 'yes', quote: next.quote, reason: 'future deadline' } : past.length ? { verdict: 'no', quote: past[0].quote, reason: 'passed' } : { verdict: 'unknown', quote: null, reason: 'no date' },
    eligibility: c(/small business|for-profit|companies|eligible applicant|startups?/i, 'applicant type stated'),
    entity_type: c(/small business|for-profit|companies|startups?/i, 'entity type stated'),
    region: c(/United States|U\.S\.|Maryland|located in/i, 'location stated'),
    stage: { verdict: 'unknown', quote: null, reason: 'not stated' },
    topic_fit: c(/dementia|alzheimer|health|aging|medical|biomedical|life science|technology/i, 'topic stated'),
    non_dilutive: c(/\bgrants?\b|\bawards?\b|non-dilutive|funding opportunity/i, 'grant or award'),
    official: { verdict: 'yes', quote: lines(text)[0] || null, reason: 'publisher page' },
    recent_activity: c(/\b(invested|led|participated|portfolio|announced)\b/i, 'recent deal'),
    contact_route: c(/pitch|contact|apply|submit/i, 'route stated'),
  };
  const criteria = Object.fromEntries(ids.map((id) => [id, all[id] || { verdict: 'unknown', quote: null, reason: 'n/a' }]));
  const pageType = objective === 'grant' ? (dates.some((d) => d.role === 'application_deadline') ? (dates.every((d) => d.estimated) && dates.length ? 'forecast_notice' : 'call') : 'program_page') : 'investor_about';
  return { dates, criteria, pageType, about: lines(text)[0]?.slice(0, 280) || 'page' };
}

/** chat() falso con la misma firma que fleet.chatJSON. `pages`: Map url → texto (lo que se lee); si falta, usa el texto del prompt. */
export function honestChat({ today, objective = 'grant', calls = [] } = {}) {
  const textOf = (user) => { const m = String(user).match(/<page_data>\n([\s\S]*?)\n<\/page_data>/); const raw = m ? m[1] : ''; const tIdx = raw.indexOf('TEXT:\n'); return tIdx >= 0 ? raw.slice(tIdx + 6) : raw; };
  return async (req) => {
    calls.push(req.name);
    if (req.name === 'understand') return { json: { product_one_line: 'fixture', who_pays: '', sector: '', neighbor_sectors: [], stage: '', geography: '', assumptions: [], doubts: [] }, model: 'fake' };
    const text = textOf(req.user); const r = honestRead(text, today, objective);
    if (req.name === 'assess') {
      const ref = String(req.user.match(/Page ref: (\S+?)\./)?.[1] || 'p0');
      return { json: { ref, page_type: r.pageType, about: r.about, dates: r.dates, date_missing_next: null, criteria: r.criteria, candidate: r.pageType !== 'program_page' || objective !== 'grant', lead: null }, model: 'fake' };
    }
    return { json: { page_type: r.pageType, dates: r.dates, criteria: Object.fromEntries(Object.entries(r.criteria).map(([k, v]) => [k, { ...v, compiler: 'agree' }])) }, model: 'fake' };
  };
}

/** Lector falso para createTools({ readers: { open } }): devuelve el texto del mapa o una página genérica sin plazo. */
export const mapReader = (pages) => async (url) => {
  const p = pages.get(url); return { url, title: p?.title || 'Generic page', text: p?.text || `Generic page about funding news.\nThis page has no application information.` };
};

/** Registro falso con la forma de la respuesta de Simpler Grants (data[]). Busca por número exacto o por palabras del título. */
export const registryFetcher = (rows) => async (url, init) => {
  const body = JSON.parse(init?.body || '{}'); const q = String(body.query || body.keyword || body.oppNum || '').toLowerCase();
  const hit = rows.filter((r) => (r.opportunity_number || '').toLowerCase() === q || q.split(/\s+/).filter((w) => w.length > 3).some((w) => `${r.opportunity_title} ${r.summary?.summary_description || ''}`.toLowerCase().includes(w)));
  return { ok: true, json: async () => (url.includes('simpler') ? { data: hit } : { errorcode: 0, data: { oppHits: [] } }) };
};

/* ── Mundos de prueba (datos, no código): eval/gold/<caso>.json trae fecha, registro, páginas y la lista de referencia (gold).
   Así el código del motor y del banco no nombra financiadores; los nombres viven solo en los datos de evaluación. */
import { readFileSync } from 'node:fs';
export function loadWorld(path) {
  const w = JSON.parse(readFileSync(path, 'utf8'));
  return { ...w, pages: new Map(Object.entries(w.pages || {})), gold: (w.gold || []).map((g) => ({ ...g, re: new RegExp(g.match, 'i') })) };
}
/** Cobertura contra el gold: un elemento cuenta si algún hallazgo (título, URL o número) casa con su patrón; se anota su nivel y fecha. */
export function coverage(gold, findings) {
  return gold.map((g) => {
    const hit = findings.find((f) => g.re.test(`${f.title || ''} ${f.name || ''} ${f.url || ''} ${f.registry?.number || ''} ${f.externalId || ''}`));
    return { id: g.id, label: g.label, found: Boolean(hit), tier: hit?.tier || hit?.bucket || null, deadline: hit?.deadline || null, expected: g.deadline || null, dateOk: hit ? !g.deadline || hit.deadline === g.deadline : false, url: hit?.url || null };
  });
}
