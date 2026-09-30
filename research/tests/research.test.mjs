import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  validateBrief,
  candidate,
  evidence,
  evaluate,
  dedupe,
  buildDraft,
  csvFor,
  safeUrl,
} from '../server/research/core.mjs';
import {
  parseConnections,
  parseContactCsv,
  parseCalendar,
  addConnections,
} from '../server/research/network.mjs';
import {
  openalexLeads,
  grantLead,
  reporterLeads,
  makeClient,
  teamFacts,
} from '../server/research/providers.mjs';
import { createStore } from '../server/research/store.mjs';
import { runResearch } from '../server/research/pipeline.mjs';
import { apifyDiscoverCompanies, apifyLeads, apifyPeople, apifySearchPeople, apifyTargetOrganizations, enrichLinkedInProfile, fetchPublicLinkedInInteractions, mergePublicLinkedInRelations, normalizeAuthenticatedLinkedInNetwork, normalizeAuthoredLinkedInActivity, normalizeLinkedInProfile, normalizePublicLinkedInInteractions, runApifyActor } from '../server/research/apify.mjs';
import { createApp } from '../server/index.mjs';
import { applyJevDecisions, askJev, jevQuestions, jevState } from '../server/research/jev.mjs';
import { buildNetworkGraph } from '../server/research/networkGraph.mjs';
const brief = {
  name: 'Tester',
  role: 'Founder',
  company: 'Test Company',
  product: 'Test project',
  description: 'Alzheimer agitation research',
  industry: 'Alzheimer agitation neuroscience',
  stage: 'clinical_phase_2',
  geography: 'US',
  fundingTypes: ['partnering'],
  dataMode: 'live',
  useTeam: false,
  minDays: 30,
};
const ev = evidence(
  'Fixture',
  'https://example.org/source',
  'Alzheimer agitation research',
  'title',
);
const lead = () =>
  candidate({
    org: 'Example',
    title: 'Alzheimer agitation research',
    evidence: [ev],
    fundingType: 'partnering',
  });
