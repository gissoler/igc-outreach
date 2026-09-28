import { id, norm, safeUrl } from './core.mjs';

const nodeId = (value, fallback = '') => id('graph-node', safeUrl(value) || norm(value || fallback));

export function buildNetworkGraph(profile, rows = []) {
  const ownerName = String(profile?.founder?.name || 'You').trim();
  const ownerUrl = safeUrl(profile?.founder?.linkedin_url || '');
  const ownerId = nodeId(ownerUrl, ownerName);
  const nodes = new Map([[ownerId, { id: ownerId, label: ownerName, subtitle: profile?.founder?.org || '', kind: 'owner', url: ownerUrl }]]);
  const edges = new Map();
  const addNode = (name, url, subtitle, kind = 'person') => {
    const key = nodeId(url, `${name}|${subtitle}`);
    if (!nodes.has(key)) nodes.set(key, { id: key, label: String(name || 'Profile').slice(0, 100), subtitle: String(subtitle || '').slice(0, 120), kind, url: safeUrl(url) });
    return key;
  };
  const addEdge = (from, to, kind, strength, verified, source, evidenceUrl = null) => {
    const key = `${from}|${to}|${kind}`;
    const edge = { id: id('graph-edge', key), from, to, kind, strength: Math.max(0, Math.min(1, Number(strength) || 0)), verified: Boolean(verified), source, evidenceUrl: safeUrl(evidenceUrl) };
    const current = edges.get(key);
    if (!current || edge.strength > current.strength) edges.set(key, edge);
  };
  for (const row of rows) {
    if (row?.source === 'linkedin_mutual_path' && row.path?.viaName && row.path?.targetName) {
      const via = addNode(row.path.viaName, row.path.viaUrl, row.path.viaRole || 'Mutual contact', 'mutual');
      const target = addNode(row.path.targetName, row.path.targetUrl, row.path.targetRole || row.org, 'target');
      addEdge(ownerId, via, 'connected_1st', .95, true, 'Authenticated LinkedIn', row.path.viaUrl);
      addEdge(via, target, 'mutual_connection', Number(row.strength) || .86, true, row.actor || 'Shared connections', row.path.targetUrl);
      continue;
    }
    if (!row?.name) continue;
    const person = addNode(row.name, row.url, row.role || row.org, row.source === 'linkedin_authenticated' ? 'connection' : 'public');
    const authenticated = row.source === 'linkedin_authenticated';
    const interaction = row.source === 'linkedin_public_interaction' || row.source === 'web_public_relation';
    addEdge(ownerId, person, authenticated ? 'connected_1st' : interaction ? 'public_interaction' : 'imported_contact', authenticated ? .95 : Number(row.strength) || .35, authenticated, authenticated ? 'Authenticated LinkedIn' : row.source === 'web_public_relation' ? 'Public web relationship' : interaction ? 'Public LinkedIn activity' : row.source || 'Imported source', row.interactions?.urls?.[0] || row.url);
  }
  const edgeList = [...edges.values()];
  const connected = new Set(edgeList.flatMap((edge) => [edge.from, edge.to]));
  return {
    ownerId,
    nodes: [...nodes.values()].filter((node) => node.kind === 'owner' || connected.has(node.id)).slice(0, 160),
    edges: edgeList.slice(0, 240),
    summary: {
      people: Math.max(0, nodes.size - 1),
      verified: edgeList.filter((edge) => edge.verified).length,
      public: edgeList.filter((edge) => edge.kind === 'public_interaction').length,
      mutualPaths: rows.filter((row) => row?.source === 'linkedin_mutual_path').length,
    },
    updatedAt: new Date().toISOString(),
  };
}
