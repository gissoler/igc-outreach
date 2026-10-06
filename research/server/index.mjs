import { createServer } from 'node:http';
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createStore } from './research/store.mjs';
import { validateBrief, csvFor } from './research/core.mjs';
import { parseCalendar, parseConnections, parseContactCsv } from './research/network.mjs';
import { runResearch } from './research/pipeline.mjs';
import { webConfigured, webPublicRelations, webProfileLookup, WEB_SOURCE } from './research/webscrape.mjs';
import { buildNetworkGraph } from './research/networkGraph.mjs';
import { editField, missingRequired, modelInfo, newIntake, publicIntake, removeDocument, runTurn, toProfile } from './research/intake.mjs';
import { blankProfile } from './research/profileDefaults.mjs';
import { createFrameStore, createLiveHub } from './research/liveRun.mjs';
import { createBrowserService } from './research/browser.mjs';
import { createOfficialPages, officialUrlOf } from './research/officialPage.mjs';
import { createRemoteBrowser } from './research/remoteBrowser.mjs';
import { createAnalysisRoutes, createRunEnrichers, judgmentFromFeedback } from './analysis/routes.mjs';
import { createAdvisorRoutes } from './analysis/advisorRoutes.mjs';
export function createApp({
  store = createStore(
    resolve(process.env.RESEARCH_DB || 'data/research.sqlite'),
  ),
  pipeline = runResearch,
  profileLookup = webProfileLookup,
  interactionLookup = webPublicRelations,
  env = process.env,
  modelFetch = fetch,
  hub = createLiveHub(),
  frames = createFrameStore(),
  browser = env.RESEARCH_BROWSER === 'off' ? null : createBrowserService({ env }),
  keepAliveMs = 15000,
} = {}) {
  let active = null;
  const anonymousRuns = new Map();
  const streams = new Set();
  /** SSE del Live Agent Run: snapshot inicial (desde Last-Event-ID), eventos nuevos, keepalive y cierre. */
  const streamEvents = (req, res, job, requestUrl) => {
    const lastHeader = Number(req.headers['last-event-id'] ?? requestUrl.searchParams.get('after') ?? 0);
    let lastSent = Number.isFinite(lastHeader) && lastHeader > 0 ? lastHeader : 0;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const send = (event, data, id) => res.write(`${id ? `id: ${id}\n` : ''}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    let closed = false;
    let unsubscribe = () => {};
    let keepAlive = null;
    const close = () => {
      if (closed) return;
      closed = true;
      unsubscribe();
      clearInterval(keepAlive);
      streams.delete(close);
      res.end();
    };
    streams.add(close);
    // Suscripción y snapshot en el mismo turno del bucle: no se pierde ni se duplica ningún evento.
    unsubscribe = hub.subscribe(job.id, (message) => {
      if (closed) return;
      if (message.type === 'event' && message.event.sequence > lastSent) {
        lastSent = message.event.sequence;
        send('live', message.event, message.event.sequence);
      } else if (message.type === 'end') {
        send('end', { status: message.status, lastSequence: lastSent });
        close();
      }
    });
    const current = store.get(job.id) || job;
    const events = (current.run?.events || []).filter((event) => event.sequence > lastSent);
    if (events.length) lastSent = events.at(-1).sequence;
    res.write('retry: 3000\n\n');
    send('snapshot', { jobId: job.id, status: current.status, events, dropped: current.run?.dropped || 0, structured: Boolean(current.run) }, lastSent || undefined);
    if (!['queued', 'running'].includes(current.status)) {
      send('end', { status: current.status, lastSequence: lastSent });
      close();
      return;
    }
    keepAlive = setInterval(() => { if (!closed) res.write(': keepalive\n\n'); }, keepAliveMs);
    keepAlive.unref?.();
    req.on('close', close);
    res.on('error', close);
  };
  const tokenHash = (token) => createHash('sha256').update(token).digest('hex');
  const cookieToken = (req) => String(req.headers.cookie || '').split(';').map((v) => v.trim()).find((v) => v.startsWith('wp_session='))?.slice(11) || '';
  const authUser = (req) => {
    const token = cookieToken(req);
    if (!token) return null;
    const session = store.session(tokenHash(token));
    return session ? store.userById(session.user_id) : null;
  };
  const publicUser = (user) => user && ({ id: user.id, email: user.email, name: user.name, browser: String(user.email).endsWith('@workspace.local') });
  // Producción: RESEARCH_PUBLIC_ORIGIN=https://outreach.tudominio.com (varios separados por coma).
  // Sin esa variable el servidor solo acepta localhost, como siempre.
  const publicOrigins = String(env.RESEARCH_PUBLIC_ORIGIN || '').split(',').map((o) => o.trim().replace(/\/$/, '')).filter(Boolean);
  const publicHosts = publicOrigins.map((o) => { try { return new URL(o).host; } catch { return ''; } }).filter(Boolean);
  const secureCookie = publicOrigins.some((o) => o.startsWith('https://'));
  const sessionCookie = (token, maxAge = 60 * 60 * 24 * 30) =>
    `wp_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secureCookie ? '; Secure' : ''}`;
  const officialPages = createOfficialPages({});
  const remoteBrowser = createRemoteBrowser({ env });
  const analysisRoutes = createAnalysisRoutes({ store, env, authUser: (req) => authUser(req), fetcher: modelFetch });
  const runEnrichers = store.analysis ? createRunEnrichers({ store, env, fetcher: modelFetch }) : [];
  const advisorRoutes = createAdvisorRoutes({ store, env, authUser: (req) => authUser(req), fetcher: modelFetch });
  const issueSession = (res, userId) => {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + 30 * 86400000).toISOString();
    store.saveSession(tokenHash(token), userId, expiresAt);
    res.setHeader('Set-Cookie', sessionCookie(token));
  };
  const server = createServer(async (req, res) => {
    const host = req.headers.host || '';
    const origin = req.headers.origin;
    const allowed =
      !origin ||
      /^http:\/\/(localhost|127\.0\.0\.1):(3000|5173|5174|8787|8788)$/.test(
        origin,
      ) ||
      publicOrigins.includes(origin);
    if (!(/^(localhost|127\.0\.0\.1):\d+$/.test(host) || publicHosts.includes(host)) || !allowed) {
      res.writeHead(403);
      res.end('Local use only');
      return;
    }
    if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    const json = (status, body) => {
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
      });
      res.end(JSON.stringify(body));
    };
    try {
      const requestUrl = new URL(req.url, 'http://127.0.0.1');
      const path = requestUrl.pathname;
      let body = {};
      if (['POST', 'PUT', 'DELETE'].includes(req.method)) {
        if (!req.headers['content-type']?.startsWith('application/json'))
          return json(415, { error: 'Send JSON.' });
        const chunks = [];
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > (path.startsWith('/api/research/intake') ? 2_500_000 : 1_100_000)) return json(413, { error: 'Content too large.' });
          chunks.push(chunk);
        }
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          return json(400, { error: 'Invalid JSON.' });
        }
      }
      if (req.method === 'GET' && path === '/api/research/health')
        return json(200, {
          status: 'ok',
          providers: {
            openalex: env.OPENALEX_API_KEY
              ? 'with key'
              : 'public; rate limited',
            clinicalTrials: 'public',
            grants: 'public',
            reporter: 'public',
            web: env.SERPER_API_KEY ? 'configured' : 'missing SERPER_API_KEY',
            exa: env.EXA_API_KEY ? 'configured' : 'missing EXA_API_KEY',
            rounds: env.EXA_API_KEY ? 'Exa · news' : env.SERPER_API_KEY ? 'Serper News' : 'missing EXA_API_KEY and SERPER_API_KEY',
            people: webConfigured(env) ? `configured · ${WEB_SOURCE}` : 'missing FIRECRAWL_API_KEY and SGAI_API_KEY',
            linkedin: webConfigured(env) ? `profile via public search and web relationships · ${WEB_SOURCE}` : 'missing FIRECRAWL_API_KEY and SGAI_API_KEY',
            jev: env.JEV_API_KEY || env.TYPESAFE_API_KEY
              ? `configured · ${env.JEV_MODEL || 'jev-latest'}`
              : 'integrated · missing JEV_API_KEY',
            intakeModel: modelInfo(env).model || 'no model · basic extraction',
          },
        });
      /* The only way in: there is no sign-in. The browser keeps a random key in localStorage; the key is the
         credential of an anonymous account. Same key → same workspace; clearing browser data starts a new one. */
      if (req.method === 'POST' && path === '/api/research/auth/browser') {
        const key = typeof body.key === 'string' ? body.key : '';
        if (!/^[A-Za-z0-9_-]{32,128}$/.test(key)) return json(400, { error: 'Invalid browser key.' });
        const email = `browser-${tokenHash(`browser:${key}`).slice(0, 32)}@workspace.local`;
        let user = store.userByEmail(email);
        if (user) {
          const supplied = scryptSync(key, user.password_salt, 64);
          if (!timingSafeEqual(supplied, Buffer.from(user.password_hash, 'hex'))) return json(401, { error: 'Invalid browser key.' });
        } else {
          const salt = randomBytes(16).toString('hex');
          const created = { id: randomUUID(), email, name: '', passwordSalt: salt, passwordHash: scryptSync(key, salt, 64).toString('hex'), createdAt: new Date().toISOString() };
          try { store.createUser(created); } catch { return json(409, { error: 'Try again.' }); }
          user = store.userById(created.id);
        }
        issueSession(res, user.id);
        return json(200, { user: publicUser(user), profile: store.profile(user.id), sources: store.accountSources(user.id) });
      }
      if (req.method === 'POST' && path === '/api/research/auth/logout') {
        const token = cookieToken(req);
        if (token) store.deleteSession(tokenHash(token));
        res.setHeader('Set-Cookie', sessionCookie('', 0));
        return json(200, { loggedOut: true });
      }
      if (req.method === 'GET' && path === '/api/research/auth/me') {
        const user = authUser(req);
        if (!user) return json(401, { error: 'You\'re not signed in.' });
        return json(200, { user: publicUser(user), profile: store.profile(user.id), sources: store.accountSources(user.id) });
      }
      if (path === '/api/research/account/profile' && ['GET', 'PUT'].includes(req.method)) {
        const user = authUser(req);
        if (!user) return json(401, { error: 'Sign in to continue.' });
        if (req.method === 'GET') return json(200, store.profile(user.id));
        const founder = body?.founder, project = body?.project;
        // Browser workspaces have no name: default it so the profile and the search brief stay valid.
        if (founder && typeof founder === 'object' && String(user.email).endsWith('@workspace.local')) { if (typeof founder.name !== 'string' || !founder.name.trim()) founder.name = 'Founder'; if (String(founder.email || '').endsWith('@workspace.local')) founder.email = ''; }
        if (!founder || !project || typeof founder.name !== 'string' || !founder.name.trim() || typeof founder.org !== 'string' || !founder.org.trim())
          return json(400, { error: 'Fill in user and company.' });
        if (body.onboardingComplete === true && (typeof project.name !== 'string' || !project.name.trim()))
          return json(400, { error: 'Fill in the product first.' });
        const profile = { ...body, onboardingComplete: body.onboardingComplete === true };
        store.saveProfile(user.id, profile);
        return json(200, profile);
      }
      if (req.method === 'GET' && path === '/api/research/account/connectors') {
        const user = authUser(req);
        if (!user) return json(401, { error: 'Sign in to continue.' });
        return json(200, {
          linkedin: { import: false, oauth: false, configured: webConfigured(env), status: webConfigured(env) ? 'public_profile_and_interactions_ready' : 'token_pending' }, calendar: { import: true, oauth: false },
          gmail: { import: true, oauth: false }, outlook: { import: true, oauth: false },
          hubspot: { import: true, oauth: false }, apollo: { import: true, oauth: false },
          people: { import: false, oauth: false, server: true, configured: webConfigured(env), status: webConfigured(env) ? 'ready' : 'token_pending' },
        });
      }
      if (req.method === 'POST' && path === '/api/research/account/linkedin') {
        const user = authUser(req);
        if (!user) return json(401, { error: 'Sign in to continue.' });
        const profile = store.profile(user.id);
        if (!profile) return json(409, { error: 'Save your profile and company first.' });
        if (!webConfigured(env)) return json(503, { error: 'Web search (Firecrawl + ScrapeGraph) isn\'t configured yet.' });
        const linkedinUrl = typeof body.url === 'string' ? body.url.trim() : '';
        const manual = body.manual && typeof body.manual === 'object' ? body.manual : null;
        let publicProfile;
        if (manual) {
          const name = typeof manual.name === 'string' ? manual.name.trim() : '';
          if (!name) return json(400, { error: 'Enter at least your name.' });
          publicProfile = {
            linkedinUrl,
            name,
            headline: typeof manual.role === 'string' ? manual.role.trim() : '',
            role: typeof manual.role === 'string' ? manual.role.trim() : '',
            organization: typeof manual.organization === 'string' ? manual.organization.trim() : '',
            location: '',
            verifiedAt: new Date().toISOString(),
            source: 'Entered manually',
          };
        } else {
          try {
            publicProfile = await profileLookup(linkedinUrl, { env, name: profile.founder?.name, org: profile.founder?.org });
          } catch (error) {
            // Si el link no está indexado pero el setup ya tiene un nombre real, seguimos con ese nombre en vez de frenar.
            const setupName = String(profile.founder?.name || '').trim();
            if (/^\S+\s+\S+/.test(setupName) && !/valid profile link/i.test(error.message || '')) {
              publicProfile = {
                linkedinUrl: linkedinUrl ? linkedinUrl.replace(/^(?!https?:\/\/)/i, 'https://') : '',
                name: setupName,
                headline: String(profile.founder?.title || ''),
                role: String(profile.founder?.title || ''),
                organization: String(profile.founder?.org || ''),
                location: '',
                verifiedAt: new Date().toISOString(),
                source: 'From your setup (profile not indexed publicly)',
              };
            } else {
              // The client shows an inline manual-entry fallback for this code; keep it stable.
              return json(502, { error: error.message || 'Couldn\'t read that LinkedIn profile.', code: 'linkedin_not_found' });
            }
          }
        }
        let interactions = { count: 0, posts: 0, actor: WEB_SOURCE, actors: [], status: 'empty' };
        try {
          const result = await interactionLookup(publicProfile.linkedinUrl, { env, name: publicProfile.name || profile.founder.name, org: publicProfile.organization || profile.founder.org });
          store.saveAccountSource(user.id, 'web_relations', result.connections);
          store.saveNetwork(profile.founder.name, profile.founder.org, store.sourceRows(user.id), user.id);
          interactions = { count: result.connections.length, posts: result.posts, actor: result.actor, actors: result.actors || [result.actor], status: result.connections.length ? (result.errors?.length ? 'partial' : 'ready') : (result.errors?.length ? 'partial' : 'empty'), errors: result.errors || [] };
        } catch (error) {
          interactions = { ...interactions, status: 'unavailable', error: error.message || 'Couldn\'t read public interactions.' };
        }
        const updated = {
          ...profile,
          founder: { ...profile.founder, linkedin_url: publicProfile.linkedinUrl || profile.founder.linkedin_url },
          linkedin_profile: publicProfile,
          linkedin_interactions: { ...interactions, updatedAt: new Date().toISOString() },
        };
        store.saveProfile(user.id, updated);
        return json(200, { profile: updated, linkedin: publicProfile, interactions });
      }
      if (path === '/api/research/account/network-graph' && ['GET', 'POST', 'DELETE'].includes(req.method)) {
        const user = authUser(req);
        if (!user) return json(401, { error: 'Sign in to continue.' });
        const profile = store.profile(user.id);
        if (!profile) return json(409, { error: 'Save your profile and company first.' });
        if (req.method === 'GET') return json(200, buildNetworkGraph(profile, store.sourceRows(user.id)));
        if (req.method === 'DELETE') {
          store.deleteAccountSource(user.id, 'linkedin_authenticated_graph');
          store.saveNetwork(profile.founder.name, profile.founder.org, store.sourceRows(user.id), user.id);
          return json(200, buildNetworkGraph(profile, store.sourceRows(user.id)));
        }
        return json(410, { error: 'The LinkedIn cookie network was retired. Use Analyze my LinkedIn.' });
      }
      if (path.startsWith('/api/research/account/sources')) {
        const user = authUser(req);
        if (!user) return json(401, { error: 'Sign in to continue.' });
        if (req.method === 'GET' && path === '/api/research/account/sources')
          return json(200, store.accountSources(user.id));
        const source = path.split('/').at(-1);
        if (!['linkedin', 'gmail', 'outlook', 'calendar', 'hubspot', 'apollo'].includes(source))
          return json(400, { error: 'Unsupported source.' });
        const profile = store.profile(user.id);
        if (!profile) return json(409, { error: 'Save your profile and company first.' });
        if (req.method === 'DELETE') {
          store.deleteAccountSource(user.id, source);
        } else if (req.method === 'POST') {
          if (typeof body.content !== 'string') return json(400, { error: 'Choose a valid file.' });
          let rows;
          try {
            rows = source === 'linkedin' ? parseConnections(body.content) : source === 'calendar' ? parseCalendar(body.content) : parseContactCsv(body.content, source);
          } catch (error) { return json(400, { error: error.message }); }
          store.saveAccountSource(user.id, source, rows);
        } else return json(405, { error: 'Method not allowed.' });
        const rows = store.sourceRows(user.id);
        store.saveNetwork(profile.founder.name, profile.founder.org, rows, user.id);
        const current = store.accountSources(user.id).find((item) => item.source === source);
        return json(200, current || { source, count: 0, updatedAt: null });
      }
      if (path.startsWith('/api/research/intake')) {
        const user = authUser(req);
        if (!user) return json(401, { error: 'Sign in to continue.' });
        const load = () => store.intake(user.id) || newIntake({ user, profile: store.profile(user.id) });
        const reply = (session, extra = {}) => { store.saveIntake(user.id, session); return json(200, { ...publicIntake(session, env), ...extra }); };
        if (req.method === 'GET' && path === '/api/research/intake') return reply(load());
        if (req.method === 'POST' && path === '/api/research/intake/message') {
          const text = typeof body.text === 'string' ? body.text : '';
          const documents = Array.isArray(body.documents) ? body.documents.filter((d) => d && typeof d.text === 'string' && typeof d.name === 'string') : [];
          if (!text.trim() && !documents.length) return json(400, { error: 'Write a message or attach a document with text.' });
          const session = load();
          const turn = await runTurn(session, { text, documents, env, fetchImpl: modelFetch });
          return reply(session, { changed: turn.changed, modelError: turn.model.error });
        }
        if (req.method === 'PUT' && path === '/api/research/intake/field') {
          if (typeof body.path !== 'string') return json(400, { error: 'Invalid field.' });
          const session = load();
          try { editField(session, body.path, body.value ?? null); } catch (error) { return json(400, { error: error.message }); }
          return reply(session);
        }
        const doc = path.match(/^\/api\/research\/intake\/documents\/([a-f0-9-]+)$/);
        if (req.method === 'DELETE' && doc) {
          const session = load();
          if (!removeDocument(session, doc[1])) return json(404, { error: 'Document not found.' });
          return reply(session);
        }
        if (req.method === 'POST' && path === '/api/research/intake/reset') {
          store.deleteIntake(user.id);
          return reply(newIntake({ user }));
        }
        if (req.method === 'POST' && path === '/api/research/intake/confirm') {
          const session = load();
          const missing = missingRequired(session);
          if (missing.some((p) => ['company.name', 'product.name', 'product.one_liner', 'funding.objectives'].includes(p)))
            return json(400, { error: 'Missing company, product, one-liner or goal.', missing });
          const profile = { ...toProfile(session, store.profile(user.id) || blankProfile(user), user, env), onboardingComplete: false };
          store.saveProfile(user.id, profile);
          session.confirmedAt = new Date().toISOString();
          store.saveIntake(user.id, session);
          return json(200, { profile, intake: publicIntake(session, env) });
        }
        return json(404, { error: 'Route not found.' });
      }
      if (req.method === 'GET' && path === '/api/research/jobs')
        return json(200, store.list(authUser(req)?.id || null));
      if (req.method === 'GET' && path === '/api/research/network/status') {
        const name = requestUrl.searchParams.get('name') || '';
        const company = requestUrl.searchParams.get('company') || '';
        if (!name.trim() || !company.trim() || name.length > 200 || company.length > 200)
          return json(400, { error: 'Fill in name and company.' });
        return json(200, store.networkInfo(name, company, authUser(req)?.id || null));
      }
      if (req.method === 'POST' && path === '/api/research/jobs') {
        let brief;
        try {
          brief = validateBrief(body);
        } catch (e) {
          return json(400, { error: e.message });
        }
        if (active)
          return json(409, {
            error: 'A run is in progress. Wait for it to finish.',
          });
        const maxRuns = Math.max(0, Number(env.RESEARCH_MAX_RUNS_PER_DAY) || 0);
        const requestUser = authUser(req);
        if (maxRuns > 0 && (!requestUser || String(requestUser.email).endsWith('@workspace.local'))) {
          const day = new Date().toISOString().slice(0, 10);
          const ip = String(req.socket.remoteAddress || 'unknown');
          const keys = [`ip:${ip}:${day}`, ...(requestUser ? [`workspace:${requestUser.id}:${day}`] : [])];
          const persisted = requestUser ? store.list(requestUser.id).filter((item) => String(item.createdAt || '').startsWith(day)).length : 0;
          const used = Math.max(persisted, ...keys.map((key) => anonymousRuns.get(key) || 0));
          if (used >= maxRuns) return json(429, { error: `Daily research limit reached (${maxRuns}). Sign in or try again tomorrow.`, code: 'DAILY_RUN_LIMIT' });
          for (const key of keys) anonymousRuns.set(key, used + 1);
        }
        const job = {
          id: randomUUID(),
          brief,
          mode: brief.dataMode,
          status: 'queued',
          createdAt: new Date().toISOString(),
          events: [],
          leads: [],
          senderEvidence: [],
          userId: requestUser?.id || null,
        };
        store.save(job);
        const controller = new AbortController();
        active = { jobId: job.id, controller };
        void pipeline(job, store, { env, hub, browser, frames, signal: controller.signal, enrichers: runEnrichers })
          .catch(() => {
            job.status = 'failed';
            store.save(job);
          })
          .finally(() => {
            if (active?.jobId === job.id) active = null;
            frames.expireJob(job.id);
            // Cierra los streams aunque el pipeline haya fallado antes de emitir `completed`.
            hub.end(job.id, job.status);
            // The advisor starts by itself once the research has candidates, so the plan is ready when they open it.
            void advisorRoutes.autoStart(store.get(job.id) || job);
          });
        return json(202, { jobId: job.id });
      }
      // Página oficial de un lead dentro de la app: si se puede embeber (GET) o navegador remoto (POST).
      const pageMatch = path.match(/^\/api\/research\/jobs\/([a-f0-9-]+)\/leads\/([A-Za-z0-9_:.-]{1,200})\/(page|browse)$/);
      if (pageMatch && ((pageMatch[3] === 'page' && req.method === 'GET') || (pageMatch[3] === 'browse' && req.method === 'POST'))) {
        const job = store.get(pageMatch[1]);
        const requestUser = authUser(req);
        if (!job || (job.userId && job.userId !== requestUser?.id)) return json(404, { error: 'Run not found.' });
        const lead = (job.leads || []).find((l) => l.id === pageMatch[2]);
        if (!lead) return json(404, { error: 'Item not found.' });
        if (pageMatch[3] === 'page') return json(200, { ...(await officialPages.info(job.id, lead)), browser: remoteBrowser.status?.() || { available: false, reason: null } });
        const owner = requestUser?.id || 'anonymous';
        const key = `${owner}:${job.id}:${lead.id}`;
        try {
          if (body.action === 'open') {
            const url = officialUrlOf(lead);
            if (!url) return json(404, { error: 'No official page was found for this item.' });
            return json(200, await remoteBrowser.open(key, url, { owner, refresh: body.refresh === true }));
          }
          if (body.action === 'close') { await remoteBrowser.close(key); return json(200, { closed: true }); }
          return json(200, await remoteBrowser.act(key, body));
        } catch (e) {
          const status = { BROWSER_UNAVAILABLE: 503, NO_SESSION: 410, BLOCKED_HOST: 403, BAD_ACTION: 400, LOAD_FAILED: 502 }[e?.code] || 500;
          return json(status, { error: e?.code ? e.message : 'The browser could not do that.', code: e?.code });
        }
      }
      const match = path.match(
        /^\/api\/research\/jobs\/([a-f0-9-]+)(?:\/(export.csv|feedback|events|cancel|frames\/([a-f0-9]{8,64})))?$/,
      );
      if (match) {
        const job = store.get(match[1]);
        if (!job)
          return json(404, {
            error: 'Run not found.',
            code: 'JOB_NOT_FOUND',
            detail:
              'The ID may be stale after a server restart.',
          });
        const requestUser = authUser(req);
        if (job.userId && job.userId !== requestUser?.id)
          return json(404, {
            error: 'Run not found.',
            code: 'JOB_NOT_FOUND',
            detail:
              'This run isn\'t available for the signed-in account.',
          });
        if (req.method === 'GET' && !match[2]) return json(200, job);
        if (req.method === 'GET' && match[2] === 'events') return streamEvents(req, res, job, requestUrl);
        if (req.method === 'POST' && match[2] === 'cancel') {
          if (!['queued', 'running'].includes(job.status))
            return json(200, { cancelled: false, status: job.status });
          if (!active || active.jobId !== job.id)
            return json(409, { error: 'This run is no longer active.' });
          active.controller.abort(new Error('Stopped by the user.'));
          return json(202, { cancelled: true, status: 'stopping' });
        }
        if (req.method === 'GET' && match[3]) {
          const frame = frames.get(match[3]);
          if (!frame || frame.jobId !== job.id)
            return json(410, { error: 'Capture unavailable.', code: 'FRAME_EXPIRED', detail: 'Captures are temporary and expire with the run.' });
          res.writeHead(200, { 'Content-Type': frame.contentType, 'Content-Length': frame.buffer.length, 'Cache-Control': 'private, max-age=3600, immutable' });
          res.end(frame.buffer);
          return;
        }
        if (req.method === 'GET' && match[2] === 'export.csv') {
          res.writeHead(200, {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="research-${job.id}.csv"`,
          });
          res.end(csvFor(job));
          return;
        }
        if (req.method === 'POST' && match[2] === 'feedback') {
          const lead = job.leads.find((l) => l.id === body.leadId);
          if (!lead) return json(404, { error: 'Lead not found.' });
          if (
            ![
              'approve',
              'reject',
              'connector_accepted',
              'connector_declined',
            ].includes(body.decision)
          )
            return json(400, { error: 'Invalid feedback.' });
          const reasons = [
            'relevant',
            'not_relevant',
            'wrong_person',
            'competitor_conflict',
            'not_now',
            'ineligible',
            'bad_contact',
            'other',
          ];
          if (
            !reasons.includes(body.reason) ||
            typeof body.note !== 'string' ||
            body.note.length > 2000
          )
            return json(400, { error: 'Invalid reason or note.' });
          lead.feedback = {
            decision: body.decision,
            reason: body.reason,
            note: body.note,
            at: new Date().toISOString(),
          };
          store.feedback(job.brief, lead.key, lead.feedback, job.userId);
          store.analysis.saveJudgment(judgmentFromFeedback(job, lead, lead.feedback));
          store.save(job);
          return json(200, lead.feedback);
        }
      }
      if (
        path === '/api/research/network' &&
        ['POST', 'DELETE'].includes(req.method)
      ) {
        if (
          typeof body.name !== 'string' ||
          !body.name.trim() ||
          typeof body.company !== 'string' ||
          !body.company.trim() ||
          body.name.length > 200 ||
          body.company.length > 200
        )
          return json(400, { error: 'Choose a user and company.' });
        if (req.method === 'DELETE') {
          store.deleteNetwork(body.name, body.company, authUser(req)?.id || null);
          return json(200, { deleted: true });
        }
        try {
          const rows = parseConnections(body.csv);
          store.saveNetwork(body.name, body.company, rows, authUser(req)?.id || null);
          return json(200, { count: rows.length });
        } catch (e) {
          return json(400, { error: e.message });
        }
      }
      if (path.startsWith('/api/research/analysis/') || path.startsWith('/api/research/outreach') || path.startsWith('/api/research/grants') || path.startsWith('/api/research/voice') || path.startsWith('/api/research/advisor')) {
        const handled = path.startsWith('/api/research/advisor') ? await advisorRoutes(req, path, body, json, res, requestUrl) : await analysisRoutes(req, path, body, json, res, requestUrl);
        if (handled !== false || res.headersSent) return;
      }
      json(404, { error: 'Route not found.' });
    } catch {
      if (!res.headersSent)
        json(500, {
          error:
            'Internal error. Check the configuration and try again.',
        });
      else res.end();
    }
  });
  server.requestTimeout = 20000;
  /** Libera streams SSE, timers, capturas y el navegador compartido. */
  const close = async () => {
    active?.controller.abort(new Error('Server stopped.'));
    for (const end of Array.from(streams)) end();
    hub.close();
    frames.close();
    void remoteBrowser.closeAll();
    await browser?.close();
    await new Promise((resolve) => server.close(() => resolve()));
    server.closeAllConnections?.();
  };
  return { server, store, hub, frames, browser, close };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const app = createApp();
  app.server.listen(Number(process.env.RESEARCH_PORT) || 8788, '127.0.0.1', () =>
    console.log('Research API: http://127.0.0.1:8788'),
  );
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await Promise.race([app.close(), new Promise((resolve) => setTimeout(resolve, 5000))]);
    app.store.close();
    process.exit(0);
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}
