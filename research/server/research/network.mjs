import { norm, safeUrl, evidence, candidate } from './core.mjs';
export function parseConnections(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 1000000)
    throw new Error('CSV too large (1 MB max).');
  const rows = [];
  let row = [],
    cell = '',
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === ',' && !quoted) {
      row.push(cell);
      cell = '';
    } else if (c === '\n' && !quoted) {
      row.push(cell.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (quoted) throw new Error('Invalid CSV: unclosed quotes.');
  if (cell || row.length) {
    row.push(cell.trim());
    rows.push(row);
  }
  const start = rows.findIndex(
    (r) =>
      r.map(norm).includes('first name') && r.map(norm).includes('last name'),
  );
  if (start < 0)
    throw new Error(
      'Use LinkedIn Connections.csv with First Name, Last Name and Company.',
    );
  const headers = rows[start].map(norm);
  if (!headers.includes('company'))
    throw new Error('Missing Company: needed to avoid name clashes.');
  return rows
    .slice(start + 1)
    .slice(0, 5000)
    .map((r) => {
      const value = (k) => String(r[headers.indexOf(k)] || '').trim();
      const url = safeUrl(value('url'));
      return {
        name: `${value('first name')} ${value('last name')}`.trim(),
        org: value('company'),
        role: value('position'),
        url:
          url && new URL(url).hostname.endsWith('.linkedin.com') ? url : null,
        connectedOn: value('connected on'),
      };
    })
    .filter((r) => r.name && r.org);
}
export function parseContactCsv(text, source = 'contacts') {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 1_000_000)
    throw new Error('CSV too large (1 MB max).');
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted;
    } else if (c === ',' && !quoted) { row.push(cell); cell = ''; }
    else if (c === '\n' && !quoted) { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (quoted) throw new Error('Invalid CSV: unclosed quotes.');
  if (cell || row.length) { row.push(cell.trim()); rows.push(row); }
  const aliases = {
    first: ['first name', 'firstname', 'first_name', 'given name'],
    last: ['last name', 'lastname', 'last_name', 'family name'],
    full: ['name', 'full name', 'contact name'],
    org: ['company', 'company name', 'organization', 'organisation', 'organization name', 'organization 1 name', 'account name'],
    role: ['position', 'job title', 'title', 'role'],
    url: ['url', 'linkedin url', 'linkedin profile url', 'profile url'],
  };
  const headerAt = rows.findIndex((r) => r.some((v) => [...aliases.first, ...aliases.full].includes(norm(v))));
  if (headerAt < 0) throw new Error('No name columns found in the CSV.');
  const headers = rows[headerAt].map(norm);
  const value = (r, keys) => {
    const index = headers.findIndex((h) => keys.includes(h));
    return index < 0 ? '' : String(r[index] || '').trim();
  };
  return rows.slice(headerAt + 1).slice(0, 5000).map((r) => {
    const first = value(r, aliases.first), last = value(r, aliases.last);
    const rawUrl = value(r, aliases.url), url = safeUrl(rawUrl);
    return {
      name: value(r, aliases.full) || `${first} ${last}`.trim(),
      org: value(r, aliases.org) || 'Organization unavailable',
      role: value(r, aliases.role),
      url,
      connectedOn: '',
      source,
    };
  }).filter((r) => r.name);
}

