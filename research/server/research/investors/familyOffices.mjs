/* ─────────────────────────────────────────────────────────────────────────────
   V16 · Inversionistas · Family offices como fuente propia.
   Por qué: invierten directo, rara vez salen en listas de VC y casi nunca publican una tesis. Con solo 3 consultas al final de
   investorQueries (recortables por el tope de 15) y la regla «sin tesis → descarte», el embudo no los retenía. Aquí:
     · consultas web dedicadas (sitio propio, portafolio, rondas donde participaron), escritas por el código desde el brief;
     · SEC EDGAR (búsqueda de texto completo, Form D y 13F-HR de los últimos dos años): nombres de filers que se presentan como
       family office. Sin filtro de sector (EDGAR no lo permite): el expediente decide. Requiere SEC_USER_AGENT;
     · Apollo: organizaciones con la etiqueta «family office» (en el país del solicitante si el brief lo confirma). Una pista.
   La prueba de encaje de un family office sin tesis es una INVERSIÓN DIRECTA citada en el sector (evidence.mjs → deals).
   Funciones puras salvo edgarFamilyOffices y apolloFamilyOffices (red inyectada).
   ───────────────────────────────────────────────────────────────────────────── */
import { queryTerms } from './sector.mjs';

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
/** La organización se presenta como family office (frase o nombre). */
export const FAMILY_OFFICE = /\b(?:(?:single|multi)[- ]family offices?|family offices?|family investment offices?|private investment offices?|family capital)\b/i;
/** Etiqueta de dominio o nombre compacto de family office («smithfamilyoffice», «waltonfamilycapital»). */
export const FAMILY_OFFICE_LABEL = /family.?(?:offices?|capital|investments?)/i;
export const isFamilyOfficeName = (name) => FAMILY_OFFICE.test(String(name || '')) || FAMILY_OFFICE_LABEL.test(String(name || '').replace(/[^A-Za-z]/g, ''));

/** Consultas dedicadas: su sitio y portafolio, y las rondas donde participaron (los nombres salen de esas noticias). */
export function familyOfficeQueries(brief = {}, { n = 4, country = null } = {}) {
  const { t1, p1 } = queryTerms(brief);
  const out = [
    p1 && `single family office direct investments ${p1} startups`,
    t1 && `${t1} round with participation from family office`,
    p1 && `${p1} family office portfolio companies`,
    country && p1 && `family offices in ${country} investing in ${p1}`,
    t1 && `family office venture investments ${t1}`,
  ];
  const seen = new Set();
  return out.filter(Boolean).map(clean).filter((q) => { const k = q.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, n);
}

const titleCase = (s) => (/[a-z]/.test(s) ? s : s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\b(Llc|Lp|Llp|Inc|Ltd)\b/g, (m) => m.toUpperCase()));
const shiftYears = (day, years) => { const d = new Date(`${day}T00:00:00Z`); d.setUTCFullYear(d.getUTCFullYear() + years); return d.toISOString().slice(0, 10); };

/**
 * SEC EDGAR: filers de Form D / 13F-HR (dos años hasta `today`) cuyo texto dice «family office» y cuyo NOMBRE suena a familia.
 * → { names: [{ name, form, filed, states, from }], query, hits, reason }. Sin SEC_USER_AGENT, fetcher o fecha no llama (reason).
 */
export async function edgarFamilyOffices({ fetcher, env = process.env, today, signal, n = 4 } = {}) {
  const ua = clean(env.SEC_USER_AGENT); const end = String(today || '').slice(0, 10);
  const reason = !ua ? 'no_sec_user_agent' : typeof fetcher !== 'function' ? 'no_fetcher' : !/^\d{4}-\d{2}-\d{2}$/.test(end) ? 'no_today' : null;
  if (reason) return { names: [], query: null, hits: 0, reason };
  const params = { q: '"family office"', forms: 'D,13F-HR', dateRange: 'custom', startdt: shiftYears(end, -2), enddt: end };
  const r = await fetcher(`https://efts.sec.gov/LATEST/search-index?${new URLSearchParams(params)}`, { headers: { Accept: 'application/json', 'User-Agent': ua }, signal: signal || AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`SEC EDGAR HTTP ${r.status}`);
  const hits = (await r.json())?.hits?.hits || []; const seen = new Set(); const names = [];
  for (const h of hits) {
    const src = h?._source || {};
    for (const raw of src.display_names || []) {
      const cik = (String(raw).match(/\(CIK\s*0*(\d+)\)/i) || [])[1] || null;
      // Sin sufijo legal: se resuelve con «"Nombre" family office» y «, LLC» entre comillas no aparece en su sitio.
      const name = titleCase(clean(String(raw).replace(/\s*\(CIK[^)]*\)/i, '').replace(/\s*\([A-Z.,\s]{1,10}\)\s*$/, '').replace(/,?\s+(?:L\.?L\.?C|L\.?P|LLP|Inc|Ltd|Corp)\.?$/i, ''))).slice(0, 100);
      // El texto completo trae hedge funds y fondos de terceros que solo mencionan «family office»: se queda el filer con «family» en el nombre.
      if (name.length < 3 || !/\bfamily\b/i.test(name) || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      names.push({ name, form: src.form || null, filed: src.file_date || null, states: src.biz_states || [], from: cik ? `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}` : 'https://efts.sec.gov/LATEST/search-index' });
      if (names.length >= n) return { names, query: params, hits: hits.length, reason: null };
    }
  }
  return { names, query: params, hits: hits.length, reason: null };
}

/** Apollo: organizaciones con la etiqueta «family office». Solo con APOLLO_ENABLED=1 y la herramienta apolloSource. → { rows, credits, reason, error } */
export async function apolloFamilyOffices({ tools, env = process.env, country = null, n = 8 } = {}) {
  const reason = String(env.ENGINE_INVESTOR_FO_APOLLO ?? '1') === '0' ? 'fo_apollo_off' : env.APOLLO_ENABLED !== '1' ? 'apollo_disabled' : typeof tools?.apolloSource !== 'function' ? 'no_tool' : null;
  if (reason) return { rows: [], credits: 0, reason };
  const out = await tools.apolloSource({ keywords: ['family office'], ...(country ? { location: country } : {}), n });
  return { rows: (out?.rows || []).filter((r) => r?.url), credits: Number(out?.credits_estimated) || 0, reason: null, ...(out?.error ? { error: out.error } : {}) };
}
