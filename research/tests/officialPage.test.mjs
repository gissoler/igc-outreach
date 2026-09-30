import test from 'node:test';
import assert from 'node:assert/strict';
import { createOfficialPages, embedPolicy, officialUrlOf } from '../server/research/officialPage.mjs';
import { createRemoteBrowser, hostIsPublic, isPrivateAddress } from '../server/research/remoteBrowser.mjs';

test('embedPolicy reads X-Frame-Options and frame-ancestors', () => {
  assert.equal(embedPolicy({ 'x-frame-options': 'DENY' }).embeddable, false);
  assert.equal(embedPolicy({ 'x-frame-options': 'sameorigin' }).embeddable, false);
  assert.equal(embedPolicy({ 'content-security-policy': "default-src 'self'; frame-ancestors 'self'" }).embeddable, false);
  assert.equal(embedPolicy({ 'content-security-policy': 'frame-ancestors *' }).embeddable, true);
  assert.equal(embedPolicy({}).embeddable, true);
});

test('officialUrlOf only uses https URLs the pipeline stored', () => {
  assert.equal(officialUrlOf({ evidence: [{ url: 'http://x.org', verified: true }, { url: 'https://nia.nih.gov/a', verified: false }] }), 'https://nia.nih.gov/a');
  assert.equal(officialUrlOf({ evidence: [], contact: { type: 'email', value: 'a@b.org' } }), null);
  assert.equal(officialUrlOf({ evidence: [], contact: { type: 'website', value: 'https://fund.org' } }), 'https://fund.org/');
});

test('info caches the embed check per lead', async () => {
  let calls = 0;
  const fetcher = async (url) => { calls += 1; return { ok: true, status: 200, url, headers: new Headers({ 'x-frame-options': 'DENY' }), body: null }; };
  const pages = createOfficialPages({ fetcher });
  const lead = { id: 'l1', evidence: [{ url: 'https://nia.nih.gov/x', verified: true }] };
  assert.equal((await pages.info('j1', lead)).embeddable, false);
  await pages.info('j1', lead);
  assert.equal(calls, 1);
  assert.equal((await pages.info('j1', { id: 'l2', evidence: [] })).url, null);
});

test('isPrivateAddress blocks loopback, LAN, link-local and metadata ranges', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.9', '192.168.1.5', '169.254.169.254', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) assert.equal(isPrivateAddress(ip), true, ip);
  for (const ip of ['8.8.8.8', '151.101.1.69', '2606:4700::1111']) assert.equal(isPrivateAddress(ip), false, ip);
});

test('hostIsPublic resolves the name and rejects private answers', async () => {
  assert.equal(await hostIsPublic('nia.nih.gov', async () => [{ address: '8.8.8.8' }]), true);
  assert.equal(await hostIsPublic('evil.example', async () => [{ address: '8.8.8.8' }, { address: '10.0.0.4' }]), false);
  assert.equal(await hostIsPublic('localhost'), false);
  assert.equal(await hostIsPublic('nope.example', async () => { throw new Error('ENOTFOUND'); }), false);
});

/* A fake Playwright: records what the remote browser does. */
function fakePlaywright() {
  const log = [];
  const pages = [];
  const routes = [];
  const makePage = () => {
    let url = 'about:blank';
    const p = {
      setDefaultTimeout() {}, on() {},
      goto: async (u) => { url = u; log.push(['goto', u]); },
      url: () => url, title: async () => 'Fake page',
      waitForLoadState: async () => {}, waitForTimeout: async () => {},
      screenshot: async () => Buffer.from('jpeg'),
      mouse: { click: async (x, y) => log.push(['click', x, y]), wheel: async (x, y) => log.push(['wheel', y]) },
      keyboard: { type: async (t) => log.push(['type', t]), press: async (k) => log.push(['key', k]) },
      goBack: async () => log.push(['back']), reload: async () => log.push(['reload']),
    };
    pages.push(p);
    return p;
  };
  const contexts = [];
  const browser = { on() {}, close: async () => {}, newContext: async () => { const c = { closed: false, route: async (_g, h) => routes.push(h), on() {}, newPage: async () => makePage(), close: async () => { c.closed = true; } }; contexts.push(c); return c; } };
  return { log, routes, contexts, importPlaywright: async () => ({ chromium: { launch: async () => browser } }) };
}
const publicLookup = async () => [{ address: '8.8.8.8' }];

