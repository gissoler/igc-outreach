import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ApolloBudget, preflightApollo } from '../capital/apollo.mjs';
import { resolveApolloContacts } from '../capital/resolver.mjs';

const response = (data, status = 200) => ({ data, status, latencyMs: 3, headers: {}, cached: false });

test('Apollo preflight degrades to not_configured without reading or exposing a key', async () => {
  const result = await preflightApollo({ apiKey: '', domain: 'example.org', asOf: '2026-10-08' });
  assert.equal(result.status, 'not_configured');
  assert.equal(result.configured, false);
  assert.equal(JSON.stringify(result).includes('apiKey'), false);
});

test('Apollo preflight is read-only and records official quota when exposed', async () => {
  const client = {
    health: async () => response({ healthy: true, is_logged_in: true }),
    creditUsage: async () => response({ credit_usage_stats: { lead_credit: { limit: 100, consumed: 4, left_over: 96 } }, current_credit_cycle: { start_date: '2026-10-01T00:00:00Z', end_date: '2026-11-01T00:00:00Z' } }),
    apiUsage: async () => response({}),
    organizationSearch: async () => response({ organizations: [{ id: 'org-1' }] }),
    peopleSearch: async () => response({ people: [{ id: 'p-1' }] }),
  };
  const result = await preflightApollo({ client, domain: 'example.org', asOf: '2026-10-08' });
  assert.equal(result.status, 'connected');
  assert.equal(result.read_only, true);
  assert.equal(result.quota.known, true);
  assert.equal(result.quota.credit_types.lead_credit.left_over, 96);
  assert.deepEqual(result.scope, ['auth_health', 'credit_usage_stats', 'api_usage_stats', 'organization_search', 'people_search']);
});

test('Apollo budget blocks credit use over per-organization and daily caps', () => {
  const budget = new ApolloBudget({ perRun: 4, perOrganization: 1, perDay: 2, clock: () => new Date('2026-10-08T12:00:00Z') });
  budget.consume({ organization: 'example.org', credits: 1 });
  assert.throws(() => budget.consume({ organization: 'example.org', credits: 1 }), /organization credit cap/i);
  budget.consume({ organization: 'second.org', credits: 1 });
  assert.throws(() => budget.consume({ organization: 'third.org', credits: 1 }), /daily credit cap/i);
});

test('resolver requires an exact official-domain match before resolving people', async () => {
  const client = {
    stats: { calls: 2, creditsEstimated: 1 }, cache: { hits: 0 },
    organizationSearch: async ({ domain }) => response({ organizations: [{ id: 'org-1', name: 'Example Capital', primary_domain: domain }] }),
    peopleSearch: async () => response({ people: [{ id: 'p-1', name: 'Alex Rivera', title: 'Partner', organization_name: 'Example Capital', linkedin_url: 'https://www.linkedin.com/in/synthetic-alex' }] }),
  };
  const result = await resolveApolloContacts({ organization_stable_id: 'inv:domain:example.org', canonical_name: 'Example Capital', official_domain: 'example.org', target_roles: ['partner'], as_of: '2026-10-08' }, { client });
  assert.equal(result.organization.match_method, 'exact_domain');
  assert.equal(result.organization.confidence, 1);
  assert.equal(result.people[0].route_type, 'public_affiliation');
  assert.notEqual(result.people[0].route_type, 'verified_network_path');
});

test('name fallback rejects an unrelated Apollo organization', async () => {
  const client = {
    stats: { calls: 2, creditsEstimated: 2 }, cache: { hits: 0 },
    organizationSearch: async ({ domain }) => response({ organizations: domain ? [] : [{ id: 'wrong-org', name: 'Unrelated Ventures', primary_domain: 'unrelated.example' }] }),
    peopleSearch: async () => response({ people: [] }),
  };
  const result = await resolveApolloContacts({ organization_stable_id: 'inv:domain:example.org', canonical_name: 'Example Capital', official_domain: 'example.org', target_roles: ['partner'], as_of: '2026-10-08' }, { client });
  assert.equal(result.status, 'not_found');
  assert.equal(result.organization.match_method, 'not_found');
});

test('official team fallback runs before Apollo people-by-domain fallback', async () => {
  let peopleSearches = 0;
  const client = {
    stats: { calls: 2, creditsEstimated: 2 }, cache: { hits: 0 },
    organizationSearch: async () => response({ organizations: [] }),
    peopleSearch: async () => { peopleSearches++; return response({ people: [{ id: 'apollo-person', name: 'Apollo Person' }] }); },
  };
  const result = await resolveApolloContacts({ organization_stable_id: 'inv:domain:example.org', canonical_name: 'Example Capital', official_domain: 'example.org', target_roles: ['partner'], as_of: '2026-10-08' }, {
    client,
    officialTeamLookup: async () => [{ id: 'official-person', name: 'Official Person', title: 'Partner', organization_name: 'Example Capital', website_url: 'https://example.org/team' }],
  });
  assert.equal(peopleSearches, 0);
  assert.equal(result.people[0].name, 'Official Person');
  assert.equal(result.people[0].verification_status, 'verified');
});

test('a possible bridge never becomes a verified network path without authorized evidence', async () => {
  const client = {
    stats: { calls: 2, creditsEstimated: 1 }, cache: { hits: 0 },
    organizationSearch: async () => response({ organizations: [{ id: 'org-1', name: 'Example Capital', primary_domain: 'example.org' }] }),
    peopleSearch: async () => response({ people: [] }),
  };
  const result = await resolveApolloContacts({ organization_stable_id: 'inv:domain:example.org', canonical_name: 'Example Capital', official_domain: 'example.org', target_roles: ['partner'], as_of: '2026-10-08' }, {
    client,
    officialTeamLookup: async () => [{ id: 'bridge-1', name: 'Taylor Chen', title: 'Portfolio founder', organization_name: 'Example Capital network', website_url: 'https://example.org/team/taylor', _bridge: true }],
    networkLookup: async () => [],
  });
  assert.equal(result.people[0].route_type, 'possible_bridge');
  assert.equal(result.relations[0].route_type, 'public_affiliation');
});

function mjsFiles(root) {
  return readdirSync(root).flatMap((name) => { const path = join(root, name); return statSync(path).isDirectory() ? mjsFiles(path) : path.endsWith('.mjs') ? [path] : []; });
}
test('B0/B1/B2 code cannot import Apollo or capital strategy context', () => {
  const roots = [new URL('../agent', import.meta.url).pathname, new URL('../bench', import.meta.url).pathname];
  // El arnés B3 (run-experiment.mjs) y su preflight importan Apollo a propósito; la garantía es que
  // ningún otro módulo de agent/ o bench/ lo importe y que el arnés solo lo instancie para B3.
  const harness = new Set(['bench/investors/run-experiment.mjs', 'bench/investors/preflight-chain.mjs']);
  const importRe = /^\s*import\b[^;]*from\s+['"][^'"]*(?:capital\/|apollo)[^'"]*['"]|capitalStrategyContext|buildCapitalStrategyContext/m;
  const offenders = roots.flatMap(mjsFiles).filter((file) => !harness.has(file.split('/research/').pop()) && importRe.test(readFileSync(file, 'utf8')));
  assert.deepEqual(offenders, []);
  const runner = readFileSync(new URL('../bench/investors/run-experiment.mjs', import.meta.url), 'utf8');
  assert.match(runner, /const apollo = job\.condition === 'B3' \? createApolloClient\(/);
});
