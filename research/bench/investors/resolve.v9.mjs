// V9: copia de resolve.mjs (que no se edita) con dos cambios, cada uno opcional:
//  (f1) el emparejamiento nombre–dominio es un parámetro (por defecto nameMatchesDomain, igual que resolve.mjs;
//       en v9 nameMatchesDomainV9 de resolve-match.v9.mjs);
//  (f2) la consulta de resolución quita el tipo que pegan las tablas de agregadores ("X VC Fund" → "X").
// La regla de aceptación no cambia: sitio propio (first party) + misma firma + extractor con cita literal.
import { nameMatchesDomain, sameDomain, investorHostname as host } from './extractor.mjs';
import { candidateKey } from './resolve.mjs';
import { stripTypeTail } from './resolve-match.v9.mjs';
export { candidateKey };
export const resolutionQuery = (name, suffix, { stripTail = false } = {}) => `"${stripTail ? stripTypeTail(name) : name}" ${suffix}`;
/** opts: { matcher = nameMatchesDomain, stripTail = false } */
export async function resolveCandidateV9(cand, ctx, { matcher = nameMatchesDomain, stripTail = false } = {}) {
  let url = null;
  const name = stripTail ? stripTypeTail(cand.name) : cand.name;
  if (cand.domain_on_page) url = `https://${cand.domain_on_page.replace(/^https?:\/\//, '').replace(/\/.*$/, '')}/`;
  else {
    if (!ctx.canSearch()) return { outcome: 'no_budget' };
    const response = await ctx.deps.search(resolutionQuery(cand.name, ctx.config.resolution.suffix, { stripTail }), { remainingSearches: ctx.remainingSearches() });
    ctx.onSearch(response);
    const hit = (response.results ?? []).find(r => { const h = host(r.url); return h && matcher(name, h) && !ctx.denied(h); });
    if (!hit) return { outcome: 'no_domain' };
    url = hit.url;
  }
  if (ctx.seenUrl(url)) return { outcome: 'already_seen', url };
  if (!ctx.canFetch()) return { outcome: 'no_budget', url };
  const page = await ctx.fetchPage(url);
  if (!page.text || page.text.length < 200) return { outcome: 'rejected:fetch_empty', url };
  const extracted = await ctx.extract({ url, title: page.title || url, text: page.text });
  if (!extracted.entity) return { outcome: `rejected:${extracted.rejected_kind}`, url };
  const e = extracted.entity, firstParty = e.official_domain && sameDomain(host(url), host(`https://${e.official_domain}`));
  const sameFirm = [e.canonical_name, ...(e.aliases ?? [])].some(n => candidateKey(n) === candidateKey(name) || candidateKey(n).includes(candidateKey(name)) || candidateKey(name).includes(candidateKey(n))) || nameMatchesDomain(name, e.official_domain);
  if (!firstParty) return { outcome: 'rejected:not_first_party', url };
  if (!sameFirm) return { outcome: 'rejected:different_firm', url };
  return { outcome: 'accepted', entity: extracted.entity, url };
}
