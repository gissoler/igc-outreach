import { candidate, evidence, norm, safeUrl } from './core.mjs';
import { noopRecorder, previewRecords, publicParams, queryOf, safeSample, sanitizeUrl } from './liveRun.mjs';

const DEFAULT_ACTOR = 'harvestapi/linkedin-company-employees';
const DEFAULT_PROFILE_ACTOR = 'harvestapi/linkedin-profile-scraper';
const DEFAULT_INTERACTIONS_ACTOR = 'harvestapi/linkedin-profile-posts';
const DEFAULT_COMMENTS_ACTOR = 'harvestapi/linkedin-profile-comments';
const DEFAULT_REACTIONS_ACTOR = 'harvestapi/linkedin-profile-reactions';
const DEFAULT_COMPANY_SEARCH_ACTOR = 'harvestapi/linkedin-company-search';
const DEFAULT_PROFILE_SEARCH_ACTOR = 'harvestapi/linkedin-profile-search';
const DEFAULT_NETWORK_SEARCH_ACTOR = 'crawlerbros/linkedin-people-search-scraper';
const DEFAULT_MUTUALS_ACTOR = 'data_link_miner/linkedin-shared-connections';
const DEFAULT_TITLES = [
  'Business Development',
  'Corporate Development',
  'Search and Evaluation',
  'Licensing',
  'Alliance Management',
  'Partner',
  'Investment Director',
];
const clamp = (value, min, max, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.floor(number))) : fallback;
};
const actorPath = (value) => {
  const actor = String(value || DEFAULT_ACTOR).trim().replace('/', '~');
  if (!/^[a-zA-Z0-9_.-]+(?:~[a-zA-Z0-9_.-]+)?$/.test(actor))
    throw new Error('Invalid APIFY_ACTOR_ID. Use owner/actor or the Actor ID.');
  return actor;
};

export function apifyTargetOrganizations(leads, env = process.env) {
  const configured = String(env.APIFY_TARGET_COMPANIES || '')
    .split(/[,;\n]/)
    .map((value) => value.trim())
    .filter(Boolean);
  const discovered = leads
    .filter((lead) => ['person', 'research'].includes(lead.kind))
    .map((lead) => lead.org)
    .filter((org) => org && !/university|college|institute|nih|government|department|agency/i.test(org));
  const unique = new Map([...configured, ...discovered].map((org) => [norm(org), org]));
  return [...unique.values()].slice(0, clamp(env.APIFY_MAX_COMPANIES, 1, 10, 5));
}

const companySearchQuery = (brief) => {
  const goal = brief.fundingTypes.includes('investment')
    ? 'venture capital investor'
    : brief.fundingTypes.includes('debt')
      ? 'venture debt lender'
      : 'strategic healthcare partner';
  return `${goal} ${String(brief.industry || brief.product || '').trim()}`.replace(/\s+/g, ' ').slice(0, 300);
};

export async function apifyDiscoverCompanies(brief, { env = process.env, fetcher = fetch, signal, record, live } = {}) {
  if (!brief.fundingTypes.some((type) => ['investment', 'debt', 'partnering'].includes(type))) return { actor: null, query: '', companies: [] };
  const maxItems = clamp(env.APIFY_DISCOVERY_MAX_COMPANIES, 1, 10, 5);
  const query = companySearchQuery(brief);
  const { actor, items } = await runApifyActor({
    actorId: env.APIFY_COMPANY_SEARCH_ACTOR_ID || DEFAULT_COMPANY_SEARCH_ACTOR,
    maxItems, maxItemsLimit: 10, env, fetcher, signal, record, live,
    input: { scraperMode: 'short', searchQuery: query, takePages: 1 },
  });
  const companies = [];
  for (const item of items) {
    const name = String(item?.name || item?.companyName || item?.title || item?.company?.name || '').trim();
    const url = safeUrl(item?.linkedinUrl || item?.companyUrl || item?.url || item?.company?.linkedinUrl);
    const value = url && /(^|\.)linkedin\.com$/i.test(new URL(url).hostname) ? url : name;
    if (value && !companies.some((company) => norm(company) === norm(value))) companies.push(value);
  }
  return { actor, query, companies: companies.slice(0, maxItems) };
}

