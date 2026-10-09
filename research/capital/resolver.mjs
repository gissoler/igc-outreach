import { validateCapital } from './contracts.mjs';
import { ApolloApiError } from './apollo.mjs';

const clip = (value, n = 300) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const domainOf = (value) => { try { return new URL(/^https?:\/\//.test(String(value || '')) ? value : `https://${value}`).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };
const roles = (values) => (Array.isArray(values) ? values : []).map((x) => clip(x, 120)).filter(Boolean).slice(0, 12);
const normalizedName = (value) => clip(value, 240).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();
const statusFrom = (error) => error?.status === 402 ? 'insufficient_credits' : error?.status === 403 ? 'unsupported_by_plan' : error?.code === 'APOLLO_NOT_CONFIGURED' ? 'not_configured' : 'error';
const evidence = (source, url, quote, asOf) => ({ source, url: clip(url, 1000), retrieved_at: asOf, quote: clip(quote, 1000) });

function organizationRows(response) { return response?.data?.organizations || response?.data?.accounts || []; }
function peopleRows(response) { return response?.data?.people || []; }
function orgId(row) { return row?.id || row?.organization_id || ''; }
function personName(row) { return clip(row?.name || [row?.first_name, row?.last_name].filter(Boolean).join(' '), 180); }
function personTitle(row) { return clip(row?.title || row?.headline, 180) || null; }
function personUrl(row) { return clip(row?.linkedin_url || row?.apollo_url || row?.website_url, 1000); }

export async function resolveApolloContacts(input, {
  client = null,
  networkLookup = async () => [],
  officialOrganizationLookup = async () => null,
  officialTeamLookup = async () => [],
  maxPeople = 5,
} = {}) {
  const asOf = input.as_of; const domain = domainOf(input.official_domain); const errors = [];
  const baseOrg = { stable_id: clip(input.organization_stable_id, 240), canonical_name: clip(input.canonical_name, 240), official_domain: domain, match_method: 'not_found', confidence: 0 };
  if (!client) return validateCapital('contact_bridge_result', { schema_version: 'contact_bridge_result/1', as_of: asOf, organization: baseOrg, status: 'not_configured', people: [], relations: [], limits: { calls: 0, credits_estimated: 0, cache_hits: 0 }, errors: [] });
  let match = null; let matchMethod = 'not_found'; let confidence = 0;
  try {
    if (domain) {
      const exact = organizationRows(await client.organizationSearch({ domain, perPage: 3 }));
      match = exact.find((row) => domainOf(row?.primary_domain || row?.website_url || row?.website) === domain) || null;
      if (match) { matchMethod = 'exact_domain'; confidence = 1; }
    }
    if (!match && input.canonical_name) {
      const fallback = organizationRows(await client.organizationSearch({ name: input.canonical_name, location: input.location || '', perPage: 3 }));
      const wanted = normalizedName(input.canonical_name);
      match = fallback.find((row) => {
        const found = normalizedName(row?.name);
        return found && (found === wanted || found.includes(wanted) || wanted.includes(found));
      }) || null;
      if (match) { matchMethod = 'name_location'; confidence = 0.65; }
    }
  } catch (error) {
    errors.push(clip(error.message));
    if (error instanceof ApolloApiError || error?.code) return validateCapital('contact_bridge_result', { schema_version: 'contact_bridge_result/1', as_of: asOf, organization: baseOrg, status: statusFrom(error), people: [], relations: [], limits: { calls: client.stats?.calls || 0, credits_estimated: client.stats?.creditsEstimated || 0, cache_hits: client.cache?.hits || 0 }, errors });
  }
  let fallbackRows = [];
  if (!match) {
    const official = await officialOrganizationLookup(input).catch(() => null);
    if (official?.domain && domainOf(official.domain) !== domain) errors.push('Official identity check returned a different domain; Apollo lookup was not retried automatically.');
    fallbackRows = (await officialTeamLookup({ ...input, official_domain: domain }).catch(() => [])).map((row) => ({ ...row, _official_team: true }));
    if (!fallbackRows.length && domain) {
      try { fallbackRows = peopleRows(await client.peopleSearch({ domain, titles: roles(input.target_roles), perPage: Math.min(10, maxPeople) })); }
      catch (error) { errors.push(clip(error.message)); }
    }
    if (!fallbackRows.length) return validateCapital('contact_bridge_result', { schema_version: 'contact_bridge_result/1', as_of: asOf, organization: baseOrg, status: 'not_found', people: [], relations: [], limits: { calls: client.stats?.calls || 0, credits_estimated: client.stats?.creditsEstimated || 0, cache_hits: client.cache?.hits || 0 }, errors });
  }
  const canonical = clip(match?.name || input.canonical_name, 240); const matchedDomain = domainOf(match?.primary_domain || match?.website_url || match?.website) || domain;
  let rows = [];
  try { rows = fallbackRows.length ? fallbackRows : peopleRows(await client.peopleSearch({ domain: matchedDomain, organizationId: orgId(match), titles: roles(input.target_roles), perPage: Math.min(10, maxPeople) })); }
  catch (error) { errors.push(clip(error.message)); }
  if (!rows.length) {
    const team = await officialTeamLookup({ ...input, official_domain: matchedDomain }).catch(() => []);
    rows = (Array.isArray(team) ? team : []).map((row) => ({ ...row, _official_team: true }));
  }
  const people = [];
  const relations = [];
  for (const row of rows.slice(0, maxPeople)) {
    const name = personName(row); if (!name) continue;
    const title = personTitle(row); const url = personUrl(row); const org = clip(row?.organization?.name || row?.organization_name || canonical, 240);
    const network = await networkLookup({ name, organization: org, url, as_of: asOf }).catch(() => []);
    const verified = (Array.isArray(network) ? network : []).find((path) => path?.verified === true && Array.isArray(path.evidence) && path.evidence.length);
    const routeType = verified ? 'verified_network_path' : row._bridge ? 'possible_bridge' : 'public_affiliation';
    const ev = [evidence(row._official_team ? 'Official team page' : 'Apollo people search', url || `https://${matchedDomain}`, `${name}${title ? ` · ${title}` : ''} · ${org}`, asOf)];
    if (verified) ev.push(...verified.evidence.map((item) => evidence(item.source || 'Authorized network', item.url || '', item.quote || item.relation || 'Verified network record', item.observed_at || asOf)));
    people.push({
      person_id: clip(row.id || row.person_id || `person:${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, 240), name, title, organization: org,
      reason: title ? `Role at the selected organization matches or may overlap the requested functions: ${title}.` : 'Public affiliation found; decision authority is not confirmed.',
      channel: url ? { type: /linkedin\.com/i.test(url) ? 'linkedin' : 'profile', value: url } : null,
      verification_status: row._official_team ? 'verified' : 'unverified', route_type: routeType,
      confidence: verified ? 0.95 : row._official_team ? 0.8 : 0.65, evidence: ev,
      next_action: verified ? 'Ask the verified connector whether they know this person and would be comfortable making a double-opt-in introduction.' : 'Verify the current role on the organization’s official site, then use a public channel or investigate a bridge.',
    });
    relations.push({ from: org, to: name, direction: 'outbound', type: 'public_employment_affiliation', route_type: verified ? 'verified_network_path' : 'public_affiliation', confidence: verified ? 0.95 : row._official_team ? 0.8 : 0.65, source: row._official_team ? 'Official team page' : 'Apollo people search', observed_at: asOf });
  }
  return validateCapital('contact_bridge_result', {
    schema_version: 'contact_bridge_result/1', as_of: asOf,
    organization: { stable_id: baseOrg.stable_id, canonical_name: canonical, official_domain: matchedDomain, match_method: matchMethod, confidence },
    status: people.length ? (errors.length ? 'partial' : 'resolved') : 'partial', people, relations,
    limits: { calls: client.stats?.calls || 0, credits_estimated: client.stats?.creditsEstimated || 0, cache_hits: client.cache?.hits || 0 }, errors,
  });
}