export function parseCalendar(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 1_000_000)
    throw new Error('Calendar too large (1 MB max).');
  if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error('Choose a valid .ics file.');
  const people = new Map();
  for (const line of text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/)) {
    if (!/^ATTENDEE/i.test(line)) continue;
    const name = line.match(/CN=([^;:]+)/i)?.[1]?.replace(/^"|"$/g, '').trim();
    const email = line.match(/mailto:([^\s]+)/i)?.[1]?.trim();
    if (!name || !email) continue;
    people.set(norm(email), { name, org: email.split('@')[1] || 'Organization unavailable', role: 'Calendar contact', url: null, connectedOn: '', source: 'calendar' });
  }
  return [...people.values()].slice(0, 5000);
}
export function addConnections(leads, connections, brief) {
  return leads.map((l) => {
    const c = connections.find(
      (c) => {
        const sameUrl = c.url && l.contact?.type === 'linkedin' && safeUrl(c.url) === safeUrl(l.contact.value);
        const sameName = l.person && norm(c.name) === norm(l.person);
        const sameOrg = c.org && norm(c.org) === norm(l.org);
        const mutualTarget = c.source === 'linkedin_mutual_path' && c.path?.targetUrl && l.contact?.type === 'linkedin' && safeUrl(c.path.targetUrl) === safeUrl(l.contact.value);
        return mutualTarget || sameUrl || (sameName && (['linkedin_public_interaction', 'linkedin_authenticated', 'web_public_relation'].includes(c.source) || sameOrg));
      },
    );
    if (!c) return l;
    const isWeb = c.source === 'web_public_relation';
    const isInteraction = c.source === 'linkedin_public_interaction' || isWeb;
    const isAuthenticated = c.source === 'linkedin_authenticated';
    const isMutual = c.source === 'linkedin_mutual_path';
    const interaction = c.interactions || {};
    const interactionUrl = interaction.urls?.[0] || c.url;
    const ev = interactionUrl
      ? evidence(
          isMutual ? `Shared connections · ${c.actor || 'previous source'}` : isAuthenticated ? `Authenticated network · ${c.actor || 'previous source'}` : isWeb ? 'Public web relationship' : isInteraction ? 'Public LinkedIn interaction' : 'Your LinkedIn export',
          interactionUrl,
          isMutual
            ? `Authenticated path: ${brief.name} → ${c.path.viaName} → ${c.path.targetName}`
            : isAuthenticated
              ? `${c.name} · first-degree connection seen in the authorized session`
              : isWeb
                ? `${c.name} · ${c.relation || 'appears with you'} · ${(c.quotes || [])[0] || ''}`.slice(0, 600)
              : isInteraction
                ? `${c.name} · ${interaction.authoredComments || 0} of your comments · ${interaction.authoredReactions || 0} of your reactions · ${interaction.receivedComments || 0} comments received · ${interaction.receivedReactions || 0} reactions received · ${interaction.lastAt || 'No date'}`
                : `${c.name} · ${c.org} · ${c.connectedOn || 'No date'}`,
          isMutual ? 'mutual_connection' : isInteraction ? 'public_interaction' : 'connection',
          undefined,
          isInteraction || isAuthenticated || isMutual,
        )
      : null;
    const strength = isMutual ? Number(c.strength) || .86 : isAuthenticated ? .95 : isInteraction ? Number(c.strength) || 0.35 : 0.35;
    const mutualPath = isMutual ? {
      nodes: [brief.name, c.path.viaName, c.path.targetName], strength, hypothesis: false,
      hops: [
        { from: brief.name, to: c.path.viaName, relation: 'First-degree connection confirmed from the authorized session', strength: .95, evidenceIds: ev ? [ev.id] : [], url: c.path.viaUrl },
        { from: c.path.viaName, to: c.path.targetName, relation: 'Shared connection (previous source)', strength, evidenceIds: ev ? [ev.id] : [], url: c.path.targetUrl },
      ],
    } : null;
    return {
      ...l,
      paths: [
        mutualPath || {
          nodes: [brief.name, c.name],
          strength,
          hypothesis: !isAuthenticated,
          hops: [
            {
              from: brief.name,
              to: c.name,
              relation: isAuthenticated
                ? 'First-degree connection confirmed from the authorized session'
                : isWeb
                  ? `Appear together on a public page (${c.relation || 'unspecified relationship'}); not a willingness to introduce`
                : isInteraction
                  ? `Documented public relationship: ${interaction.authoredComments || 0} of your comments, ${interaction.authoredReactions || 0} of your reactions, ${interaction.receivedComments || 0} comments received and ${interaction.receivedReactions || 0} reactions received; not a first-degree connection`
                  : 'Connection declared in CSV; identity to confirm',
              strength,
              evidenceIds: ev ? [ev.id] : [],
              url: interactionUrl,
            },
          ],
        },
        ...l.paths,
      ],
      evidence: ev ? [...l.evidence, ev] : l.evidence,
    };
  });
}

/* ───────── Warm paths sin export de conexiones ───────── */
const GENERIC_ORG = /^(self employed|freelance|independent|stealth|confidential|retired|student|none|n a|linkedin|google|microsoft|amazon|meta|apple)$/;
const orgKey = (value) => norm(value).replace(/\b(inc|llc|ltd|limited|corp|corporation|co|sa|sas|gmbh|plc|the|lp|llp)\b/g, ' ').replace(/\s+/g, ' ').trim();
const orgPieces = (value) => String(value || '').split(/[,|·;/]|\s+[-–—]\s+|\s+at\s+|\s+en\s+/i).map(orgKey).filter((k) => k.length >= 4 && !GENERIC_ORG.test(k));
const contactOrgs = (c) => [...new Set([...orgPieces(c.org), ...orgPieces(c.role), ...(c.affiliations || []).flatMap(orgPieces)])];
const sameOrg = (a, b) => a === b || (Math.min(a.length, b.length) >= 6 && (` ${a} `.includes(` ${b} `) || ` ${b} `.includes(` ${a} `)));
const INVESTOR_ORG = /\b(ventures?|capital|fund|funds|vc|family office|angels?)\b/i;
const INVESTOR_ROLE = /\b(investor|angel|general partner|managing partner|venture partner|venture capitalist|vc|limited partner|principal at .*(ventures|capital))\b/i;
const NOT_INVESTOR = /\b(ex[- ]?(vc|investor)|former|partnerships|capital structuring|project finance)\b/i;
const isInvestor = (c) => !NOT_INVESTOR.test(`${c.role || ''}`) && (INVESTOR_ORG.test(c.org || '') || INVESTOR_ROLE.test(c.role || ''));
const PARTNERING = /\b(business development|corporate development|licens\w*|alliance|partnerships?|search (and|&) evaluation)\b/i;

