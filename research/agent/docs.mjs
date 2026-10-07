import { createHash } from 'node:crypto';
import { hostKind } from '../server/research/verify.mjs';
import { isPublicUrl } from '../server/research/localSearch.mjs';

const DROP = /^(utm_.+|fbclid|gclid|mc_cid|mc_eid|ref)$/i;
export function normalizeUrl(value) {
  const u = new URL(value); u.protocol = 'https:'; u.hostname = u.hostname.toLowerCase().replace(/^www\./, ''); u.hash = '';
  const pairs = [...u.searchParams.entries()].filter(([k]) => !DROP.test(k)).sort(([a, av], [b, bv]) => a.localeCompare(b) || av.localeCompare(bv));
  u.search = ''; for (const [k, v] of pairs) u.searchParams.append(k, v);
  u.pathname = u.pathname.replace(/\/{2,}/g, '/'); if (u.pathname !== '/') u.pathname = u.pathname.replace(/\/$/, '');
  if (u.port === '443') u.port = '';
  return u.href;
}
export const docIdOf = url => `doc-${createHash('sha256').update(normalizeUrl(url)).digest('hex').slice(0, 16)}`;
export function registrableDomain(host) {
  const p = String(host).toLowerCase().replace(/^www\./, '').split('.');
  if (p.length <= 2) return p.join('.');
  const sld = p.at(-2), cc = p.at(-1);
  if (cc.length === 2 && new Set(['co','com','gov','gob','ac','org','net','edu','go','or','ne','nic']).has(sld)) return p.slice(-3).join('.');
  return p.slice(-2).join('.');
}
export function officialBasisOf({ url, extraction }, cfg) {
  if (!isPublicUrl(url) || hostKind(url) !== 'other') return 'none';
  const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  if ((cfg.suffixes || []).some(s => host === s.replace(/^\./, '') || host.endsWith(s.startsWith('.') ? s : `.${s}`))) return 'suffix';
  const rd = registrableDomain(host);
  if ((cfg.domains || []).some(entry => { const d = typeof entry === 'string' ? entry : entry.domain; return host === d || host.endsWith(`.${d}`) || rd === d; })) return 'curated_list';
  const about = extraction?.about;
  const issuer = String(about?.issuer_domain || '').toLowerCase().replace(/^www\./, '');
  const hasEntity = extraction?.evidence?.some(e => e.criterion_id === 'G-ENTITY');
  if (issuer && registrableDomain(issuer) === rd && ['call', 'program_page'].includes(extraction?.page_type) && (about?.how_to_apply_quote || hasEntity)) return 'issuer_match';
  return 'none';
}