const valid = () => validateBrief(brief);
test('validates mandatory fields, funding types, amount, mode and integer horizon', () => {
  for (const patch of [
    { name: '' },
    { fundingTypes: [] },
    { fundingTypes: ['made-up'] },
    { amount: -1 },
    { amount: 'NaN' },
    { dataMode: 'auto' },
    { minDays: 1.5 },
    { description: 3 },
  ])
    assert.throws(() => validateBrief({ ...brief, ...patch }));
  assert.equal(valid().amount, null);
});
test('unsafe provenance URLs are rejected', () => {
  assert.equal(safeUrl('javascript:alert(1)'), null);
  assert.throws(() => evidence('x', 'javascript:x', 'foo', 'title'));
});
test('dedupe merges evidence without conflating different people or organizations', () => {
  const a = { ...lead(), person: 'Jane Doe', org: 'Org A' },
    b = {
      ...a,
      evidence: [
        evidence('Fixture', 'https://example.org/2', 'Second paper', 'work'),
      ],
    };
  const result = dedupe([a, b, { ...a, org: 'Org B' }]);
  assert.equal(result.length, 2);
  assert.equal(result[0].evidence.length, 2);
});
test('expired and too-soon opportunities never enter top; date is evaluated at runtime', () => {
  const ranked = evaluate(
    [
      { ...lead(), deadline: '2026-09-01', status: 'open' },
      { ...lead(), title: 'Second', deadline: '2026-10-01', status: 'open' },
    ],
    valid(),
    new Set(),
    new Date('2026-09-24T12:00:00Z'),
  );
  assert.ok(ranked.every((l) => l.bucket === 'radar'));
  assert.equal(
    ranked.find((l) => l.deadline === '2026-09-01').status,
    'closed',
  );
});
test('ranking is deterministic, strictly typed and explains every score component', () => {
  const b = valid(),
    candidates = [
      lead(),
      { ...lead(), org: 'Different', fundingType: 'grant' },
    ];
  const first = evaluate(candidates, b, new Set(), new Date('2026-09-24'));
  const second = evaluate(
    [...candidates].reverse(),
    b,
    new Set(),
    new Date('2026-09-24'),
  );
  assert.deepEqual(
    first.map((l) => l.id),
    second.map((l) => l.id),
  );
  assert.ok(first[0].score > first[1].score);
  assert.equal(
    evaluate(candidates, { ...b, strictTypes: true })[1].bucket,
    'discarded',
  );
  assert.equal(
    first[0].score,
    Math.round(first[0].breakdown.reduce((n, x) => n + x.points, 0)),
  );
});
test('Jev receives minimal public state and routes uncertain candidates to human review', async () => {
  const ranked = evaluate([{ ...lead(), person: 'Jane Doe', role: 'Investor', contact: { type: 'email', value: 'private@example.org', provenance: 'private import' } }], valid());
  const state = jevState(ranked, valid());
  assert.equal(JSON.stringify(state).includes('private@example.org'), false);
  assert.equal(Object.keys(jevQuestions(1)).length, 3);
  let request;
  const result = await askJev(ranked, valid(), {
    env: { JEV_API_KEY: 'test-key', JEV_API_URL: 'https://jevmodel.net/v1/systemone' },
    fetcher: async (_url, options) => {
      request = JSON.parse(options.body);
      return new Response(JSON.stringify({ model: 'jev-1.13.0', answers: {
        candidate_0_action: { type: 'choice', choice: 'investigate_more', confidence: .84, probabilities: { prioritize: .12, investigate_more: .84, discard: .04 } },
        candidate_0_fit: { type: 'score', score: 2.4, confidence: .72, probabilities: { 0: 0, 1: .1, 2: .4, 3: .5, 4: 0 }, legend: {} },
        candidate_0_evidence: { type: 'noul', noul: .4 },
      } }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  assert.equal(request.model, 'jev-latest');
  assert.equal(result.decisions[0].action, 'investigate_more');
  const applied = applyJevDecisions(ranked, result);
  assert.equal(applied[0].bucket, 'radar');
  assert.match(applied[0].missing.join(' '), /more evidence/);
});
test('missing evidence, exclusion, competitors and prior rejection stay out of top', () => {
  assert.equal(
    evaluate([{ ...lead(), evidence: [] }], valid())[0].bucket,
    'discarded',
  );
  assert.equal(
    evaluate([lead()], { ...valid(), exclusions: 'Example' })[0].bucket,
    'discarded',
  );
  assert.equal(
    evaluate([{ ...lead(), risks: ['competitor_conflict'] }], {
      ...valid(),
      excludeCompetitors: true,
    })[0].bucket,
    'discarded',
  );
  const key = dedupe([lead()])[0].key;
  assert.equal(
    evaluate([lead()], valid(), new Set([key]))[0].bucket,
    'discarded',
  );
});
test('draft never interpolates confidential free-form data, fabricated sender or contact', () => {
  const b = {
    ...valid(),
    name: 'SECRET CEO',
    company: 'SECRET COMPANY',
    description: 'Unannounced efficacy 99.9%',
    amount: 777777,
    event: 'Private deal 2035',
  };
  const draft = buildDraft(lead(), b, []);
  assert.doesNotMatch(draft.body, /SECRET|99.9|777777|2035/);
  assert.ok(draft.wordCount <= 120);
  assert.match(draft.body, /20 minutes/);
  assert.match(draft.body, /confirm before sending/);
});
test('CSV quotes fields and neutralizes spreadsheet formulas', () => {
  const l = evaluate([{ ...lead(), org: '=HYPERLINK("bad")' }], valid())[0];
  l.draft = buildDraft(l, valid());
  const csv = csvFor({ mode: 'live', leads: [l] });
  assert.match(csv, /'=HYPERLINK/);
  assert.match(csv, /https:\/\/example.org\/source/);
});
test('LinkedIn CSV supports preamble, commas and quoted cells; no guessed emails', () => {
  const rows = parseConnections(
    'Notes:\nExport\n\nFirst Name,Last Name,URL,Email Address,Company,Position,Connected On\nJane,Doe,https://www.linkedin.com/in/example,private@sample.test,"Acme, Inc.",Director,01 Jan 2024\n',
  );
  assert.equal(rows[0].org, 'Acme, Inc.');
  assert.equal(rows[0].email, undefined);
  assert.throws(() => parseConnections('Name,Email\nX,Y'));
  const result = addConnections(
    [{ ...lead(), person: 'Jane Doe', org: 'Acme, Inc.' }],
    rows,
    valid(),
  );
  assert.equal(result[0].paths[0].hypothesis, true);
  assert.equal(result[0].evidence.at(-1).verified, false);
  assert.equal(
    addConnections(
      [{ ...lead(), person: 'Jane Doe', org: 'Other' }],
      rows,
      valid(),
    )[0].paths.length,
    0,
  );
});
test('contact exports and calendar attendees normalize without reading message content', () => {
  const contacts = parseContactCsv(
    'Full Name,Company Name,Job Title,Notes\nJane Doe,Target Co,Partner,private message body\n',
    'gmail',
  );
  assert.deepEqual(contacts, [{
    name: 'Jane Doe', org: 'Target Co', role: 'Partner', url: null,
    connectedOn: '', source: 'gmail',
  }]);
  assert.equal(JSON.stringify(contacts).includes('private message body'), false);
  const calendar = parseCalendar([
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'DESCRIPTION:confidential agenda',
    'ATTENDEE;CN="Alex Smith":mailto:alex@example.org',
    'ATTENDEE;CN="Alex Smith":mailto:alex@example.org',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n'));
  assert.equal(calendar.length, 1);
  assert.equal(calendar[0].name, 'Alex Smith');
  assert.equal(calendar[0].org, 'example.org');
  assert.equal(JSON.stringify(calendar).includes('confidential agenda'), false);
});
test('Apify uses bearer authentication, bounded actor input and returns dataset items', async () => {
  let request;
  const result = await runApifyActor({
    env: { APIFY_TOKEN: 'secret-token', APIFY_ACTOR_ID: 'owner/people', APIFY_MAX_ITEMS: '7' },
    fetcher: async (url, init) => {
      request = { url, init };
      return new Response(JSON.stringify([{ id: 'one' }]));
    },
  });
  assert.equal(request.url, 'https://api.apify.com/v2/acts/owner~people/run-sync-get-dataset-items?clean=true&limit=7');
  assert.equal(request.init.headers.Authorization, 'Bearer secret-token');
  assert.equal(request.url.includes('secret-token'), false);
  assert.equal(JSON.parse(request.init.body).maxItems, 7);
  assert.deepEqual(result.items, [{ id: 'one' }]);
  await assert.rejects(() => runApifyActor({ input: {}, env: {} }), /APIFY_TOKEN/);
});
test('authenticated Apify inputs never expose the LinkedIn session in events or errors', async () => {
  const events = [];
  const live = (event) => events.push(event);
  live.secrets = [];
  const session = 'AQEDAT_this_is_a_sensitive_linkedin_session_value';
  await assert.rejects(() => runApifyActor({
    input: { searchQuery: 'investor', cookie: session }, actorId: 'owner/network',
    env: { APIFY_TOKEN: 'apify-secret' }, live,
    fetcher: async () => new Response(`invalid cookie ${session}`, { status: 422 }),
  }), /Apify HTTP 422$/);
  assert.equal(JSON.stringify(events).includes(session), false);
  assert.equal(JSON.stringify(events).includes('"cookie"'), false);
});
test('Apify profiles become traceable leads and target organizations stay bounded', () => {
  const targets = apifyTargetOrganizations([
    { kind: 'research', org: 'Target Pharma' },
    { kind: 'research', org: 'Target Pharma' },
    { kind: 'research', org: 'Example University' },
  ], { APIFY_TARGET_COMPANIES: 'Configured Ventures', APIFY_MAX_COMPANIES: '2' });
  assert.deepEqual(targets, ['Configured Ventures', 'Target Pharma']);
  const leads = apifyLeads([{
    id: 'profile-1', firstName: 'Jane', lastName: 'Doe', headline: 'VP Business Development',
    linkedinUrl: 'https://www.linkedin.com/in/jane-doe', currentPositions: [{ companyName: 'Target Pharma', title: 'VP Business Development', current: true }],
    location: { linkedinText: 'Boston, MA' },
  }, { name: 'Unsafe', companyName: 'Target', url: 'https://evil.example/profile' }], valid(), 'owner/people');
  assert.equal(leads.length, 1);
  assert.equal(leads[0].person, 'Jane Doe');
  assert.equal(leads[0].org, 'Target Pharma');
  assert.equal(leads[0].contact.value, 'https://www.linkedin.com/in/jane-doe');
  assert.equal(leads[0].evidence[0].source, 'Apify · owner/people');
});
test('Apify searches relevant people directly when public sources found no target companies', async () => {
  const requests = [];
  const fetcher = async (url, init) => {
    requests.push({ url, body: JSON.parse(init.body) });
    return new Response(JSON.stringify([{ id: 'p1', fullName: 'Jane Investor', linkedinUrl: 'https://www.linkedin.com/in/jane-investor', currentPositions: [{ companyName: 'Mindful Ventures', title: 'Partner', current: true }] }]));
  };
  const result = await apifyPeople([], { ...valid(), industry: 'mental health', fundingTypes: ['investment'] }, { env: { APIFY_TOKEN: 'secret' }, fetcher });
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /linkedin-profile-search/);
  assert.equal(requests[0].body.searchQuery, 'mental health investor');
  assert.equal(result.leads[0].person, 'Jane Investor');
  assert.equal(result.discovery.people, 1);
  assert.deepEqual(result.companies, ['Mindful Ventures']);
  const skippedPeople = await apifySearchPeople({ ...valid(), fundingTypes: ['grant'] }, { env: { APIFY_TOKEN: 'secret' }, fetcher });
  assert.deepEqual(skippedPeople.leads, []);
});
test('Apify company discovery remains available for explicit organization searches', async () => {
  const fetcher = async () => new Response(JSON.stringify([{ name: 'Mindful Ventures', linkedinUrl: 'https://www.linkedin.com/company/mindful-ventures' }]));
  const discovered = await apifyDiscoverCompanies({ ...valid(), industry: 'mental health', fundingTypes: ['investment'] }, { env: { APIFY_TOKEN: 'secret' }, fetcher });
  assert.deepEqual(discovered.companies, ['https://www.linkedin.com/company/mindful-ventures']);
  const skipped = await apifyDiscoverCompanies({ ...valid(), fundingTypes: ['grant'] }, { env: { APIFY_TOKEN: 'secret' }, fetcher });
  assert.deepEqual(skipped.companies, []);
});
test('LinkedIn profile enrichment accepts one public profile URL and returns normalized evidence', async () => {
  let request;
  const profile = await enrichLinkedInProfile('https://www.linkedin.com/in/jane-doe/', {
    env: { APIFY_TOKEN: 'secret-token' },
    fetcher: async (url, init) => {
      request = { url, init };
      return new Response(JSON.stringify([{
        firstName: 'Jane', lastName: 'Doe', linkedinUrl: 'https://www.linkedin.com/in/jane-doe',
        headline: 'Founder', currentPosition: [{ companyName: 'Example Labs' }],
        location: { linkedinText: 'Bogotá, Colombia' },
      }]));
    },
  });
  assert.match(request.url, /harvestapi~linkedin-profile-scraper/);
  assert.deepEqual(JSON.parse(request.init.body).urls, ['https://www.linkedin.com/in/jane-doe/']);
  assert.equal(profile.name, 'Jane Doe');
  assert.equal(profile.organization, 'Example Labs');
  assert.equal(profile.source, 'Public LinkedIn profile via Apify');
  assert.throws(() => normalizeLinkedInProfile(null, 'https://www.linkedin.com/in/jane-doe'), /No public information/);
  await assert.rejects(() => enrichLinkedInProfile('https://example.com/jane', { env: { APIFY_TOKEN: 'x' } }), /valid (profile|public LinkedIn) link/);
});
test('public LinkedIn interactions normalize people and create evidence-backed warm paths', async () => {
  const rows = normalizePublicLinkedInInteractions([{
    type: 'post', linkedinUrl: 'https://www.linkedin.com/posts/founder_example-activity-1',
    postedAt: { date: new Date().toISOString() },
    comments: [{ actor: { name: 'Jane Doe', linkedinUrl: 'https://www.linkedin.com/in/jane-doe', position: 'Partner at Target Co' }, createdAt: new Date().toISOString() }],
    reactions: [{ actor: { name: 'Jane Doe', linkedinUrl: 'https://www.linkedin.com/in/jane-doe', position: 'Partner at Target Co' } }],
  }], 'https://www.linkedin.com/in/founder');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].org, 'Target Co');
  assert.equal(rows[0].interactions.comments, 1);
  assert.equal(rows[0].interactions.reactions, 1);
  assert.ok(rows[0].strength > 0.35);
  const result = addConnections([{ ...lead(), person: 'Jane Doe', org: 'Target Co', contact: { type: 'linkedin', value: 'https://www.linkedin.com/in/jane-doe/' } }], rows, valid());
  assert.match(result[0].paths[0].hops[0].relation, /Documented public relationship/);
  assert.equal(result[0].evidence.at(-1).verified, true);
});
test('public interaction lookup uses the cookieless bounded actor contract', async () => {
  const requests = [];
  const result = await fetchPublicLinkedInInteractions('https://www.linkedin.com/in/founder/', {
    env: { APIFY_TOKEN: 'secret', APIFY_INTERACTION_MAX_POSTS: '3', APIFY_INTERACTION_MAX_COMMENTS: '4', APIFY_INTERACTION_MAX_REACTIONS: '5' },
    fetcher: async (url, init) => {
      requests.push({ url, body: JSON.parse(init.body) });
      return new Response(JSON.stringify([]));
    },
  });
  assert.equal(requests.length, 3);
  const posts = requests.find((request) => /linkedin-profile-posts/.test(request.url));
  const comments = requests.find((request) => /linkedin-profile-comments/.test(request.url));
  const reactions = requests.find((request) => /linkedin-profile-reactions/.test(request.url));
  assert.deepEqual(posts.body.targetUrls, ['https://www.linkedin.com/in/founder/']);
  assert.equal(posts.body.maxPosts, 3);
  assert.equal(posts.body.maxComments, 4);
  assert.equal(posts.body.maxReactions, 5);
  assert.deepEqual(comments.body.profiles, ['https://www.linkedin.com/in/founder/']);
  assert.equal(comments.body.maxItems, 4);
  assert.deepEqual(reactions.body.profiles, ['https://www.linkedin.com/in/founder/']);
  assert.equal(reactions.body.maxItems, 5);
  assert.ok(requests.every((request) => !('cookies' in request.body)));
  assert.deepEqual(result.connections, []);
});
test('authored LinkedIn activity maps the owner to post authors and merges directions', () => {
  const owner = 'https://www.linkedin.com/in/founder/';
  const authored = normalizeAuthoredLinkedInActivity([{
    linkedinUrl: 'https://www.linkedin.com/feed/update/example', createdAt: new Date().toISOString(),
    actor: { name: 'Founder', linkedinUrl: owner },
    post: { linkedinUrl: 'https://www.linkedin.com/posts/jane-example', author: { name: 'Jane Doe', linkedinUrl: 'https://www.linkedin.com/in/jane-doe', info: 'Partner at Target Co' } },
  }], owner, 'comment');
  const inbound = normalizePublicLinkedInInteractions([{
    type: 'post', linkedinUrl: 'https://www.linkedin.com/posts/founder-example',
    comments: [{ actor: { name: 'Jane Doe', linkedinUrl: 'https://www.linkedin.com/in/jane-doe', position: 'Partner at Target Co' } }],
  }], owner);
  const merged = mergePublicLinkedInRelations([authored, inbound]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].org, 'Target Co');
  assert.equal(merged[0].interactions.authoredComments, 1);
  assert.equal(merged[0].interactions.receivedComments, 1);
  assert.equal(merged[0].interactions.comments, 2);
});
test('authenticated LinkedIn rows build verified direct and two-hop graph paths', () => {
  const rows = normalizeAuthenticatedLinkedInNetwork([
    { name: 'Direct Person', headline: 'Partner at Fund A', profileUrl: 'https://www.linkedin.com/in/direct/', connectionDegree: '1st' },
    { name: 'Target Person', headline: 'Investor at Fund B', profileUrl: 'https://www.linkedin.com/in/target/', connectionDegree: '2nd', mutualConnections: '1 mutual connection' },
  ], [{
    target: { name: 'Target Person', role: 'Investor', org: 'Fund B', url: 'https://www.linkedin.com/in/target/' },
    actor: 'data_link_miner/linkedin-shared-connections',
    items: [{ full_name: 'Mutual Person', jobtitle: 'Founder at Company', linkedin: 'https://www.linkedin.com/in/mutual/', network_distance: '1' }],
  }]);
  assert.equal(rows.filter((row) => row.source === 'linkedin_authenticated').length, 1);
  assert.equal(rows.filter((row) => row.source === 'linkedin_mutual_path').length, 1);
  const profile = { founder: { name: 'Tester', org: 'Test Company', linkedin_url: 'https://www.linkedin.com/in/tester/' } };
  const graph = buildNetworkGraph(profile, rows);
  assert.equal(graph.summary.verified, 3);
  assert.equal(graph.summary.mutualPaths, 1);
  const connected = addConnections([{ ...lead(), person: 'Target Person', org: 'Fund B', contact: { type: 'linkedin', value: 'https://www.linkedin.com/in/target/' } }], rows, valid());
  assert.deepEqual(connected[0].paths[0].nodes, ['Tester', 'Mutual Person', 'Target Person']);
  assert.equal(connected[0].paths[0].hypothesis, false);
});
test('OpenAlex requires actual coauthorship and preserves historical affiliation', () => {
  const data = {
    results: [
      {
        id: 'https://openalex.org/W1',
        title: 'Alzheimer agitation',
        publication_year: 2024,
        authorships: [
          {
            author: {
              id: 'https://openalex.org/A5060487287',
              display_name: 'Jeffrey L. Cummings',
            },
          },
          {
            author: {
              id: 'https://openalex.org/A2',
              display_name: 'Researcher Example',
            },
            institutions: [{ type: 'company', display_name: 'Otsuka' }],
          },
        ],
      },
    ],
  };
  const b = {
    ...valid(),
    company: 'IGC Pharma',
    name: 'Ram Mukunda',
    useTeam: true,
  };
  const team = evidence(
    'IGC',
    'https://igcpharma.com/team/',
    'Advisor Prof. Jeffrey L. Cummings',
    'team',
  );
  const [l] = openalexLeads(data, b, team);
  assert.equal(l.paths.length, 1);
  assert.equal(l.role, null);
  assert.ok(l.risks.includes('competitor_conflict'));
  data.results[0].authorships.shift();
  assert.equal(openalexLeads(data, b, team)[0].paths.length, 0);
});
test('Grants.gov maps public contact, real ceiling and structured date without inferring eligibility', () => {
  const l = grantLead(
    {
      id: '1',
      number: 'RFA-TEST',
      title: 'Alzheimer &amp; data',
      agency: 'NIH',
      oppStatus: 'posted',
      closeDate: '12/01/2026',
    },
    {
      synopsis: {
        awardCeiling: 250000,
        agencyContactEmail: 'official@example.org',
        applicantEligibilityDesc: 'Small businesses',
      },
    },
  );
  assert.equal(l.deadline, '2026-12-01');
  assert.equal(l.amount, 250000);
  assert.equal(l.contact.value, 'official@example.org');
  assert.equal(
    l.evidence.find((e) => e.field === 'contact').quote,
    'official@example.org',
  );
});
test('NIH awards are not represented as funds available to the applicant', () => {
  const [l] = reporterLeads({
    results: [
      {
        appl_id: 1,
        project_title: 'Research',
        organization: { org_name: 'University' },
        award_amount: 500000,
        principal_investigators: [{ full_name: 'PI Example' }],
      },
    ],
  });
  assert.equal(l.amount, null);
  assert.equal(l.status, 'unknown');
  assert.match(l.risks.join(' '), /Past funding|past/i);
});
test('HTTP adapter surfaces rate limits, malformed JSON, robots and timeouts', async () => {
  await assert.rejects(
    makeClient({ fetcher: async () => new Response('', { status: 429 }) }).json(
      'https://example.org',
    ),
    /429/,
  );
  await assert.rejects(
    makeClient({ fetcher: async () => new Response('not json') }).json(
      'https://example.org',
    ),
    SyntaxError,
  );
  await assert.rejects(
    makeClient({
      fetcher: async () => new Response('User-agent: *\nDisallow: /'),
    }).page('https://example.org/source'),
    /robots/,
  );
  await assert.rejects(
    makeClient({
      fetcher: async () => {
        throw new DOMException('Timed out', 'TimeoutError');
      },
    }).json('https://example.org'),
    /Timed out/,
  );
});
test('server persists jobs and scoped feedback across restarts; interrupts stale running jobs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'research-test-'));
  const path = join(dir, 'test.sqlite');
  let store = createStore(path);
  store.save({ id: 'one', brief: valid(), status: 'running', events: [] });
  store.feedback(valid(), 'key', { decision: 'reject' });
  store.close();
  store = createStore(path);
  assert.equal(store.get('one').status, 'failed');
  assert.equal(store.feedbackFor(valid()).get('key').decision, 'reject');
  assert.equal(store.feedbackFor({ ...valid(), name: 'Other user' }).size, 0);
  assert.equal(store.feedbackFor({ ...valid(), dataMode: 'demo' }).size, 0);
  store.close();
  rmSync(dir, { recursive: true });
});
test('partial pipeline preserves successful results and never loads demo automatically', async () => {
  const store = createStore(':memory:');
  const job = {
    id: 'p',
    brief: valid(),
    mode: 'live',
    events: [],
    leads: [],
    senderEvidence: [],
  };
  await runResearch(job, store, {
    env: {},
    providers: [
      ['ok', async () => [lead()]],
      [
        'failed',
        async () => {
          throw new Error('Unavailable');
        },
      ],
    ],
  });
  assert.equal(job.status, 'partial');
  assert.equal(job.leads.length, 1);
  assert.equal(job.leads[0].demo, false);
  assert.ok(job.events.some((e) => e.message.includes('Unavailable')));
  store.close();
});
test('empty live result remains empty with no demo substitution', async () => {
  const store = createStore(':memory:');
  const job = {
    id: 'empty',
    brief: valid(),
    mode: 'live',
    events: [],
    leads: [],
    senderEvidence: [],
  };
  await runResearch(job, store, {
    env: {},
    providers: [['empty', async () => []]],
  });
  assert.equal(job.leads.length, 0);
  store.close();
});
test('demo is explicit and every candidate is fictitious with unverified evidence', async () => {
  const store = createStore(':memory:');
  const job = {
    id: 'd',
    brief: { ...valid(), dataMode: 'demo' },
    mode: 'demo',
    events: [],
    leads: [],
    senderEvidence: [],
  };
  await runResearch(job, store);
  assert.equal(job.leads.length, 7);
  assert.ok(
    job.leads.every(
      (l) =>
        l.demo &&
        l.evidence.every((e) => !e.verified) &&
        l.draft.body.startsWith('[DEMO'),
    ),
  );
  store.close();
});
test('API end-to-end: validation, job, evidence, feedback, export, history and origin protection', async () => {
  const store = createStore(':memory:');
  const { server } = createApp({ store, env: {} });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/api/research`;
  try {
    const post = (path, body, extra = {}) =>
      fetch(url + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...extra },
        body: JSON.stringify(body),
      });
    assert.equal((await post('/jobs', {})).status, 400);
    assert.equal((await fetch(url + '/network/status')).status, 400);
    const networkCsv =
      'First Name,Last Name,URL,Company,Position,Connected On\nJane,Doe,https://www.linkedin.com/in/jane-doe,Acme,Director,01 Jan 2026\n';
    assert.equal(
      (await post('/network', {
        name: 'New User',
        company: 'New Co',
        csv: networkCsv,
      })).status,
      200,
    );
    const networkStatus = await (
      await fetch(url + '/network/status?name=New%20User&company=New%20Co')
    ).json();
    assert.deepEqual(networkStatus, { connected: true, count: 1 });
    const started = await post('/jobs', { ...brief, dataMode: 'demo' });
    assert.equal(started.status, 202);
    const { jobId } = await started.json();
    const job = await (await fetch(url + '/jobs/' + jobId)).json();
    assert.equal(job.status, 'done');
    assert.equal(job.leads.length, 7);
    const saved = await post('/jobs/' + jobId + '/feedback', {
      leadId: job.leads[0].id,
      decision: 'reject',
      reason: 'not_relevant',
      note: 'test',
    });
    assert.equal(saved.status, 200);
    assert.equal(
      (await (await fetch(url + '/jobs/' + jobId)).json()).leads[0].feedback
        .decision,
      'reject',
    );
    assert.match(
      await (await fetch(url + '/jobs/' + jobId + '/export.csv')).text(),
      /DEMO/,
    );
    assert.equal((await (await fetch(url + '/jobs')).json()).length, 1);
    assert.equal(
      (await post('/jobs', brief, { Origin: 'https://evil.example' })).status,
      403,
    );
  } finally {
    await new Promise((r) => server.close(r));
    store.close();
  }
});
test('the browser workspace persists profile, sources and session (no sign-in)', async () => {
  const store = createStore(':memory:');
  const { server } = createApp({
    store,
    env: { FIRECRAWL_API_KEY: 'fc-test', SGAI_API_KEY: 'sgai-test' },
    profileLookup: async (url) => ({
      linkedinUrl: url, name: 'New Founder', headline: 'CEO at New Company', role: 'CEO',
      organization: 'New Company', location: 'Maryland, US', verifiedAt: '2026-09-25T00:00:00.000Z',
      source: 'Public LinkedIn profile via Apify',
    }),
    interactionLookup: async () => ({ actor: 'harvestapi/linkedin-profile-posts', posts: 2, items: 3, connections: [{
      name: 'Jane Doe', org: 'Target Co', role: 'Partner', url: 'https://www.linkedin.com/in/jane-doe/', connectedOn: '', source: 'linkedin_public_interaction', strength: .6,
      interactions: { comments: 1, reactions: 2, lastAt: '2026-09-24T00:00:00.000Z', urls: ['https://www.linkedin.com/posts/example'] },
    }] }),
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/research`;
  try {
    const register = await fetch(url + '/auth/browser', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'k'.repeat(40) }),
    });
    assert.equal(register.status, 200);
    const cookie = register.headers.get('set-cookie').split(';')[0];
    assert.match(cookie, /^wp_session=/);
    const profile = {
      founder: { name: 'New Founder', title: 'CEO', email: 'founder@example.test', linkedin_url: '', org: 'New Company' },
      project: { name: 'New Product', one_liner: 'Data product', description: 'A test project', sectors: ['AI'], keywords: [], stage: 'seed', raise_usd: 100000, geo: ['US'], funding_types: ['venture'] },
      comparables: [], team: [], contacts: [], affiliations: [], exclude_funds: [],
      filters: { stages_allowed: ['seed'], ticket_min_usd: null, ticket_max_usd: null, geos: ['US'], require_known_stage: false },
      weights: { seed: .3, coinvest: .2, thesis: .25, path: .2, activity: .05 }, top_n: 20, hop_penalty: .25, max_hops: 4,
      onboardingComplete: false,
    };
    const saved = await fetch(url + '/account/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(profile) });
    assert.equal(saved.status, 200);
    const connected = await fetch(url + '/account/linkedin', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ url: 'https://www.linkedin.com/in/new-founder' }),
    });
    assert.equal(connected.status, 200);
    const connectedBody = await connected.json();
    assert.equal(connectedBody.linkedin.organization, 'New Company');
    assert.equal(connectedBody.interactions.count, 1);
    const imported = await fetch(url + '/account/sources/hubspot', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ fileName: 'contacts.csv', content: 'First Name,Last Name,Company,Job Title\nJane,Doe,Target Co,Partner\n' }),
    });
    assert.equal(imported.status, 200);
    assert.equal((await imported.json()).count, 1);
    const me = await (await fetch(url + '/auth/me', { headers: { Cookie: cookie } })).json();
    assert.equal(me.user.browser, true);
    assert.equal(me.profile.project.name, 'New Product');
    assert.equal(me.profile.founder.linkedin_url, 'https://www.linkedin.com/in/new-founder');
    assert.equal(me.profile.linkedin_interactions.count, 1);
    assert.equal(me.sources[0].source, 'hubspot');
    const loggedOut = await fetch(url + '/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: '{}' });
    assert.equal(loggedOut.status, 200);
    assert.equal((await fetch(url + '/auth/me', { headers: { Cookie: cookie } })).status, 401);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    store.close();
  }
});
test('LinkedIn profile not found publicly falls back to a manual entry the client can use', async () => {
  const store = createStore(':memory:');
  const { server } = createApp({
    store,
    env: { FIRECRAWL_API_KEY: 'fc-test', SGAI_API_KEY: 'sgai-test' },
    profileLookup: async () => { throw new Error("We couldn't find that profile publicly. Enter your name and role manually."); },
    interactionLookup: async (linkedinUrl, { name }) => ({ actor: 'web', posts: 0, items: 0, connections: name ? [{
      name: 'Jane Doe', org: 'Target Co', role: 'Partner', url: 'https://www.linkedin.com/in/jane-doe/', connectedOn: '', source: 'web_relation', strength: .4,
    }] : [] }),
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/research`;
  try {
    const register = await fetch(url + '/auth/browser', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'k'.repeat(40) }),
    });
    const cookie = register.headers.get('set-cookie').split(';')[0];
    const profile = {
      founder: { name: 'unindexed', title: 'CEO', email: 'unindexed@example.test', linkedin_url: '', org: 'Unindexed Co' },
      project: { name: 'Product', one_liner: 'Data product', description: 'A test project', sectors: ['AI'], keywords: [], stage: 'seed', raise_usd: 100000, geo: ['US'], funding_types: ['venture'] },
      comparables: [], team: [], contacts: [], affiliations: [], exclude_funds: [],
      filters: { stages_allowed: ['seed'], ticket_min_usd: null, ticket_max_usd: null, geos: ['US'], require_known_stage: false },
      weights: { seed: .3, coinvest: .2, thesis: .25, path: .2, activity: .05 }, top_n: 20, hop_penalty: .25, max_hops: 4,
      onboardingComplete: false,
    };
    await fetch(url + '/account/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(profile) });
    const notFound = await fetch(url + '/account/linkedin', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ url: 'https://www.linkedin.com/in/unindexed-founder' }),
    });
    assert.equal(notFound.status, 502);
    const notFoundBody = await notFound.json();
    assert.equal(notFoundBody.code, 'linkedin_not_found');
    const manual = await fetch(url + '/account/linkedin', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ url: 'https://www.linkedin.com/in/unindexed-founder', manual: { name: 'Unindexed Founder', role: 'CEO', organization: 'Unindexed Co' } }),
    });
    assert.equal(manual.status, 200);
    const manualBody = await manual.json();
    assert.equal(manualBody.linkedin.name, 'Unindexed Founder');
    assert.equal(manualBody.linkedin.source, 'Entered manually');
    assert.equal(manualBody.interactions.count, 1);
    const me = await (await fetch(url + '/auth/me', { headers: { Cookie: cookie } })).json();
    assert.equal(me.profile.linkedin_profile.name, 'Unindexed Founder');
    const missingName = await fetch(url + '/account/linkedin', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ url: '', manual: { name: '  ' } }),
    });
    assert.equal(missingName.status, 400);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    store.close();
  }
});
test('networks, feedback and history stay isolated between accounts', () => {
  const store = createStore(':memory:');
  const sameBrief = { ...brief, name: 'Same Founder', company: 'Same Company' };
  store.saveNetwork(sameBrief.name, sameBrief.company, [{ name: 'User A contact' }], 'user-a');
  store.saveNetwork(sameBrief.name, sameBrief.company, [{ name: 'User B contact' }], 'user-b');
  assert.equal(store.network(sameBrief, 'user-a')[0].name, 'User A contact');
  assert.equal(store.network(sameBrief, 'user-b')[0].name, 'User B contact');
  assert.equal(store.network(sameBrief).length, 0);
  store.feedback(sameBrief, 'lead', { decision: 'approve' }, 'user-a');
  store.feedback(sameBrief, 'lead', { decision: 'reject' }, 'user-b');
  assert.equal(store.feedbackFor(sameBrief, 'user-a').get('lead').decision, 'approve');
  assert.equal(store.feedbackFor(sameBrief, 'user-b').get('lead').decision, 'reject');
  store.save({ id: 'a', brief: sameBrief, status: 'done', mode: 'live', createdAt: '2026-01-01', userId: 'user-a' });
  store.save({ id: 'b', brief: sameBrief, status: 'done', mode: 'live', createdAt: '2026-01-01', userId: 'user-b' });
  store.save({ id: 'public', brief: sameBrief, status: 'done', mode: 'live', createdAt: '2026-01-01', userId: null });
  assert.deepEqual(store.list('user-a').map((job) => job.id), ['a']);
  assert.deepEqual(store.list().map((job) => job.id), ['public']);
  store.close();
});
test('official sender facts are literal source excerpts, not invented quotations', async () => {
  const source =
    'CEO & Director Ram Mukunda Advisor Prof. Jeffrey L. Cummings IGC-AD1 that is in Phase 2 for Alzheimer’s disease';
  const result = await teamFacts(
    { page: async () => source },
    {
      ...valid(),
      company: 'IGC Pharma',
      name: 'Ram Mukunda',
      product: 'IGC-AD1',
    },
  );
  assert.equal(result.sender.length, 2);
  assert.ok(
    [...result.sender, result.team].every((e) => source.includes(e.quote)),
  );
  const missing = await teamFacts(
    { page: async () => 'Ram Mukunda visitor' },
    { ...valid(), company: 'IGC Pharma', name: 'Ram Mukunda' },
  );
  assert.equal(missing.sender.length, 0);
  assert.equal(missing.team, null);
});
test('separate grants sharing the same contact do not collapse into one opportunity', () => {
  const a = {
    ...lead(),
    kind: 'opportunity',
    person: 'Same Contact',
    externalId: 'GRANT1',
  };
  const b = { ...a, externalId: 'GRANT2' };
  assert.equal(dedupe([a, b]).length, 2);
});
test('program officer is preferred over academic PI when supplied by NIH', () => {
  const [l] = reporterLeads({
    results: [
      {
        appl_id: 3,
        project_title: 'Data research',
        organization: { org_name: 'University' },
        agency_ic_admin: { name: 'National Institute on Aging' },
        program_officers: [{ full_name: 'Officer Example' }],
        principal_investigators: [{ full_name: 'PI Example' }],
      },
    ],
  });
  assert.equal(l.person, 'Officer Example');
  assert.match(l.role, /Program officer/);
  assert.match(l.org, /National Institute/);
});
test('stable OpenAlex author IDs deduplicate across historical company aliases',()=>{
 const first={...lead(),person:'Jane Doe',personId:'https://openalex.org/A123',org:'Otsuka'};
 const second={...first,org:'Otsuka Pharmaceutical Development & Commercialization'};
 const rows=dedupe([first,second]);assert.equal(rows.length,1);assert.match(rows[0].risks.join(' '),/Other past affiliation/);
});
test('rank numbers start at one within each visible bucket', () => {
  const result = evaluate([
    {...lead(), externalId:'closed', kind:'radar', status:'closed'},
    {...lead(), externalId:'open', kind:'opportunity', status:'open'},
  ], valid());
  assert.equal(result.find(l=>l.bucket==='top').rank,1);
  assert.equal(result.find(l=>l.bucket==='radar').rank,1);
});
test('a product fact cannot substitute for a missing sender identity', () => {
  const result = buildDraft(lead(), valid(), [evidence('Official','https://example.org/product','Public product statement','product')]);
  assert.match(result.body,/Your name and role; confirm before sending/);
});

test('LinkedIn not indexed publicly: continues with the setup name instead of blocking', async () => {
  const store = createStore(':memory:');
  let lookupArgs = null;
  const { server } = createApp({
    store,
    env: { FIRECRAWL_API_KEY: 'fc-test', SGAI_API_KEY: 'sgai-test' },
    profileLookup: async (_url, opts) => { lookupArgs = opts; throw new Error("We couldn't find that profile publicly. Enter your name and role manually."); },
    interactionLookup: async (_url, { name }) => ({ actor: 'web', posts: 1, items: 1, connections: name === 'Gisel Caicedo' ? [{ name: 'Ana Pérez', org: 'Beta', role: 'Partner', url: '', connectedOn: '', source: 'web_public_relation', strength: .5 }] : [] }),
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/research`;
  try {
    const register = await fetch(url + '/auth/browser', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'k'.repeat(40) }) });
    const cookie = register.headers.get('set-cookie').split(';')[0];
    const profile = {
      founder: { name: 'Gisel Caicedo', title: 'Founder', email: 'gisel@example.test', linkedin_url: '', org: 'Mentiva' },
      project: { name: 'Mentiva', one_liner: 'x', description: 'x', sectors: ['AI'], keywords: [], stage: 'seed', raise_usd: 100000, geo: ['US'], funding_types: ['venture'] },
      comparables: [], team: [], contacts: [], affiliations: [], exclude_funds: [],
      filters: { stages_allowed: ['seed'], ticket_min_usd: null, ticket_max_usd: null, geos: ['US'], require_known_stage: false },
      weights: { seed: .3, coinvest: .2, thesis: .25, path: .2, activity: .05 }, top_n: 20, hop_penalty: .25, max_hops: 4, onboardingComplete: false,
    };
    await fetch(url + '/account/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(profile) });
    const res = await fetch(url + '/account/linkedin', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ url: 'linkedin.com/in/gissoler' }) });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.linkedin.name, 'Gisel Caicedo');
    assert.match(body.linkedin.source, /setup/i);
    assert.equal(body.interactions.count, 1);
    assert.equal(lookupArgs.name, 'Gisel Caicedo');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    store.close();
  }
});

