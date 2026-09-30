import test from 'node:test';
import assert from 'node:assert/strict';
import { firecrawlSearch, grantWebOpportunities, linkedinPublicContent, scrapegraphExtract, webPeople, webProfileLookup, webPublicRelations, verifiedPeople } from '../server/research/webscrape.mjs';
import { addOrgBridges, networkCandidates } from '../server/research/network.mjs';

const brief = { name: 'Gisel Caicedo', company: 'Mentiva', industry: 'mental health', stage: 'pre-seed', fundingTypes: ['investment'] };
const env = { FIRECRAWL_API_KEY: 'fc-secret', SGAI_API_KEY: 'sgai-secret' };
const page = { url: 'https://acmeventures.example/team', title: 'Team · Acme Ventures', markdown: '# Our team\n\nJane Roe is a General Partner at Acme Ventures. Before Acme she worked at Stanford Medicine and Beta Health. Contact jane@acmeventures.example.\n\nJohn Poe, Principal, focuses on digital mental health.'.padEnd(400, ' ') };

function mockFetch(handlers) {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    const body = handlers(url, JSON.parse(init.body));
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  };
  return { fetcher, calls };
}

test('Firecrawl search uses bearer auth and v2 endpoint; ScrapeGraph uses SGAI-APIKEY', async () => {
  const { fetcher, calls } = mockFetch((url) => url.includes('firecrawl') ? { success: true, data: { web: [{ url: page.url, title: page.title, markdown: page.markdown }] } } : { json: { people: [] } });
  const results = await firecrawlSearch('mental health vc', { markdown: true, env, fetcher });
  assert.equal(results[0].url, page.url);
  assert.equal(calls[0].url, 'https://api.firecrawl.dev/v2/search');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer fc-secret');
  assert.deepEqual(calls[0].body.scrapeOptions.formats, ['markdown']);
  await scrapegraphExtract({ markdown: 'x', prompt: 'p' }, { env, fetcher });
  assert.equal(calls[1].url, 'https://v2-api.scrapegraphai.com/api/extract');
  assert.equal(calls[1].init.headers['SGAI-APIKEY'], 'sgai-secret');
  await assert.rejects(() => firecrawlSearch('x', { env: {} }), /FIRECRAWL_API_KEY/);
});

test('grant web discovery recognizes a global challenge without using ScrapeGraph', async () => {
  const challenge = {
    url: 'https://challenge.example/global-challenge/',
    title: 'Global Deep Tech Challenge',
    description: 'Applications open for early-stage startups in digital health.',
    markdown: '# Global Challenge\nApplications close 30 November 2026. A global competition for early-stage digital health and deep-tech startups with a cash prize.'.padEnd(300, ' '),
  };
  const { fetcher, calls } = mockFetch(() => ({ data: { web: [challenge] } }));
  const results = await grantWebOpportunities(
    { industry: 'digital health', product: 'well-being navigation', stage: 'prototype' },
    { terms: [{ term: 'digital health' }, { term: 'mental well-being' }] },
    { env: { FIRECRAWL_API_KEY: 'fc-secret', GRANT_WEB_MAX_SEARCHES: '1' }, fetcher },
  );
  assert.equal(results.length, 1);
  assert.equal(results[0].opportunityType, 'challenge');
  assert.equal(results[0].deadline, '2026-11-30');
  assert.equal(results[0].org, 'challenge.example');
  assert.equal(results.searchAudit[0].query, 'digital health startup challenge prize competition applications open 2026');
  assert.ok(calls.every((call) => call.url.includes('firecrawl')));
});

test('only people literally present on the page survive, with a literal quote', () => {
  const people = verifiedPeople({ organization: 'Acme Ventures', people: [
    { name: 'Jane Roe', title: 'General Partner', affiliations: ['Stanford Medicine', 'Invented Corp'], email: 'jane@acmeventures.example' },
    { name: 'Ghost Person', title: 'Partner' },
  ] }, page);
  assert.equal(people.length, 1);
  assert.deepEqual(people[0].affiliations, ['Stanford Medicine']);
  assert.ok(page.markdown.replace(/\s+/g, ' ').includes(people[0].quote));
});

test('webPeople turns fund team pages into traceable candidates', async () => {
  const { fetcher } = mockFetch((url) => url.includes('firecrawl')
    ? { data: { web: [{ url: page.url, title: page.title, markdown: page.markdown }, { url: 'https://www.linkedin.com/in/x', title: 'x', markdown: page.markdown }] } }
    : { json: { organization: 'Acme Ventures', people: [{ name: 'Jane Roe', title: 'General Partner', organization: 'Acme Ventures', affiliations: ['Beta Health'], email: 'jane@acmeventures.example' }] } });
  const result = await webPeople([], brief, { env, fetcher });
  assert.equal(result.pages, 1, 'LinkedIn pages are never scraped');
  assert.equal(result.leads.length, 1);
  assert.equal(result.leads[0].contact.type, 'email');
  assert.equal(result.leads[0].evidence[0].url, page.url);
  assert.deepEqual(result.leads[0].affiliations, ['Beta Health']);
});