const profileSearchQuery = (brief) => {
  const industry = String(brief.industry || brief.product || '').trim();
  const focus = /mental\s+health/i.test(industry)
    ? 'mental health'
    : /digital\s+health/i.test(industry)
      ? 'digital health'
      : industry.split(/\s+/).filter(Boolean).slice(0, 3).join(' ');
  const role = brief.fundingTypes.includes('investment')
    ? 'investor'
    : brief.fundingTypes.includes('debt')
      ? 'venture debt'
      : 'business development';
  return `${focus} ${role}`.replace(/\s+/g, ' ').trim().slice(0, 300);
};

export async function apifySearchPeople(brief, { env = process.env, fetcher = fetch, signal, record, live } = {}) {
  if (!brief.fundingTypes.some((type) => ['investment', 'debt', 'partnering'].includes(type))) return { actor: null, query: '', leads: [] };
  const maxItems = clamp(env.APIFY_DISCOVERY_MAX_PEOPLE, 1, 25, 10);
  const query = profileSearchQuery(brief);
  const { actor, items } = await runApifyActor({
    actorId: env.APIFY_PROFILE_SEARCH_ACTOR_ID || DEFAULT_PROFILE_SEARCH_ACTOR,
    maxItems, maxItemsLimit: 25, env, fetcher, signal, record, live,
    input: { searchQuery: query, profileScraperMode: 'Short', takePages: 1 },
  });
  return { actor, query, leads: apifyLeads(items, brief, actor) };
}

