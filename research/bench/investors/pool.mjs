import { dedupeInvestors, stableInvestorId, investorIdentityKeys } from './identity.mjs';

export function buildInvestorPool({ runs, anchors = [], manual = [] }) {
  const byId = new Map();
  const add = (stable_id, name, urls, origin) => {
    const row = byId.get(stable_id) ?? { stable_id, name, urls: [], origins: [] };
    row.name ||= name; row.urls = [...new Set([...row.urls, ...(urls ?? [])])]; row.origins = [...new Set([...row.origins, origin])]; byId.set(stable_id, row);
  };
  const candidates = [];
  for (const run of runs) for (const ranked of run.ranked.slice(0, 20)) {
    const entity = run.entities.find(x => x.stable_id === ranked.stable_id);
    if (entity) candidates.push({ entity, origin: 'system_top20' });
  }
  for (const entity of manual) candidates.push({ entity, origin: 'manual_search' });
  for (const entity of dedupeInvestors(candidates.map(x => x.entity))) {
    const keys = investorIdentityKeys(entity), origins = candidates.filter(x => [...investorIdentityKeys(x.entity)].some(k => keys.has(k))).map(x => x.origin);
    for (const origin of new Set(origins)) add(stableInvestorId(entity), entity.canonical_name, entity.sources.map(x => x.url), origin);
  }
  for (const anchor of anchors) {
    const anchorHost = new URL(anchor.official_url).hostname.replace(/^www\./, '').toLowerCase(), anchorKeys = new Set([anchor.stable_id.replace(/^inv:/, ''), `domain:${anchorHost}`]);
    const existing = [...byId.values()].find(row => anchorKeys.has(row.stable_id.replace(/^inv:/, '')) || row.urls.some(url => anchorKeys.has(`domain:${new URL(url).hostname.replace(/^www\./, '').toLowerCase()}`)));
    add(existing?.stable_id ?? anchor.stable_id, anchor.canonical_name, [anchor.official_url], 'anchor');
  }
  return [...byId.values()].sort((a, b) => a.stable_id.localeCompare(b.stable_id));
}