test('profile lookup reads the public search result, not LinkedIn itself', async () => {
  const { fetcher, calls } = mockFetch(() => ({ data: { web: [{ url: 'https://co.linkedin.com/in/gisel-c', title: 'Gisel Caicedo - CEO at Mentiva | LinkedIn', description: 'desc' }] } }));
  const profile = await webProfileLookup('https://www.linkedin.com/in/gisel-c/', { env, fetcher });
  assert.equal(profile.name, 'Gisel Caicedo');
  assert.equal(profile.organization, 'Mentiva');
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.includes('firecrawl'));
});

test('public web relations become network rows', async () => {
  const article = { url: 'https://news.example/panel', title: 'Panel', markdown: 'Panel on AI in mental health with Gisel Caicedo and Ana Pérez (Beta Health), moderated by Luis Gómez.'.padEnd(300, ' ') };
  const { fetcher } = mockFetch((url) => url.includes('firecrawl') ? { data: { web: [article] } } : { json: { people: [{ name: 'Ana Pérez', organization: 'Beta Health', relation: 'panelista' }, { name: 'Gisel Caicedo' }] } });
  const result = await webPublicRelations('https://www.linkedin.com/in/gisel-c/', { env, fetcher, name: 'Gisel Caicedo', org: 'Mentiva' });
  assert.equal(result.connections.length, 1);
  assert.equal(result.connections[0].source, 'web_public_relation');
  assert.equal(result.connections[0].org, 'Beta Health');
});

test('linkedinPublicContent only keeps indexed public posts/pulse pages that literally mention the person', async () => {
  const post = { url: 'https://www.linkedin.com/posts/janeroe_seed-funding-activity-1', title: 'Jane Roe on LinkedIn', markdown: 'Jane Roe: Excited to back more pre-seed health founders this year.'.padEnd(300, ' ') };
  const profilePage = { url: 'https://www.linkedin.com/in/janeroe', title: 'Jane Roe | LinkedIn', markdown: 'Jane Roe profile page, not a post.'.padEnd(300, ' ') };
  const noMatch = { url: 'https://www.linkedin.com/posts/other_activity-2', title: 'Someone else', markdown: 'Nothing to do with the person we searched for.'.padEnd(300, ' ') };
  const { fetcher, calls } = mockFetch(() => ({ data: { web: [post, profilePage, noMatch] } }));
  const result = await linkedinPublicContent('Jane Roe', { env, fetcher, org: 'Acme Ventures' });
  assert.equal(result.posts.length, 1, 'profile pages and unrelated posts are filtered out');
  assert.equal(result.posts[0].url, post.url);
  assert.ok(calls.every((c) => c.body.query.includes('site:linkedin.com')));
});

test('warm paths: investors in your network become candidates and shared organizations become bridges', () => {
  const network = [
    { name: 'Heidi Roizen', org: 'Threshold Ventures, Corporate Director', role: '', url: 'https://www.linkedin.com/in/heidiroizen/', source: 'linkedin_public_interaction', strength: .5, interactions: { urls: ['https://www.linkedin.com/posts/1'] } },
    { name: 'Ana Pérez', org: 'Beta Health', role: 'COO', url: '', source: 'web_public_relation', strength: .5, relation: 'panelista', interactions: { urls: ['https://news.example/panel'] } },
    { name: 'Solo Self', org: 'Self-Employed', source: 'linkedin_public_interaction', strength: .5, interactions: { urls: ['https://www.linkedin.com/posts/2'] } },
  ];
  const fromNetwork = networkCandidates(network, brief);
  assert.deepEqual(fromNetwork.map((l) => l.person), ['Heidi Roizen']);
  const lead = { person: 'Jane Roe', org: 'Acme Ventures', affiliations: ['Beta Health'], paths: [], evidence: [{ url: page.url }] };
  const selfLead = { person: 'Other', org: 'Self-Employed', paths: [], evidence: [{ url: page.url }] };
  const [bridged, notBridged] = addOrgBridges([lead, selfLead], network, brief);
  assert.equal(bridged.paths.length, 1);
  assert.deepEqual(bridged.paths[0].nodes, ['Gisel Caicedo', 'Ana Pérez', 'Jane Roe']);
  assert.equal(bridged.paths[0].hypothesis, true);
  assert.equal(notBridged.paths.length, 0, 'generic organizations never create bridges');
});

test('profile lookup tries more queries and matches the handle case-insensitively', async () => {
  let n = 0;
  const { fetcher } = mockFetch(() => (++n < 2 ? { data: { web: [] } } : { data: { web: [{ url: 'https://co.linkedin.com/in/GisSoler/es', title: 'Gisel Caicedo – Founder at Mentiva | LinkedIn', description: '' }] } }));
  const profile = await webProfileLookup('linkedin.com/in/gissoler', { env, fetcher, name: 'Gisel Caicedo', org: 'Mentiva' });
  assert.equal(profile.name, 'Gisel Caicedo');
  assert.equal(profile.organization, 'Mentiva');
  assert.equal(n, 2);
});