export async function runApifyActor({ input, actorId, maxItems: requestedMaxItems, maxItemsLimit = 50, maxResponseBytes = 5_000_000, includeMaxItemsInInput = true, env = process.env, fetcher = fetch, signal, record = () => {}, live = noopRecorder }) {
  if (!env.APIFY_TOKEN) throw new Error('APIFY_TOKEN not set.');
  const actor = actorPath(actorId || env.APIFY_ACTOR_ID);
  const maxItems = clamp(requestedMaxItems ?? env.APIFY_MAX_ITEMS, 1, maxItemsLimit, Math.min(20, maxItemsLimit));
  const url = `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?clean=true&limit=${maxItems}`;
  const timeout = AbortSignal.timeout(clamp(env.APIFY_TIMEOUT_MS, 10_000, 180_000, 120_000));
  const payload = includeMaxItemsInInput ? { ...input, maxItems } : input;
  // Evento del inspector: endpoint y parámetros públicos. El token viaja solo en Authorization y nunca se emite.
  const privateKeys = new Set(['cookie', 'cookies', 'li_at', 'liAtCookie', 'li_at_cookie']);
  const inspectablePayload = Object.fromEntries(Object.entries(payload).map(([key, value]) => [key, privateKeys.has(key) ? '[REDACTED]' : value]));
  const base = { kind: 'api', callId: `apify-${Date.now()}`, method: 'POST', host: 'api.apify.com', endpoint: sanitizeUrl(url.split('?')[0], live.secrets), params: publicParams(url, inspectablePayload, live.secrets) };
  base.query = queryOf(base.params);
  live({ phase: 'api_request', status: 'running', title: 'POST api.apify.com', message: `Running Actor ${actor.replace('~', '/')} (sync, up to ${maxItems} results).`, publicUrl: url, detail: base });
  const started = Date.now();
  const fail = (message, httpStatus = null) => live({ phase: 'api_response', status: 'error', title: 'Error from api.apify.com', message, publicUrl: url, durationMs: Date.now() - started, detail: { ...base, httpStatus } });
  let response;
  try { response = await fetcher(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.APIFY_TOKEN}`,
      'Content-Type': 'application/json',
      'User-Agent': env.RESEARCH_USER_AGENT || 'IGCOutreachResearch/1.0',
    },
    body: JSON.stringify(payload),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  }); } catch (error) { fail(error.message || 'No response from Apify.'); throw error; }
  if (!response.ok) {
    const rawDetail = await response.text().catch(() => '');
    const hasPrivateInput = Object.keys(payload).some((key) => privateKeys.has(key));
    const detail = hasPrivateInput ? '' : rawDetail.slice(0, 300);
    fail(`Apify HTTP ${response.status}`, response.status);
    throw new Error(`Apify HTTP ${response.status}${detail ? `: ${detail}` : ''}`);
  }
  const text = await response.text();
  if (Buffer.byteLength(text) > maxResponseBytes) { fail('Response too large.', response.status); throw new Error(`Apify returned more than ${Math.floor(maxResponseBytes / 1_000_000)} MB.`); }
  let items;
  try { items = JSON.parse(text); } catch { fail('Invalid JSON.', response.status); throw new Error('Apify returned invalid JSON.'); }
  if (!Array.isArray(items)) { fail('The response isn\'t a list.', response.status); throw new Error('Apify didn\'t return a results list.'); }
  const limited = items.slice(0, maxItems);
  live({ phase: 'api_response', status: 'success', title: `HTTP ${response.status} · api.apify.com`, message: `Apify returned ${limited.length} records in ${Date.now() - started} ms.`, publicUrl: url, resultCount: limited.length, durationMs: Date.now() - started, detail: { ...base, httpStatus: response.status, bytes: Buffer.byteLength(text), sample: safeSample(limited, { secrets: live.secrets }), preview: previewRecords(limited, { secrets: live.secrets }) } });
  record(`https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items`, limited);
  return { actor: actor.replace('~', '/'), items: limited };
}

export function normalizeLinkedInProfile(item, submittedUrl) {
  if (!item || typeof item !== 'object') throw new Error('No public information found for this profile.');
  const linkedinUrl = safeUrl(item.linkedinUrl || item.profileUrl || item.url || submittedUrl);
  if (!linkedinUrl || !/(^|\.)linkedin\.com$/i.test(new URL(linkedinUrl).hostname))
    throw new Error('Apify didn\'t return a valid LinkedIn profile.');
  const { role, org } = position(item);
  const location = typeof item.location === 'string'
    ? item.location
    : item.location?.linkedinText || item.location?.parsed?.text || '';
  return {
    linkedinUrl,
    name: String(item.fullName || item.name || `${item.firstName || ''} ${item.lastName || ''}`).trim(),
    headline: String(item.headline || role || '').trim(),
    role: String(role || '').trim(),
    organization: String(org || '').trim(),
    location: String(location || '').trim(),
    verifiedAt: new Date().toISOString(),
    source: 'Public LinkedIn profile via Apify',
  };
}

export async function enrichLinkedInProfile(profileUrl, { env = process.env, fetcher = fetch, signal } = {}) {
  const url = safeUrl(profileUrl);
  if (!url || !/(^|\.)linkedin\.com$/i.test(new URL(url).hostname) || !/^\/in\/[^/]+\/?$/i.test(new URL(url).pathname))
    throw new Error('Paste a valid profile link, e.g. linkedin.com/in/your-profile.');
  const { items } = await runApifyActor({
    actorId: env.APIFY_PROFILE_ACTOR_ID || DEFAULT_PROFILE_ACTOR,
    maxItems: 1,
    env,
    fetcher,
    signal,
    input: {
      urls: [url],
      profileScraperMode: 'Profile details no email ($4 per 1k)',
    },
  });
  return normalizeLinkedInProfile(items[0], url);
}

const linkedinProfileUrl = (value) => {
  const url = safeUrl(value);
  if (!url) return null;
  const parsed = new URL(url);
  if (!/(^|\.)linkedin\.com$/i.test(parsed.hostname) || !/^\/in\/[^/]+/i.test(parsed.pathname)) return null;
  const handle = parsed.pathname.match(/^\/in\/([^/]+)/i)?.[1];
  return handle ? `https://www.linkedin.com/in/${handle}/` : null;
};

const roleAndOrg = (headline) => {
  const value = String(headline || '').trim();
  const match = value.match(/^(.+?)\s+(?:at|en|@)\s+(.+)$/i);
  return { role: match?.[1]?.trim() || value, org: match?.[2]?.split(/\s+[|\u00b7]\s+/)[0]?.trim() || '' };
};

const actorFrom = (value) => value?.actor || value?.author || value?.person || value?.profile || value;
const eventDate = (value, post) => value?.createdAt || value?.postedAt?.date || value?.date || post?.postedAt?.date || null;

export function normalizePublicLinkedInInteractions(items, ownerUrl) {
  if (!Array.isArray(items)) throw new Error('Apify didn\'t return public activity.');
  const owner = linkedinProfileUrl(ownerUrl);
  const people = new Map();
  const add = (raw, kind, post, container = raw) => {
    const actor = actorFrom(raw);
    if (!actor || typeof actor !== 'object') return;
    const url = linkedinProfileUrl(actor.linkedinUrl || actor.profileUrl || actor.url);
    const name = String(actor.name || actor.fullName || `${actor.firstName || ''} ${actor.lastName || ''}`).trim();
    if (!name || (owner && url === owner)) return;
    const headline = actor.position || actor.info || actor.headline || actor.title || '';
    const { role, org } = roleAndOrg(headline);
    const key = url || norm(name);
    if (!key) return;
    const postUrl = safeUrl(post?.linkedinUrl || post?.postUrl || post?.url || container?.postUrl || container?.linkedinUrl) || url;
    if (!postUrl) return;
    const current = people.get(key) || { name, org, role, url, connectedOn: '', source: 'linkedin_public_interaction', interactions: { comments: 0, reactions: 0, authoredComments: 0, authoredReactions: 0, receivedComments: 0, receivedReactions: 0, lastAt: null, urls: [] } };
    current.name ||= name; current.org ||= org; current.role ||= role; current.url ||= url;
    if (kind === 'comment') { current.interactions.comments++; current.interactions.receivedComments++; }
    else { current.interactions.reactions++; current.interactions.receivedReactions++; }
    const at = eventDate(container, post);
    if (at && (!current.interactions.lastAt || Date.parse(at) > Date.parse(current.interactions.lastAt))) current.interactions.lastAt = at;
    if (!current.interactions.urls.includes(postUrl)) current.interactions.urls.push(postUrl);
    people.set(key, current);
  };
  const visit = (post) => {
    const type = String(post?.type || post?.recordType || '').toLowerCase();
    if (type === 'comment') add(post, 'comment', post);
    if (type === 'reaction') add(post, 'reaction', post);
    const comments = [post?.comments, post?.socialContent?.comments, post?.engagement?.commentsData].find(Array.isArray) || [];
    const reactions = [post?.reactions, post?.socialContent?.reactions, post?.engagement?.actors].find(Array.isArray) || [];
    for (const comment of comments) add(comment, 'comment', post);
    for (const reaction of reactions) add(reaction, 'reaction', post);
  };
  for (const item of items) {
    visit(item);
    if (Array.isArray(item?.items)) for (const nested of item.items) visit(nested);
  }
  return scorePublicRelations([...people.values()]);
}

const scorePublicRelations = (rows) => rows.map((person) => {
    const { comments, reactions, lastAt, urls } = person.interactions;
    const ageDays = lastAt && Number.isFinite(Date.parse(lastAt)) ? Math.max(0, (Date.now() - Date.parse(lastAt)) / 86400000) : 365;
    const recency = Math.max(0, 1 - ageDays / 365);
    person.strength = Math.min(0.85, 0.25 + Math.min(comments, 3) * 0.14 + Math.min(reactions, 5) * 0.035 + recency * 0.08);
    person.interactions.urls = urls.slice(0, 8);
    return person;
  }).sort((a, b) => b.strength - a.strength);

/** Map the owner's public comments/reactions to the authors of the posts involved. */
export function normalizeAuthoredLinkedInActivity(items, ownerUrl, kind) {
  if (!Array.isArray(items)) throw new Error('Apify didn\'t return public activity.');
  const owner = linkedinProfileUrl(ownerUrl);
  const people = new Map();
  for (const item of items) {
    const author = item?.post?.author || item?.repost?.author;
    if (!author || typeof author !== 'object') continue;
    const url = linkedinProfileUrl(author.linkedinUrl || author.profileUrl || author.url);
    const name = String(author.name || author.fullName || `${author.firstName || ''} ${author.lastName || ''}`).trim();
    if (!name || (owner && url === owner)) continue;
    const { role, org } = roleAndOrg(author.position || author.info || author.headline || author.title || '');
    const key = url || norm(name);
    const evidenceUrl = safeUrl(item.linkedinUrl || item?.post?.linkedinUrl || item?.post?.postUrl || item?.post?.url);
    if (!key || !evidenceUrl) continue;
    const current = people.get(key) || { name, org, role, url, connectedOn: '', source: 'linkedin_public_interaction', interactions: { comments: 0, reactions: 0, authoredComments: 0, authoredReactions: 0, receivedComments: 0, receivedReactions: 0, lastAt: null, urls: [] } };
    if (kind === 'comment') { current.interactions.comments++; current.interactions.authoredComments++; }
    else { current.interactions.reactions++; current.interactions.authoredReactions++; }
    const at = item.createdAt || item?.post?.postedAt?.date || null;
    if (at && (!current.interactions.lastAt || Date.parse(at) > Date.parse(current.interactions.lastAt))) current.interactions.lastAt = at;
    if (!current.interactions.urls.includes(evidenceUrl)) current.interactions.urls.push(evidenceUrl);
    people.set(key, current);
  }
  return scorePublicRelations([...people.values()]);
}

export function mergePublicLinkedInRelations(groups) {
  const merged = new Map();
  for (const row of groups.flat()) {
    const key = linkedinProfileUrl(row.url) || norm(row.name);
    if (!key) continue;
    const current = merged.get(key) || { ...row, interactions: { comments: 0, reactions: 0, authoredComments: 0, authoredReactions: 0, receivedComments: 0, receivedReactions: 0, lastAt: null, urls: [] } };
    current.name ||= row.name; current.org ||= row.org; current.role ||= row.role; current.url ||= row.url;
    for (const field of ['comments', 'reactions', 'authoredComments', 'authoredReactions', 'receivedComments', 'receivedReactions']) current.interactions[field] += Number(row.interactions?.[field]) || 0;
    const at = row.interactions?.lastAt;
    if (at && (!current.interactions.lastAt || Date.parse(at) > Date.parse(current.interactions.lastAt))) current.interactions.lastAt = at;
    current.interactions.urls = [...new Set([...current.interactions.urls, ...(row.interactions?.urls || [])])].slice(0, 8);
    merged.set(key, current);
  }
  return scorePublicRelations([...merged.values()]);
}

export async function fetchPublicLinkedInInteractions(profileUrl, { env = process.env, fetcher = fetch, signal } = {}) {
  const url = linkedinProfileUrl(profileUrl);
  if (!url) throw new Error('Paste a valid public LinkedIn link.');
  const maxPosts = clamp(env.APIFY_INTERACTION_MAX_POSTS, 1, 25, 10);
  const maxComments = clamp(env.APIFY_INTERACTION_MAX_COMMENTS, 0, 200, 50);
  const maxReactions = clamp(env.APIFY_INTERACTION_MAX_REACTIONS, 0, 500, 100);
  const datasetLimit = clamp(env.APIFY_INTERACTION_MAX_ITEMS, 1, 2000, 750);
  const months = clamp(env.APIFY_INTERACTION_MONTHS, 1, 36, 12);
  const since = new Date(); since.setUTCMonth(since.getUTCMonth() - months);
  const postedLimit = months <= 1 ? 'month' : months <= 3 ? '3months' : months <= 6 ? '6months' : months <= 12 ? 'year' : 'any';
  const results = await Promise.allSettled([
    runApifyActor({ actorId: env.APIFY_INTERACTIONS_ACTOR_ID || DEFAULT_INTERACTIONS_ACTOR, maxItems: datasetLimit, maxItemsLimit: 2000, maxResponseBytes: 25_000_000, includeMaxItemsInInput: false, env, fetcher, signal, input: { targetUrls: [url], maxPosts, postedLimitDate: since.toISOString(), scrapeComments: maxComments > 0, maxComments, scrapeReactions: maxReactions > 0, maxReactions, includeQuotePosts: false, includeReposts: false } }),
    runApifyActor({ actorId: env.APIFY_PROFILE_COMMENTS_ACTOR_ID || DEFAULT_COMMENTS_ACTOR, maxItems: maxComments, maxItemsLimit: 200, maxResponseBytes: 15_000_000, env, fetcher, signal, input: { profiles: [url], postedLimit } }),
    runApifyActor({ actorId: env.APIFY_PROFILE_REACTIONS_ACTOR_ID || DEFAULT_REACTIONS_ACTOR, maxItems: maxReactions, maxItemsLimit: 500, maxResponseBytes: 20_000_000, env, fetcher, signal, input: { profiles: [url], postedLimit } }),
  ]);
  const errors = results.flatMap((result, index) => result.status === 'rejected' ? [{ source: ['posts', 'comments', 'reactions'][index], message: result.reason?.message || 'Actor unavailable' }] : []);
  if (results.every((result) => result.status === 'rejected')) throw new Error(errors.map((error) => `${error.source}: ${error.message}`).join('; '));
  const value = (index) => results[index].status === 'fulfilled' ? results[index].value : { actor: null, items: [] };
  const posts = value(0), comments = value(1), reactions = value(2);
  const connections = mergePublicLinkedInRelations([
    normalizePublicLinkedInInteractions(posts.items, url),
    normalizeAuthoredLinkedInActivity(comments.items, url, 'comment'),
    normalizeAuthoredLinkedInActivity(reactions.items, url, 'reaction'),
  ]);
  return { actor: [posts.actor, comments.actor, reactions.actor].filter(Boolean).join(' + '), actors: [posts.actor, comments.actor, reactions.actor].filter(Boolean), connections, posts: posts.items.filter((item) => item?.type === 'post' || !item?.type).length, items: posts.items.length + comments.items.length + reactions.items.length, errors };
}

const connectionDegree = (value) => {
  const raw = String(value || '').toLowerCase();
  if (/^(f|1|1st|first)/.test(raw)) return '1st';
  if (/^(s|2|2nd|second)/.test(raw)) return '2nd';
  if (/^(o|3|3rd|third)/.test(raw)) return '3rd+';
  return '';
};

const authenticatedPerson = (item) => {
  const url = linkedinProfileUrl(item?.profileUrl || item?.linkedinUrl || item?.linkedin || item?.navigationUrl || item?.url);
  const name = String(item?.name || item?.fullName || item?.full_name || `${item?.firstName || ''} ${item?.lastName || ''}`).trim();
  const headline = String(item?.headline || item?.jobtitle || item?.title || '').trim();
  const { role, org } = roleAndOrg(headline);
  const degree = connectionDegree(item?.connectionDegree || item?.degree || item?.network_distance || item?.networkDistance);
  return name && url ? { name, url, role, org, degree, mutualCount: Number(String(item?.mutualConnections || item?.mutual_connections || '').match(/\d+/)?.[0]) || 0 } : null;
};

export function normalizeAuthenticatedLinkedInNetwork(searchItems, mutualGroups = [], actor = DEFAULT_NETWORK_SEARCH_ACTOR) {
  const direct = [];
  for (const item of searchItems || []) {
    const person = authenticatedPerson(item);
    if (person?.degree === '1st') direct.push({ ...person, source: 'linkedin_authenticated', connectedOn: '', strength: .95, actor });
  }
  const paths = [];
  for (const group of mutualGroups) {
    const target = group.target;
    for (const item of group.items || []) {
      const via = authenticatedPerson(item);
      if (!via || via.url === target.url) continue;
      paths.push({
        name: target.name, org: target.org, role: target.role, url: target.url,
        source: 'linkedin_mutual_path', connectedOn: '', strength: .86, actor: group.actor,
        path: { viaName: via.name, viaUrl: via.url, viaRole: via.role || via.org, targetName: target.name, targetUrl: target.url, targetRole: target.role || target.org },
      });
    }
  }
  return [...new Map([...direct, ...paths].map((row) => [`${row.source}|${row.url}|${row.path?.viaUrl || ''}`, row])).values()];
}

function cookieArray(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.length > 20_000) throw new Error('The LinkedIn session is invalid.');
  if (raw.startsWith('[')) {
    let parsed;
    try { parsed = JSON.parse(raw); } catch { throw new Error('The cookie JSON is invalid.'); }
    if (!Array.isArray(parsed) || !parsed.some((cookie) => cookie?.name === 'li_at' && cookie?.value)) throw new Error('The export has no li_at cookie.');
    return parsed.slice(0, 100);
  }
  if (!/^[A-Za-z0-9._=-]{20,}$/.test(raw)) throw new Error('Paste only the li_at value or a valid cookie JSON.');
  return [{ name: 'li_at', value: raw, domain: '.linkedin.com', path: '/', secure: true, httpOnly: true }];
}

