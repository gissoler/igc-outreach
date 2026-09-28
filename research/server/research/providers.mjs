import { candidate, evidence, isIGC, norm, safeUrl, ventureOf } from './core.mjs';
import { countRecords, noopRecorder, previewRecords, publicParams, queryOf, safeSample, sanitizeUrl } from './liveRun.mjs';
const TEAM = 'https://igcpharma.com/team/';
const AUTHOR = 'https://openalex.org/A5060487287';
export const plain = (s) =>
  String(s || '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(?:nbsp|#160);/gi, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&(?:rsquo|lsquo|#39);/g, "'")
    .replace(/&(?:ldquo|rdquo|quot);/g, '"')
    .replace(/&#(\d+);/g, (_, n) =>
      String.fromCodePoint(Math.min(Number(n), 1114111)),
    )
    .replace(/\s+/g, ' ')
    .trim();
/**
 * Cliente HTTP de las fuentes. Cada petición real emite eventos estructurados del
 * Live Agent Run (`live`); las páginas web se abren con el navegador compartido
 * (`browser`) cuando está disponible y se capturan con `saveFrame`.
 */
export function makeClient({
  fetcher = fetch,
  env = process.env,
  record = () => {},
  signal,
  live = noopRecorder,
  browser = null,
  frames = null,
} = {}) {
  const last = new Map();
  const robots = new Map();
  let calls = 0;
  const timeout = Math.min(
    30000,
    Math.max(1000, Number(env.RESEARCH_TIMEOUT_MS) || 12000),
  );
  async function throttle(url) {
    const host = new URL(url).host;
    const wait = Math.max(0, (last.get(host) || 0) + 1100 - Date.now());
    if (wait) await new Promise((r) => setTimeout(r, wait));
    last.set(host, Date.now());
  }
  async function request(url, body, headers = {}, redirects = 0, meta = {}) {
    await throttle(url);
    const timer = AbortSignal.timeout(timeout);
    const r = await fetcher(url, {
      method: body ? 'POST' : 'GET',
      headers: {
        'User-Agent': env.RESEARCH_USER_AGENT || 'FundingResearchMVP/1.0',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: signal ? AbortSignal.any([signal, timer]) : timer,
      redirect: 'manual',
    });
    meta.status = r.status;
    if (
      r.status >= 300 &&
      r.status < 400 &&
      r.headers.get('location') &&
      !body &&
      redirects < 3
    ) {
      const next = new URL(r.headers.get('location'), url);
      const current = new URL(url);
      if (
        next.protocol !== 'https:' ||
        next.hostname.replace(/^www\./, '') !==
          current.hostname.replace(/^www\./, '')
      )
        throw new Error(
          'Redirect outside the official site; read skipped.',
        );
      return request(next.href, body, headers, redirects + 1, meta);
    }
    if (new URL(url).pathname === '/robots.txt' && r.status === 404) return '';
    if (!r.ok)
      throw Object.assign(new Error(
        `HTTP ${r.status}${r.status === 429 ? ': rate limited; retry later or configure a key' : ''}`,
      ), { status: r.status });
    const reader = r.body.getReader();
    let size = 0;
    const chunks = [];
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 5_000_000) throw new Error('Response exceeds 5 MB.');
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    meta.bytes = size;
    return Buffer.concat(chunks).toString('utf8');
  }
  async function allowedByRobots(u, ev, detail) {
    if (!robots.has(u.origin)) {
      let rules;
      try {
        rules = await request(u.origin + '/robots.txt');
      } catch {
        throw new Error('Couldn\'t check robots.txt; read skipped.');
      }
      let applies = false;
      const denied = [];
      for (const line of rules.split('\n')) {
        const [key, ...rest] = line.split(':');
        const value = rest.join(':').split('#')[0].trim();
        if (key.trim().toLowerCase() === 'user-agent')
          applies = value === '*' || /fundingresearch/i.test(value);
        if (applies && key.trim().toLowerCase() === 'disallow' && value)
          denied.push(value);
      }
      robots.set(u.origin, denied);
      ev({ phase: 'reading', status: 'running', title: 'robots.txt checked', message: `${u.hostname}: robots.txt read (${denied.length} applicable exclusion rules).`, publicUrl: `${u.origin}/robots.txt`, detail });
    }
    return !robots
      .get(u.origin)
      .some((path) => u.pathname.startsWith(path.split('*')[0]));
  }
  function scoped(ev) {
    return {
      scope: (provider) => scoped(live.scope(provider)),
      async json(url, body, headers) {
        const u = new URL(url);
        const method = body ? 'POST' : 'GET';
        const callId = `call-${++calls}`;
        const base = {
          kind: 'api',
          callId,
          method,
          host: u.hostname,
          endpoint: sanitizeUrl(u.origin + u.pathname, live.secrets),
          params: publicParams(url, body, live.secrets),
        };
        base.query = queryOf(base.params);
        ev({ phase: 'api_request', status: 'running', title: `${method} ${u.hostname}`, message: `Request ${method} a ${u.hostname}${u.pathname}.`, publicUrl: url, detail: base });
        const started = Date.now();
        const meta = {};
        let data;
        try {
          const text = await request(url, body, headers, 0, meta);
          data = JSON.parse(text);
        } catch (e) {
          ev({ phase: 'api_response', status: 'error', title: `Error from ${u.hostname}`, message: e instanceof SyntaxError ? 'The response isn\'t valid JSON.' : e.message, publicUrl: url, durationMs: Date.now() - started, detail: { ...base, httpStatus: meta.status ?? null } });
          throw e;
        }
        const resultCount = countRecords(data);
        ev({
          phase: 'api_response',
          status: 'success',
          title: `HTTP ${meta.status} · ${u.hostname}`,
          message: `${u.hostname} returned${resultCount === null ? '' : ` with ${resultCount} ${resultCount === 1 ? 'record' : 'records'}`} in ${Date.now() - started} ms.`,
          publicUrl: url,
          durationMs: Date.now() - started,
          ...(resultCount === null ? {} : { resultCount }),
          detail: { ...base, httpStatus: meta.status, bytes: meta.bytes ?? null, sample: safeSample(data, { secrets: live.secrets }), preview: previewRecords(data, { secrets: live.secrets }) },
        });
        // Store payloads without authentication envelopes or request URLs containing API keys.
        const { token: _token, ...sanitized } = data;
        record(new URL(url).origin + new URL(url).pathname, sanitized);
        return data;
      },
      async page(url) {
        const u = new URL(url);
        const visitId = `visit-${++calls}`;
        const detail = { kind: 'page', visitId, host: u.hostname };
        if (!(await allowedByRobots(u, ev, detail))) {
          ev({ phase: 'warning', status: 'warning', title: 'Read skipped', message: `${u.hostname}: read skipped by robots.txt.`, publicUrl: url, detail });
          throw new Error('Read skipped by robots.txt.');
        }
        if (browser) {
          const capture = !frames || frames.canStore();
          const started = Date.now();
          try {
            await throttle(url);
            const result = await browser.visit(url, {
              screenshot: capture,
              userAgent: env.RESEARCH_USER_AGENT || undefined,
              onOpened: () => ev({ phase: 'browser_opened', status: 'running', title: 'Chromium opens the page', message: `Headless browser opening ${u.hostname}.`, publicUrl: url, detail }),
              onLoaded: ({ status, durationMs }) => ev({ phase: 'page_loaded', status: status < 400 ? 'running' : 'error', title: `HTTP ${status} · DOM loaded`, message: `${u.hostname}: document loaded (domcontentloaded) in ${durationMs} ms.`, publicUrl: url, durationMs, detail: { ...detail, httpStatus: status } }),
            });
            const finalHost = new URL(result.finalUrl).hostname.replace(/^www\./, '');
            if (finalHost !== u.hostname.replace(/^www\./, '')) throw new Error('Redirect outside the official site; read skipped.');
            if (result.status < 200 || result.status >= 300) throw Object.assign(new Error(`HTTP ${result.status}`), { status: result.status });
            if (result.screenshot) {
              const frameId = frames?.put(result.screenshot) || null;
              if (frameId) ev({ phase: 'screenshot', status: 'running', title: 'Real capture', message: `Capture ${1280}×${720} of ${u.hostname}.`, publicUrl: result.finalUrl, frameId, detail });
            } else if (!capture) {
              ev({ phase: 'reading', status: 'running', title: 'No capture', message: 'Capture limit reached; page read without capture.', publicUrl: url, detail });
            }
            const text = plain(result.html);
            ev({ phase: 'reading', status: 'running', title: 'Text extracted', message: `${u.hostname}: ${text.length.toLocaleString('en-US')} characters of text read.`, publicUrl: result.finalUrl, durationMs: Date.now() - started, detail });
            record(url, { text });
            return text;
          } catch (e) {
            if (e.code === 'BROWSER_UNAVAILABLE') {
              ev({ phase: 'warning', status: 'warning', title: 'Browser unavailable', message: `${e.message} Reading over HTTP, no capture.`, publicUrl: url, detail });
            } else {
              ev({ phase: 'error', status: 'error', title: 'The browser couldn\'t load the page', message: `${u.hostname}: ${e.message}`, publicUrl: url, durationMs: Date.now() - started, detail: { ...detail, httpStatus: e.status ?? null } });
              // Una redirección externa no se sigue por ninguna vía.
              if (/Redirección fuera/.test(e.message)) throw e;
              ev({ phase: 'reading', status: 'running', title: 'Direct HTTP read', message: `Trying the same document over HTTP, without a browser.`, publicUrl: url, detail });
            }
          }
        }
        const started = Date.now();
        let body;
        try {
          body = await request(url);
        } catch (e) {
          ev({ phase: 'error', status: 'error', title: 'HTTP read failed', message: `${u.hostname}: ${e.message}`, publicUrl: url, durationMs: Date.now() - started, detail: { ...detail, via: 'http', httpStatus: e.status ?? null } });
          throw e;
        }
        const text = plain(body);
        ev({ phase: 'reading', status: 'running', title: 'Document read over HTTP', message: `${u.hostname}: ${text.length.toLocaleString('en-US')} characters of text (no browser).`, publicUrl: url, durationMs: Date.now() - started, detail: { ...detail, via: 'http' } });
        record(url, { text });
        return text;
      },
    };
  }
  return scoped(live);
}
export const teamFactsApply = (brief) =>
  isIGC(brief) && ['ram mukunda', 'rohit goel'].includes(norm(brief.name));
export async function teamFacts(client, brief) {
  if (!teamFactsApply(brief)) return { sender: [], team: null };
  const text = await client.page(TEAM);
  if (!text.includes(brief.name)) return { sender: [], team: null };
  // Identity/role are extracted from the same official team text; no user-supplied claims.
  const role =
    norm(brief.name) === 'ram mukunda' ? 'CEO & Director' : 'Senior Director';
  const nearby = text.slice(
    Math.max(0, text.indexOf(brief.name) - 100),
    text.indexOf(brief.name) + 180,
  );
  const identityQuote =
    norm(brief.name) === 'ram mukunda'
      ? 'CEO & Director Ram Mukunda'
      : 'Accounting & Finance Rohit Goel Senior Director';
  const sender =
    text.includes(identityQuote) && nearby.includes(role)
      ? [
          {
            ...evidence('IGC Pharma', TEAM, identityQuote, 'sender'),
            statement: `I'm ${brief.name}, ${role} at IGC Pharma`,
          },
        ]
      : [];
  if (
    brief.product === 'IGC-AD1' &&
    text.includes('IGC-AD1 that is in Phase 2 for Alzheimer’s disease')
  )
    sender.push({
      ...evidence(
        'IGC Pharma',
        TEAM,
        'IGC-AD1 that is in Phase 2 for Alzheimer’s disease',
        'product',
      ),
      statement: 'IGC-AD1 is in Phase 2 for Alzheimer\'s',
    });
  if (/^AHA\b/i.test(brief.product)) {
    try {
      const url = 'https://igcpharma.com/aha-agentic-harmonization-assistant/';
      const productText = await client.page(url);
      const quote = productText.match(
        /aha™ unifies data names, formats, and structures across studies[^.]+\./,
      )?.[0];
      if (quote)
        sender.push({
          ...evidence('IGC Pharma', url, quote, 'product'),
          statement:
            'AHA harmonizes names, formats and data structures for Alzheimer\'s research',
        });
    } catch {
      /* The sender identity remains usable when the product page fails. */
    }
  }
  const team = text.includes('Advisor Prof. Jeffrey L. Cummings')
    ? evidence('IGC Pharma', TEAM, 'Advisor Prof. Jeffrey L. Cummings', 'team')
    : null;
  return { sender, team };
}
export function openalexLeads(data, brief, team) {
  if (!Array.isArray(data.results))
    throw new Error('OpenAlex: unexpected response format.');
  const leads = [];
  for (const work of data.results) {
    const authors = work.authorships || [];
    const hasAdvisor = authors.some((a) => a.author?.id === AUTHOR);
    const url = safeUrl(work.doi) || safeUrl(work.id);
    if (!url || !work.title) continue;
    for (const a of authors) {
      if (!a.author?.display_name || a.author.id === AUTHOR) continue;
      for (const org of (a.institutions || []).filter(
        (i) => i.type === 'company',
      )) {
        const e = evidence('OpenAlex', url, work.title, 'work');
        const personEvidence = evidence(
          'OpenAlex',
          work.id,
          `${a.author.display_name} · ${org.display_name} · ${work.publication_year}`,
          'person',
        );
        const paths =
          team && hasAdvisor && brief.useTeam && isIGC(brief)
            ? [
                {
                  nodes: [
                    brief.name,
                    'Jeffrey L. Cummings',
                    a.author.display_name,
                  ],
                  strength: 0.26,
                  hypothesis: true,
                  hops: [
                    {
                      from: brief.name,
                      to: 'Jeffrey L. Cummings',
                      relation:
                        'Same company / public advisor; personal access not confirmed',
                      strength: 0.65,
                      evidenceIds: [team.id],
                      url: TEAM,
                    },
                    {
                      from: 'Jeffrey L. Cummings',
                      to: a.author.display_name,
                      relation: `Co-authorship ${work.publication_year}; past affiliation`,
                      strength: 0.4,
                      evidenceIds: [e.id, personEvidence.id],
                      url,
                    },
                  ],
                },
              ]
            : [];
        leads.push(
          candidate({
            person: a.author.display_name,
            personId: a.author.id,
            org: org.display_name,
            title: work.title,
            kind: 'person',
            fundingType: 'partnering',
            evidence: [e, personEvidence, ...(paths.length ? [team] : [])],
            paths,
            risks: [
              /otsuka|lundbeck|axsome/i.test(org.display_name)
                ? 'competitor_conflict'
                : 'Partnering interest not confirmed',
              'Co-authorship isn\'t friendship or investment authority',
            ],
            missing: [
              'Current affiliation and BD role to confirm',
            ],
            searchText: work.title,
          }),
        );
      }
    }
  }
  return leads;
}
export async function openalex(client, brief, plan, team, env) {
  const q = new URLSearchParams({
    filter: `authorships.institutions.type:company,publication_year:${new Date().getFullYear() - 5}-${new Date().getFullYear()}${isIGC(brief) && brief.useTeam ? ',authorships.author.id:A5060487287' : ''}`,
    search: plan.scientificQuery,
    'per-page': '40',
  });
  if (env.OPENALEX_API_KEY) q.set('api_key', env.OPENALEX_API_KEY);
  if (env.OPENALEX_MAILTO) q.set('mailto', env.OPENALEX_MAILTO);
  return openalexLeads(
    await client.json(`https://api.openalex.org/works?${q}`),
    brief,
    team,
  );
}
export function trialsLeads(data) {
  if (!Array.isArray(data.studies))
    throw new Error('ClinicalTrials: unexpected format.');
  return data.studies.flatMap((s) => {
    const p = s.protocolSection;
    const org = p.sponsorCollaboratorsModule?.leadSponsor;
    if (!org?.name || org.class !== 'INDUSTRY') return [];
    const title = p.identificationModule.briefTitle;
    const nct = p.identificationModule.nctId;
    const url = `https://clinicaltrials.gov/study/${nct}`;
    const people = p.contactsLocationsModule?.overallOfficials || [];
    const person = people.find(
      (p) =>
        p.name &&
        norm(p.name) !== norm(org.name) &&
        !/medical director|clinical trials|study director|research team|central contact|study official/i.test(
          p.name,
        ),
    );
    // Study recruitment contacts are not fundraising contacts; do not repurpose their email.
    return [
      candidate({
        externalId: nct,
        person: person?.name || null,
        role: person?.role || null,
        org: org.name,
        title,
        kind: 'research',
        fundingType: 'partnering',
        status: 'active',
        contact: {
          type: 'source',
          value: url,
          provenance: 'Public trial record; not a BD channel',
        },
        evidence: [
          evidence('ClinicalTrials.gov', url, title, 'title'),
          evidence(
            'ClinicalTrials.gov',
            url,
            JSON.stringify({
              sponsor: org,
              official: person,
              status: p.statusModule.overallStatus,
            }),
            'registry',
          ),
        ],
        risks: [
          'competitor_conflict',
          'Trial sponsor; not a funding offer',
        ],
        missing: ['Partnering lead and BD channel'],
        searchText: `${title} ${(p.conditionsModule?.conditions || []).join(' ')}`,
      }),
    ];
  });
}
export async function clinicalTrials(client, brief, plan) {
  const q = new URLSearchParams({
    'query.cond': plan.topic,
    ...(plan.scientificQuery === 'agitation'
      ? { 'query.term': 'agitation' }
      : {}),
    'filter.overallStatus':
      'RECRUITING,ACTIVE_NOT_RECRUITING,NOT_YET_RECRUITING',
    pageSize: '30',
    format: 'json',
  });
  return trialsLeads(
    await client.json(`https://clinicaltrials.gov/api/v2/studies?${q}`),
  );
}
const isoDate = (value) => {
  const m = String(value || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m
    ? `${m[3]}-${m[1]}-${m[2]}`
    : /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? value
      : null;
};
export function grantLead(hit, detail) {
  const url = `https://www.grants.gov/search-results-detail/${hit.id}`;
  const syn = detail?.synopsis || {};
  const title = plain(hit.title);
  const ev = [
    evidence('Grants.gov', url, title, 'opportunity'),
    evidence(
      'Grants.gov',
      url,
      JSON.stringify({
        agency: hit.agency,
        status: hit.oppStatus,
        closeDate: hit.closeDate,
        number: hit.number,
      }),
      'registry',
    ),
  ];
  if (syn.synopsisDesc)
    ev.push(
      evidence(
        'Grants.gov',
        url,
        plain(syn.synopsisDesc).slice(0, 1000),
        'scope',
      ),
    );
  if (syn.applicantTypes?.length)
    ev.push(
      evidence(
        'Grants.gov',
        url,
        syn.applicantTypes.map((a) => a.description).join('; '),
        'eligibility',
      ),
    );
  const contactLines = String(syn.agencyContactName || '')
    .split(/[\r\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const namedContact =
    contactLines.length > 1 &&
    !/help|desk|support|office|contact/i.test(contactLines[0])
      ? contactLines[0]
      : null;
  if (namedContact)
    ev.push(
      evidence('Grants.gov', url, String(syn.agencyContactName), 'person'),
    );
  const email = syn.agencyContactEmail;
  const publishedEmail =
    typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
      ? email
      : null;
  if (publishedEmail) ev.push(evidence('Grants.gov', url, email, 'contact'));
  if (syn.applicantEligibilityDesc)
    ev.push(
      evidence(
        'Grants.gov',
        url,
        plain(syn.applicantEligibilityDesc),
        'eligibility',
      ),
    );
  const amount = Number(syn.awardCeiling);
  if (amount > 0)
    ev.push(evidence('Grants.gov', url, String(syn.awardCeiling), 'amount'));
  return candidate({
    person: namedContact,
    role: namedContact ? contactLines.slice(1).join(' ') : null,
    externalId: hit.number || hit.id,
    org: hit.agency,
    title,
    kind: 'opportunity',
    fundingType: 'grant',
    status:
      hit.oppStatus === 'posted'
        ? 'open'
        : hit.oppStatus === 'forecasted'
          ? 'forecasted'
          : 'unknown',
    deadline: isoDate(hit.closeDate),
    amount: amount > 0 ? amount : null,
    contact: {
      type: publishedEmail ? 'email' : 'source',
      value: publishedEmail || url,
      provenance: publishedEmail
        ? 'Published in the official call'
        : 'Official page; check the agency contact',
    },
    evidence: ev,
    risks: [
      'Eligibility requires checking applicant, ownership, countries and use of funds',
      ...(/SBIR|STTR/.test(title)
        ? [
            'SBIR/STTR: confirm conditions for public companies and non-US work',
          ]
        : []),
    ],
    missing: detail ? [] : ['Call details not retrieved'],
    searchText: `${title} ${plain(syn.synopsisDesc).slice(0, 5000)}`,
  });
}
export async function grants(client, brief, plan, emit) {
  let data = await client.json('https://api.grants.gov/v1/api/search2', {
    keyword: plan.query,
    oppStatuses: 'posted|forecasted',
    rows: 15,
  });
  if (data.errorcode !== 0 || !Array.isArray(data.data?.oppHits))
    throw new Error('Grants.gov: invalid response.');
  if (!data.data.oppHits.length) {
    emit(
      'searching',
      `Grants.gov: no exact matches; widening to ${plan.topic}.`,
    );
    data = await client.json('https://api.grants.gov/v1/api/search2', {
      keyword: plan.topic,
      oppStatuses: 'posted|forecasted',
      rows: 15,
    });
  }
  const leads = [];
  for (const hit of (data.data?.oppHits || []).slice(0, 12)) {
    let detail = null;
    try {
      const d = await client.json(
        'https://api.grants.gov/v1/api/fetchOpportunity',
        { opportunityId: Number(hit.id) },
      );
      if (d.errorcode === 0) detail = d.data;
    } catch {
      emit(
        'warning',
        `Grants.gov: detail ${hit.number} unavailable; kept the basic record.`,
      );
    }
    leads.push(grantLead(hit, detail));
  }
  return leads;
}
export function reporterLeads(data) {
  if (!Array.isArray(data.results))
    throw new Error('NIH RePORTER: unexpected format.');
  return data.results.map((p) => {
    const url = `https://reporter.nih.gov/project-details/${p.appl_id}`;
    const pi = p.principal_investigators?.[0];
    const officer = p.program_officers?.find((o) => o.full_name);
    return candidate({
      externalId: String(p.appl_id),
      person: officer?.full_name || pi?.full_name || null,
      role: officer
        ? 'Program officer (registered project)'
        : pi
          ? 'Principal investigator (registered project)'
          : null,
      org: officer
        ? `NIH · ${p.agency_ic_admin?.name || p.agency_ic_admin?.abbreviation || 'institute to confirm'}`
        : p.organization?.org_name || 'Organization unavailable',
      title: p.project_title,
      kind: 'research',
      fundingType: 'grant',
      contact: {
        type: 'source',
        value: url,
        provenance:
          'Funded project: use the official channel; not an open call',
      },
      evidence: [
        evidence('NIH RePORTER', url, p.project_title, 'title'),
        evidence(
          'NIH RePORTER',
          url,
          JSON.stringify({
            organization: p.organization?.org_name,
            principal_investigator: pi?.full_name,
            program_officer: officer?.full_name,
            funding_institute: p.agency_ic_admin,
            project_num: p.project_num,
            fiscal_year: p.fiscal_year,
            historical_award_usd: p.award_amount,
          }),
          'registry',
        ),
      ],
      risks: [
        'Past funding; nothing offered to applicants',
        officer
          ? 'Current role and applicable call to confirm'
          : 'Academic PI, not an investment decision-maker',
      ],
      missing: ['Availability to collaborate'],
      searchText: `${p.project_title} ${(p.abstract_text || '').slice(0, 4000)}`,
    });
  });
}
export async function reporter(client, brief, plan) {
  return reporterLeads(
    await client.json('https://api.reporter.nih.gov/v2/projects/search', {
      criteria: {
        advanced_text_search: {
          operator: 'and',
          search_field: 'projecttitle,abstracttext',
          search_text: plan.query,
        },
        use_relevance: true,
        fiscal_years: [new Date().getFullYear(), new Date().getFullYear() - 1],
      },
      limit: 15,
      offset: 0,
    }),
  );
}
export async function radar(client, brief, plan, emit) {
  const sources = [
    {
      org: "Alzheimer's Drug Discovery Foundation",
      title: 'Drug Development RFP',
      url: 'https://www.alzdiscovery.org/research-and-grants/funding-opportunities/drug-development-rfp',
      type: 'investment',
      pattern: /The Drug Development RFP supports[^.]+\./i,
    },
    {
      org: 'a2 Collective',
      title: 'a2 Pilot Awards',
      url: 'https://www.a2collective.ai/pilotawards',
      type: 'grant',
      pattern: /The a2 Collective anticipates[^.]+\./i,
    },
    {
      org: 'CDMRP',
      title: 'Alzheimer’s Research Program',
      url: 'https://cdmrp.health.mil/funding/azrp',
      type: 'grant',
      pattern: /Alzheimer.{0,120}/i,
    },
  ];
  const leads = [];
  for (const s of sources) {
    try {
      const text = await client.page(s.url);
      const match = text.match(s.pattern);
      if (!match)
        throw new Error(
          'Content changed; couldn\'t verify the program.',
        );
      const ev = [evidence(s.org, s.url, match[0], 'opportunity')];
      const email =
        s.org === 'a2 Collective'
          ? 'support@a2collective.ai'
          : s.org.includes('Discovery')
            ? 'grants@alzdiscovery.org'
            : null;
      if (email && text.includes(email))
        ev.push(evidence(s.org, s.url, email, 'contact'));
      const closed = /competition is now closed/i.test(text);
      const dateMatch = text.match(
        /Letter of Intent\s+(January|February|March|April|May|June|July|August|September|October|November|December) (\d{1,2}), (\d{4})/i,
      );
      const deadline = dateMatch
        ? new Date(`${dateMatch[1]} ${dateMatch[2]}, ${dateMatch[3]} UTC`)
            .toISOString()
            .slice(0, 10)
        : null;
      if (dateMatch) ev.push(evidence(s.org, s.url, dateMatch[0], 'deadline'));
      const roi = text.match(
        /Funding is provided through mission-related investments[^.]+\./i,
      );
      if (roi) ev.push(evidence(s.org, s.url, roi[0], 'instrument'));
      const amountMatch = text.match(/Up to \$([\d,]+)/i);
      if (amountMatch)
        ev.push(evidence(s.org, s.url, amountMatch[0], 'amount'));
      leads.push(
        candidate({
          org: s.org,
          title: s.title,
          kind: 'radar',
          fundingType: s.type,
          status: closed ? 'closed' : 'unknown',
          deadline,
          amount: amountMatch
            ? Number(amountMatch[1].replaceAll(',', ''))
            : null,
          contact: {
            type: email && text.includes(email) ? 'email' : 'source',
            value: email && text.includes(email) ? email : s.url,
            provenance: 'Published on the official page',
          },
          evidence: ev,
          searchText: match[0],
          risks: [
            roi
              ? 'Investment requiring return; not a pure grant'
              : 'Next cycle and eligibility to confirm',
          ],
          missing: deadline ? [] : ['Next cycle date not confirmed'],
        }),
      );
    } catch (e) {
      emit('warning', `${s.org}: ${e.message}`);
    }
  }
  return leads;
}
/* ───────── Exa: búsqueda semántica con el perfil completo ───────── */
const EXA = 'https://api.exa.ai/search';
const OBJECTIVE_ASK = {
  investment: (b) => `Venture capital funds and angel investors that invest in ${b.round || 'early-stage'} ${b.industry} startups${b.geography ? ` in ${b.geography}` : ''}`,
  grant: (b) => `Open grant programs and non-dilutive funding calls for ${b.industry} projects at ${b.stage} stage${b.geography ? ` in ${b.geography}` : ''}`,
  partnering: (b) => `Companies looking for partnerships, licensing or co-development in ${b.industry}`,
  sponsorship: (b) => `Corporate sponsors, CSR programs and foundations that sponsor ${b.industry} initiatives${b.geography ? ` in ${b.geography}` : ''}`,
  debt: (b) => `Venture debt lenders and loan programs for ${b.stage} ${b.industry} companies${b.geography ? ` in ${b.geography}` : ''}`,
};
/** Consulta en lenguaje natural con TODO el perfil: producto, etapa, monto, criterios y restricciones. */
export function exaQuery(brief, objective) {
  const b = brief;
  const parts = [
    `${OBJECTIVE_ASK[objective]?.(b) || OBJECTIVE_ASK.investment(b)}, a good fit for ${ventureOf(b)} (${b.oneLiner || b.description.slice(0, 220)})`,
    b.amount ? `Target amount: USD ${b.amount}` : '',
    b.useOfFunds ? `Use of funds: ${b.useOfFunds}` : '',
    b.criteria ? `Preferences: ${b.criteria}` : '',
    b.constraints ? `Avoid: ${b.constraints}` : '',
  ];
  return parts.filter(Boolean).join('. ').replace(/\s+/g, ' ').slice(0, 900);
}
const host = (url) => new URL(url).hostname.replace(/^www\./, '');
const ownTokens = (b) => [...new Set([
  ...[b.organization, ventureOf(b), b.company].map((x) => norm(x).split(' ')[0]),
  ...(safeUrl(b.website) ? [norm(host(b.website)).split(' ')[0]] : []),
].filter((t) => t && t.length >= 3))];
function exaLeads(results, brief, { objective, source, field, risks = [], missing = [] }) {
  const own = ownTokens(brief);
  return (results || []).flatMap((r) => {
    const url = safeUrl(r?.url);
    if (!url) return [];
    const h = host(url);
    // No devolver la propia empresa ni la organización que busca como candidato.
    if (norm(h).split(' ').some((part) => own.some((t) => part.startsWith(t)))) return [];
    const highlights = (Array.isArray(r.highlights) ? r.highlights : []).map((x) => String(x).trim()).filter(Boolean);
    const quote = highlights.join(' … ') || String(r.summary || r.text || '').slice(0, 600) || r.title;
    if (!quote) return [];
    return [candidate({
      externalId: `exa:${url}`,
      org: h,
      title: String(r.title || h).slice(0, 300),
      kind: 'research',
      fundingType: objective,
      status: 'unknown',
      contact: { type: 'source', value: url, provenance: `Page found by Exa${r.publishedDate ? ` · published ${String(r.publishedDate).slice(0, 10)}` : ''}` },
      // Los highlights son extractos del contenido real de la página (no snippets de buscador).
      evidence: [evidence(source, url, quote, field)],
      searchText: `${r.title || ''} ${quote}`,
      risks: ['Found by semantic search: confirm mandate, timing and eligibility', ...risks],
      missing: ['No decision-maker named on the page', ...missing],
    })];
  });
}
export async function exaSearch(client, brief, plan, env, emit = () => {}) {
  if (!env.EXA_API_KEY) throw new Error('EXA_API_KEY not set.');
  const per = Math.min(15, Math.max(3, Number(env.EXA_NUM_RESULTS) || 8));
  const leads = [];
  for (const objective of brief.fundingTypes) {
    const query = exaQuery(brief, objective);
    try {
      const data = await client.json(EXA, { query, type: 'auto', numResults: per, contents: { highlights: true } }, { Authorization: `Bearer ${env.EXA_API_KEY}` });
      const found = exaLeads(data.results, brief, { objective, source: 'Exa', field: 'search_highlight' });
      leads.push(...found);
      emit('reading', `Exa · ${objective}: ${found.length} results.`);
    } catch (e) {
      emit('warning', `Exa · ${objective}: ${e.message}`);
    }
  }
  return leads;
}
/* Anuncios de rondas: quién lideró rondas parecidas. Exa (noticias, texto de la página) o Serper News (snippets). */
export async function roundAnnouncements(client, brief, plan, env) {
  const since = new Date(Date.now() - 548 * 86400000).toISOString().slice(0, 10);
  const q = `${brief.industry} startup raised a ${brief.round || 'seed'} round led by${brief.geography ? ` (${brief.geography})` : ''}`;
  if (env.EXA_API_KEY) {
    const data = await client.json(EXA, { query: q, type: 'auto', category: 'news', numResults: 10, startPublishedDate: `${since}T00:00:00.000Z`, contents: { highlights: true } }, { Authorization: `Bearer ${env.EXA_API_KEY}` });
    return exaLeads(data.results, brief, { objective: 'investment', source: 'Exa · news', field: 'round_announcement', risks: ['Round announcement: identify the lead investor before reaching out'] });
  }
  if (!env.SERPER_API_KEY) throw new Error('Set EXA_API_KEY or SERPER_API_KEY.');
  const data = await client.json('https://google.serper.dev/news', { q, num: 10, tbs: 'qdr:y' }, { 'X-API-KEY': env.SERPER_API_KEY });
  return (data.news || []).filter((r) => safeUrl(r.link)).map((r) => candidate({
    externalId: `serper-news:${r.link}`,
    org: host(r.link),
    title: r.title,
    kind: 'research',
    fundingType: 'investment',
    evidence: [evidence('Serper News: unverified lead', r.link, r.snippet || r.title, 'round_announcement', undefined, false)],
    risks: ['Round announcement: identify the lead investor before reaching out'],
    missing: ['Unverified search snippet; open the article'],
  }));
}
export async function webSearch(client, brief, plan, env) {
  if (!env.SERPER_API_KEY)
    throw new Error(
      'SERPER_API_KEY not set; broad web search skipped.',
    );
  const data = await client.json(
    'https://google.serper.dev/search',
    {
      q: `${plan.query} ${brief.fundingTypes.join(' ')} ${brief.geography} ${brief.criteria}`.slice(
        0,
        500,
      ),
      num: 10,
    },
    { 'X-API-KEY': env.SERPER_API_KEY },
  );
  return (data.organic || [])
    .filter((r) => safeUrl(r.link))
    .map((r) =>
      candidate({
        org: new URL(r.link).hostname,
        title: r.title,
        kind: 'research',
        fundingType: brief.fundingTypes[0],
        evidence: [
          evidence(
            'Serper: unverified lead',
            r.link,
            r.snippet || r.title,
            'search_snippet',
            undefined,
            false,
          ),
        ],
        missing: ['Unverified source content; don\'t use for outreach'],
      }),
    );
}