test('RESEARCH_PUBLIC_ORIGIN lets the deployed domain through and keeps others out', async () => {
  const store = createStore(':memory:');
  const { server } = createApp({ store, env: { RESEARCH_PUBLIC_ORIGIN: 'https://outreach.example.com' } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const call = (host, origin) => new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path: '/api/research/auth/me', headers: { Host: host, ...(origin ? { Origin: origin } : {}) } }, (res) => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject); req.end();
  });
  try {
    assert.equal(await call('outreach.example.com', 'https://outreach.example.com'), 401);
    assert.equal(await call('evil.example.com', 'https://evil.example.com'), 403);
    assert.equal(await call('outreach.example.com', 'https://evil.example.com'), 403);
    assert.equal(await call(`localhost:${port}`), 401);
    const reg = await new Promise((resolve, reject) => {
      const body = JSON.stringify({ key: 'k'.repeat(40) });
      const req = httpRequest({ host: '127.0.0.1', port, method: 'POST', path: '/api/research/auth/browser', headers: { Host: 'outreach.example.com', Origin: 'https://outreach.example.com', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, (res) => { res.resume(); resolve(res.headers['set-cookie']?.[0] || ''); });
      req.on('error', reject); req.end(body);
    });
    assert.match(reg, /; Secure/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    store.close();
  }
});