export async function fetchAuthenticatedLinkedInNetwork(profile, cookie, { env = process.env, fetcher = fetch, signal } = {}) {
  const cookies = cookieArray(cookie);
  const rawCookie = cookies.find((entry) => entry.name === 'li_at')?.value;
  const industry = String(profile?.project?.sectors?.join(' ') || profile?.project?.one_liner || 'health investor').slice(0, 160);
  const query = `${industry} investor OR "business development"`.slice(0, 240);
  const maxPeople = clamp(env.APIFY_NETWORK_MAX_PEOPLE, 5, 100, 40);
  const search = await runApifyActor({
    actorId: env.APIFY_NETWORK_SEARCH_ACTOR_ID || DEFAULT_NETWORK_SEARCH_ACTOR,
    maxItems: maxPeople, maxItemsLimit: 100, includeMaxItemsInInput: false, env, fetcher, signal,
    input: { searchQuery: query, cookie: rawCookie, connectionDegree: '', maxResults: maxPeople },
  });
  const people = search.items.map(authenticatedPerson).filter(Boolean);
  const targets = people.filter((person) => person.degree === '2nd').slice(0, clamp(env.APIFY_NETWORK_MAX_MUTUAL_TARGETS, 0, 10, 5));
  const mutualResults = await Promise.allSettled(targets.map(async (target) => {
    const result = await runApifyActor({
      actorId: env.APIFY_MUTUALS_ACTOR_ID || DEFAULT_MUTUALS_ACTOR,
      maxItems: clamp(env.APIFY_NETWORK_MAX_MUTUALS, 1, 50, 15), maxItemsLimit: 50,
      includeMaxItemsInInput: false, env, fetcher, signal,
      input: { url: target.url, network: 'F,S', get_only_new: false, cookies },
    });
    return { target, actor: result.actor, items: result.items };
  }));
  const groups = mutualResults.filter((result) => result.status === 'fulfilled').map((result) => result.value);
  const errors = mutualResults.filter((result) => result.status === 'rejected').map((result) => result.reason?.message || 'Mutual-contacts Actor unavailable');
  const rows = normalizeAuthenticatedLinkedInNetwork(search.items, groups, search.actor);
  return { rows, query, people: people.length, direct: rows.filter((row) => row.source === 'linkedin_authenticated').length, mutualPaths: rows.filter((row) => row.source === 'linkedin_mutual_path').length, actors: [search.actor, ...groups.map((group) => group.actor)], errors };
}

