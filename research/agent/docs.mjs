/**
 * Normaliza documentos y determina su base de oficialidad.
 * No descarga páginas ni decide elegibilidad.
 * Contratos: documento/1 y extracción/1.
 * No conoce ningún dominio: todo lo específico llega por el DomainPack.
 */
import { createHash } from 'node:crypto';
import { hostKind } from '../server/research/verify.mjs';
import { isPublicUrl } from '../server/research/localSearch.mjs';
const DROP = /^(utm_.+|fbclid|gclid|mc_cid|mc_eid|ref)$/i;
/**
 * Conserva el contrato público de normalizeUrl para que sus consumidores compartan una sola implementación.
 * @param {unknown} input Entrada definida por el contrato de la función.
 * @returns {unknown} Resultado definido por el contrato de la función.
 */
export function normalizeUrl(value) {
  const u = new URL(value);
  u.protocol = 'https:';
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
  u.hash = '';
  const pairs = [...u.searchParams.entries()].filter(([k]) => !DROP.test(k)).sort(([a, av], [b, bv]) => a.localeCompare(b)
    || av.localeCompare(bv));
  u.search = '';
  for (const [k, v] of pairs) u.searchParams.append(k, v);
  u.pathname = u.pathname.replace(/\/{2,}/g, '/');
  if (u.pathname !== '/') u.pathname = u.pathname.replace(/\/$/, '');
  if (u.port === '443') u.port = '';
  return u.href;
}
/**
 * Conserva el contrato público de docIdOf para que sus consumidores compartan una sola implementación.
 * @param {unknown} input Entrada definida por el contrato de la función.
 * @returns {unknown} Resultado definido por el contrato de la función.
 */
export const docIdOf = url => `doc-${createHash('sha256').update(normalizeUrl(url)).digest('hex').slice(0, 16)}`;
/**
 * Conserva el contrato público de registrableDomain para que sus consumidores compartan una sola implementación.
 * @param {unknown} input Entrada definida por el contrato de la función.
 * @returns {unknown} Resultado definido por el contrato de la función.
 */
export function registrableDomain(host) {
  const p = String(host).toLowerCase().replace(/^www\./, '').split('.');
  if (p.length <= 2) return p.join('.');
  const sld = p.at(-2);
  const cc = p.at(-1);
  if (cc.length === 2 && new Set(['co','com','gov','gob','ac','org','net','edu','go','or','ne',
    'nic']).has(sld)) return p.slice(-3).join('.');
  return p.slice(-2).join('.');
}
/**
 * Conserva el contrato público de officialBasisOf para que sus consumidores compartan una sola implementación.
 * @param {unknown} input Entrada definida por el contrato de la función.
 * @returns {unknown} Resultado definido por el contrato de la función.
 */
export function officialBasisOf( {
  url, extraction, acceptedEvidence = []
}, cfg) {
  if (!isPublicUrl(url) || hostKind(url) !== 'other') return 'none';
  const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  if ((cfg.suffixes || []).some(s => host === s.replace(/^\./, '') || host.endsWith(s.startsWith('.') ? s : `.${s}`))) return 'suffix';
  const rd = registrableDomain(host);
  const curated = (cfg.domains || []).some(entry => {
    const domain = typeof entry === 'string' ? entry : entry.domain;
    return host === domain || host.endsWith(`.${domain}`) || rd === domain;
  });
  if (curated) return 'curated_list';
  const about = extraction?.about;
  const issuer = String(about?.issuer_domain || '').toLowerCase().replace(/^www\./, '');
  const hasEntity = acceptedEvidence.some(e => e.criterion_id === 'G-ENTITY');
  if (issuer && registrableDomain(issuer) === rd && ['call', 'program_page'].includes(extraction?.page_type)
    && (about?.how_to_apply_quote || hasEntity)) return 'issuer_match';
  return 'none';
}
