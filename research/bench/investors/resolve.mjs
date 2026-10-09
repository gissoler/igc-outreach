// FIX-05 — de "pista" a firma verificada: un candidato nombrado en una página de terceros solo cuenta
// si se resuelve a su sitio oficial y ese sitio pasa el mismo extractor y gate v2 (primera parte).
import { nameMatchesDomain, sameDomain, investorHostname as host, matchText } from './extractor.mjs';

export const candidateKey = name => matchText(name).replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * @returns {Promise<{outcome:string, entity?:object, url?:string}>}
 * ctx: { deps, config, canSearch(), canFetch(), onSearch(response), onFetch(page), extract(document, firstSeen) }
 */
export async function resolveCandidate(cand, ctx) {
  let url = null;
  if (cand.domain_on_page) url = `https://${cand.domain_on_page.replace(/^https?:\/\//, '').replace(/\/.*$/, '')}/`;
  else {
    if (!ctx.canSearch()) return { outcome: 'no_budget' };
    const response = await ctx.deps.search(`"${cand.name}" ${ctx.config.resolution.suffix}`, { remainingSearches: ctx.remainingSearches() });
    ctx.onSearch(response);
    const hit = (response.results ?? []).find(r => { const h = host(r.url); return h && nameMatchesDomain(cand.name, h) && !ctx.denied(h); });
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
  const sameFirm = [e.canonical_name, ...(e.aliases ?? [])].some(n => candidateKey(n) === candidateKey(cand.name) || candidateKey(n).includes(candidateKey(cand.name)) || candidateKey(cand.name).includes(candidateKey(n))) || nameMatchesDomain(cand.name, e.official_domain);
  if (!firstParty) return { outcome: 'rejected:not_first_party', url };
  if (!sameFirm) return { outcome: 'rejected:different_firm', url };
  return { outcome: 'accepted', entity: extracted.entity, url };
}