const position = (item) => {
  const positions = item.currentPositions || item.currentPosition;
  const current = Array.isArray(positions) ? positions.find((entry) => entry?.current) || positions[0] : positions;
  const experience = Array.isArray(item.experience) ? item.experience.find((entry) => /present/i.test(entry?.endDate?.text || 'Present')) || item.experience[0] : null;
  return {
    role: item.jobTitle || item.title || item.headline || current?.position || current?.title || experience?.position || null,
    org: item.companyName || item.company || current?.companyName || experience?.companyName || '',
  };
};

export function apifyLeads(items, brief, actor = DEFAULT_ACTOR) {
  return items.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const person = String(item.fullName || item.name || `${item.firstName || ''} ${item.lastName || ''}`).trim();
    const { role, org } = position(item);
    const rawUrl = item.linkedinUrl || item.profileUrl || item.url;
    const url = safeUrl(rawUrl);
    if (!person || !org || !url || !/(^|\.)linkedin\.com$/i.test(new URL(url).hostname)) return [];
    const location = typeof item.location === 'string' ? item.location : item.location?.linkedinText || item.location?.parsed?.text || '';
    const quote = JSON.stringify({ name: person, title: role || null, organization: org, location: location || null });
    const source = `Apify · ${actor}`;
    const ev = evidence(source, url, quote, 'profile');
    const requestedType = brief.fundingTypes.includes('partnering') ? 'partnering' : brief.fundingTypes.includes('investment') ? 'investment' : brief.fundingTypes[0];
    return [candidate({
      externalId: String(item.id || item.publicIdentifier || url),
      person,
      role,
      org,
      title: role ? `${role} on ${org}` : `Public profile on ${org}`,
      kind: 'person',
      fundingType: requestedType,
      status: 'unknown',
      contact: { type: 'linkedin', value: url, provenance: `Public profile via ${actor}` },
      evidence: [ev],
      risks: ['Public profile from a third-party Actor; confirm it\'s current before contacting'],
      missing: ['Funding or partnering authority not confirmed', 'No public email'],
      searchText: `${role || ''} ${org} ${item.headline || item.summary || ''} ${brief.industry}`,
    })];
  });
}

export async function apifyPeople(leads, brief, { env = process.env, fetcher = fetch, signal, record, live } = {}) {
  let companies = apifyTargetOrganizations(leads, env);
  let discovery = null;
  if (!companies.length) {
    const direct = await apifySearchPeople(brief, { env, fetcher, signal, record, live });
    discovery = { kind: 'profiles', query: direct.query, people: direct.leads.length };
    companies = [...new Set(direct.leads.map((lead) => lead.org).filter(Boolean))];
    return { companies, discovery, actor: direct.actor, leads: direct.leads };
  }
  if (!companies.length) return { companies, discovery, actor: actorPath(env.APIFY_ACTOR_ID).replace('~', '/'), leads: [] };
  const titles = String(env.APIFY_JOB_TITLES || '')
    .split(/[,;\n]/)
    .map((value) => value.trim())
    .filter(Boolean);
  const { actor, items } = await runApifyActor({
    env, fetcher, signal, record, live,
    input: {
      companies,
      jobTitles: titles.length ? titles.slice(0, 50) : DEFAULT_TITLES,
      profileScraperMode: 'Short ($4 per 1k)',
      companyBatchMode: 'all_at_once',
    },
  });
  return { companies, discovery, actor, leads: apifyLeads(items, brief, actor) };
}