/** Contactos de tu red que ya son inversionistas (o BD) se vuelven candidatos con camino directo. */
export function networkCandidates(connections, brief) {
  const wanted = brief.fundingTypes.includes('investment') ? isInvestor : brief.fundingTypes.includes('partnering') ? (c) => PARTNERING.test(`${c.role || ''} ${c.org || ''}`) : null;
  if (!wanted) return [];
  const unique = [...new Map(connections.filter((c) => c?.name && c.source !== 'linkedin_mutual_path' && wanted(c)).map((c) => [norm(c.url || c.name), c])).values()];
  return unique.slice(0, 25).flatMap((c) => {
    const url = safeUrl(c.interactions?.urls?.[0] || c.url);
    if (!url) return [];
    const quote = `${c.name} · ${[c.role, c.org].filter(Boolean).join(' · ')}`;
    const type = brief.fundingTypes.includes('investment') ? 'investment' : 'partnering';
    return [candidate({
      externalId: `network:${norm(c.url || c.name)}`,
      person: c.name,
      role: c.role || null,
      org: String(c.org || '').split(',')[0].trim() || 'Organization not confirmed',
      title: [c.role, c.org].filter(Boolean).join(' en ') || 'Contact in your network',
      kind: 'person',
      fundingType: type,
      status: 'unknown',
      contact: safeUrl(c.url) && /linkedin\.com\/in\//i.test(c.url) ? { type: 'linkedin', value: safeUrl(c.url), provenance: 'Contact in your network' } : null,
      evidence: [evidence('Your network', url, quote, 'network_contact')],
      risks: ['Role from your network; confirm it\'s current and they invest in your stage and sector'],
      missing: ['Investor thesis and ticket not confirmed'],
      searchText: `${c.role || ''} ${c.org || ''} ${(c.affiliations || []).join(' ')} ${brief.industry}`,
      fromNetwork: true,
    })];
  });
}

/** Tú → contacto → candidato cuando ambos están vinculados a la misma organización. Siempre hipótesis. */
export function addOrgBridges(leads, connections, brief) {
  const people = connections.filter((c) => c?.name && c.source !== 'linkedin_mutual_path');
  const indexed = people.map((c) => ({ c, orgs: contactOrgs(c) })).filter((x) => x.orgs.length);
  return leads.map((l) => {
    if (l.paths?.length || !l.person) return l;
    const current = orgPieces(l.org);
    const past = (l.affiliations || []).flatMap(orgPieces).filter((k) => !current.includes(k));
    const bridges = [];
    for (const { c, orgs } of indexed) {
      if (norm(c.name) === norm(l.person)) continue;
      const hitNow = current.find((k) => orgs.some((o) => sameOrg(o, k)));
      const hitPast = hitNow ? null : past.find((k) => orgs.some((o) => sameOrg(o, k)));
      const hit = hitNow || hitPast;
      if (!hit) continue;
      const first = Math.max(0.1, Math.min(0.95, Number(c.strength) || 0.35));
      const second = hitNow ? 0.35 : 0.2;
      const orgName = hitNow ? l.org : (l.affiliations || []).find((a) => orgPieces(a).includes(hit)) || hit;
      const contactUrl = safeUrl(c.interactions?.urls?.[0] || c.url);
      const leadUrl = safeUrl(l.evidence?.[0]?.url || l.contact?.value);
      if (!leadUrl) continue;
      bridges.push({
        nodes: [brief.name, c.name, l.person],
        strength: Math.round(first * second * 1000) / 1000,
        hypothesis: true,
        hops: [
          { from: brief.name, to: c.name, relation: c.source === 'web_public_relation' ? `Public web relationship (${c.relation || 'appear together'})` : c.source === 'linkedin_public_interaction' ? 'Public LinkedIn interaction' : 'Imported contact', strength: first, evidenceIds: [], url: contactUrl },
          { from: c.name, to: l.person, relation: `${hitNow ? 'Same organization' : 'Shared organization in their history'}: ${orgName}. Inferred closeness, not confirmed; ask ${c.name.split(' ')[0]} if they know them`, strength: second, evidenceIds: [], url: `${leadUrl.split('#')[0]}#via-${norm(c.name).replace(/ /g, '-')}` },
        ],
      });
    }
    if (!bridges.length) return l;
    bridges.sort((a, b) => b.strength - a.strength);
    return { ...l, paths: bridges.slice(0, 3) };
  });
}
