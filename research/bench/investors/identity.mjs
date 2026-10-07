import { createHash } from 'node:crypto';

const cleanHost = value => {
  if (!value) return null;
  try { return new URL(value.includes('://') ? value : `https://${value}`).hostname.toLowerCase().replace(/^www\./, ''); }
  catch { return String(value).toLowerCase().replace(/^www\./, '').replace(/\/$/, '') || null; }
};

export function canonicalInvestorUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    url.protocol = 'https:'; url.hostname = cleanHost(url.hostname); url.hash = ''; url.search = '';
    url.pathname = url.pathname.replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/';
    return url.toString();
  } catch { return null; }
}

export function investorIdentityKeys(entity) {
  const keys = new Set();
  const domain = cleanHost(entity.official_domain);
  if (domain) keys.add(`domain:${domain}`);
  if (entity.regulatory_id) keys.add(`regulatory:${String(entity.regulatory_id).trim().toLowerCase()}`);
  const url = canonicalInvestorUrl(entity.canonical_url);
  if (url) keys.add(`url:${url}`);
  for (const source of entity.sources ?? []) {
    if (source.source_kind === 'official') {
      const host = cleanHost(source.url);
      if (host && (!domain || host === domain || host.endsWith(`.${domain}`))) keys.add(`domain:${domain || host}`);
    }
  }
  return keys;
}

export function stableInvestorId(entity) {
  const keys = [...investorIdentityKeys(entity)];
  for (const scheme of ['domain', 'regulatory', 'url']) {
    const key = keys.filter(x => x.startsWith(`${scheme}:`)).sort()[0];
    if (key) return `inv:${key}`;
  }
  throw new Error('Investor identity requires an official domain, regulatory id, or canonical URL');
}

const unique = xs => [...new Set(xs.filter(x => x != null))];
function merge(a, b) {
  const sources = unique([...(a.sources ?? []), ...(b.sources ?? [])].map(x => JSON.stringify(x))).map(JSON.parse);
  const merged = {
    ...a,
    official_domain: a.official_domain || b.official_domain,
    regulatory_id: a.regulatory_id || b.regulatory_id || null,
    canonical_url: a.canonical_url || b.canonical_url || null,
    aliases: unique([...(a.aliases ?? []), ...(b.aliases ?? []), b.canonical_name].filter(x => x !== a.canonical_name)),
    vehicles: unique([...(a.vehicles ?? []), ...(b.vehicles ?? [])].map(JSON.stringify)).map(JSON.parse),
    sectors: unique([...(a.sectors ?? []), ...(b.sectors ?? [])]),
    stages: unique([...(a.stages ?? []), ...(b.stages ?? [])]),
    rounds: unique([...(a.rounds ?? []), ...(b.rounds ?? [])]),
    geographies: unique([...(a.geographies ?? []), ...(b.geographies ?? [])]),
    relevant_portfolio: unique([...(a.relevant_portfolio ?? []), ...(b.relevant_portfolio ?? [])]),
    potential_conflicts: unique([...(a.potential_conflicts ?? []), ...(b.potential_conflicts ?? [])]),
    recent_investment_evidence: unique([...(a.recent_investment_evidence ?? []), ...(b.recent_investment_evidence ?? [])].map(JSON.stringify)).map(JSON.parse),
    sources,
    query_ids: unique([...(a.query_ids ?? []), ...(b.query_ids ?? [])]),
    contradictions: unique([...(a.contradictions ?? []), ...(b.contradictions ?? [])])
  };
  merged.stable_id = stableInvestorId(merged);
  return merged;
}

export function dedupeInvestors(entities) {
  const groups = [];
  for (const raw of entities) {
    const entity = { ...structuredClone(raw), stable_id: stableInvestorId(raw) };
    const keys = investorIdentityKeys(entity);
    const indexes = groups.map((g, i) => [...keys].some(k => g.keys.has(k)) ? i : -1).filter(i => i >= 0);
    if (!indexes.length) { groups.push({ entity, keys }); continue; }
    const first = indexes[0]; groups[first].entity = merge(groups[first].entity, entity);
    groups[first].keys = new Set([...groups[first].keys, ...keys, ...investorIdentityKeys(groups[first].entity)]);
    for (const i of indexes.slice(1).sort((x, y) => y - x)) {
      groups[first].entity = merge(groups[first].entity, groups[i].entity);
      groups[first].keys = new Set([...groups[first].keys, ...groups[i].keys]); groups.splice(i, 1);
    }
  }
  return groups.map(x => x.entity);
}

export const opaqueItemKey = (caseId, stableId, seed) => createHash('sha256').update(`${caseId}|${stableId}|${seed}`).digest('hex').slice(0, 16);