test('remote browser: open → click/scroll/type/key/back return a frame', async () => {
  const fp = fakePlaywright();
  const rb = createRemoteBrowser({ env: {}, importPlaywright: fp.importPlaywright, lookup: publicLookup, sweepMs: 1e9 });
  const first = await rb.open('u:j:l', 'https://nia.nih.gov/x');
  assert.equal(first.width, 1100);
  assert.equal(Buffer.from(first.image, 'base64').toString(), 'jpeg');
  await rb.act('u:j:l', { action: 'click', x: 10, y: 20 });
  await rb.act('u:j:l', { action: 'scroll', dy: 400 });
  await rb.act('u:j:l', { action: 'type', text: 'hi' });
  await rb.act('u:j:l', { action: 'key', key: 'Enter' });
  await rb.act('u:j:l', { action: 'back' });
  assert.deepEqual(fp.log.map((l) => l[0]), ['goto', 'click', 'wheel', 'type', 'key', 'back']);
  await assert.rejects(rb.act('u:j:l', { action: 'key', key: 'F12' }), { code: 'BAD_ACTION' });
  await assert.rejects(rb.act('u:j:l', { action: 'click', x: 'a', y: 1 }), { code: 'BAD_ACTION' });
  await assert.rejects(rb.act('nobody', { action: 'click', x: 1, y: 1 }), { code: 'NO_SESSION' });
  await rb.closeAll();
});

test('remote browser: refuses private hosts, keeps one session per owner, blocks private requests', async () => {
  const fp = fakePlaywright();
  const rb = createRemoteBrowser({ env: {}, importPlaywright: fp.importPlaywright, lookup: async (h) => [{ address: h === 'intranet.example' ? '10.0.0.7' : '8.8.8.8' }], sweepMs: 1e9 });
  await assert.rejects(rb.open('a:j:l', 'https://intranet.example/'), { code: 'BLOCKED_HOST' });
  await assert.rejects(rb.open('a:j:l', 'http://nia.nih.gov/'), { code: 'BAD_ACTION' });
  await rb.open('a:j:1', 'https://nia.nih.gov/', { owner: 'a' });
  await rb.open('a:j:2', 'https://grants.nih.gov/', { owner: 'a' });
  assert.equal(fp.contexts[0].closed, true);
  assert.equal(rb.status().sessions, 1);
  // A request the page makes to an internal address is aborted at the route.
  const decide = async (url, type = 'document') => { let out = 'continue'; await fp.routes[1]({ request: () => ({ url: () => url, resourceType: () => type }), abort: async () => { out = 'abort'; }, continue: async () => { out = 'continue'; } }); return out; };
  assert.equal(await decide('https://grants.nih.gov/a'), 'continue');
  assert.equal(await decide('http://127.0.0.1:8788/api/research/health'), 'abort');
  assert.equal(await decide('https://www.googletagmanager.com/gtm.js', 'script'), 'abort');
  await rb.closeAll();
});

test('remote browser: reports when Playwright or Chromium is missing', async () => {
  const rb = createRemoteBrowser({ env: {}, importPlaywright: async () => { throw new Error('nope'); }, lookup: publicLookup, sweepMs: 1e9 });
  await assert.rejects(rb.open('a:j:l', 'https://nia.nih.gov/'), { code: 'BROWSER_UNAVAILABLE' });
  const off = createRemoteBrowser({ env: { RESEARCH_BROWSER: 'off' }, lookup: publicLookup, sweepMs: 1e9 });
  await assert.rejects(off.open('a:j:l', 'https://nia.nih.gov/'), { code: 'BROWSER_UNAVAILABLE' });
  await rb.closeAll(); await off.closeAll();
});
