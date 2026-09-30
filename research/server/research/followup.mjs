import { norm, safeUrl } from './core.mjs';
import { firecrawlScrape, firecrawlSearch, peopleFromPages, webConfigured, webMissing } from './webscrape.mjs';

const hostOf = (value) => {
  try { return new URL(value).hostname.replace(/^www\./, ''); } catch { return ''; }
};

export function selectFunders(leads, brief, { max = 6 } = {}) {
  const own = [brief.company, brief.organization, brief.venture].map(norm).filter(Boolean);
  const excluded = String(brief.exclusions || '').split(/[,;\n]/).map(norm).filter(Boolean);
  const selected = new Map();
  for (const lead of leads) {
    if (selected.size >= max) break;
    if (lead.person || !['investment', 'debt', 'sponsorship'].includes(lead.fundingType)) continue;
    if (!(lead.evidence || []).some((item) => item.verified)) continue;
    const url = safeUrl(lead.contact?.value) || safeUrl(lead.evidence?.[0]?.url);
    const host = hostOf(url);
    const org = String(lead.org || host).trim();
    const normalized = norm(`${org} ${host}`);
    if (!host || own.some((name) => normalized.includes(name)) || excluded.some((name) => normalized.includes(name))) continue;
    if (selected.has(host)) continue;
    const origin = new URL(url).origin;
    const found = lead.foundBy?.[0] || {};
    selected.set(host, {
      host, origin, org, parentKey: lead.key || lead.externalId || `org:${host}`,
      reason: `Verified funding lead found at ${host}`,
      term: found.term || '', query: found.query || '',
    });
  }
  return [...selected.values()];
}

export async function teamPagesFor(funder, ctx = {}) {
  const { env = process.env, fetcher = fetch, signal, client, record, live, maxPages = 3, search = firecrawlSearch } = ctx;
  const searchStarted = Date.now();
  let discovered = [];
  try { discovered = await search(`site:${funder.host} team OR partners OR people`, { limit: maxPages, markdown: false, env, fetcher, signal, record, live }); }
  catch (error) { if (signal?.aborted) throw error; }
  client.track?.('Firecrawl', { calls: 1, results: discovered.length, ms: Date.now() - searchStarted });
  const urls = [...new Set([
    ...discovered.map((row) => row.url),
    `${funder.origin}/team`, `${funder.origin}/people`, `${funder.origin}/about`,
  ].filter(Boolean))];
  const pages = [];
  const errors = [];
  for (const url of urls) {
    if (pages.length >= maxPages) break;
    if (hostOf(url) !== funder.host) continue;
    let markdown = '';
    try { markdown = await client.page(url); } catch (error) { errors.push(`${url}: ${error.message}`); }
    // Páginas de equipo hechas con JavaScript llegan vacías con la descarga directa: se leen con Firecrawl.
    if (markdown.length <= 120 && ctx.scrape !== false) {
      const got = await (ctx.scrape || firecrawlScrape)(url, { env, fetcher, signal, record, live });
      if (got?.markdown) markdown = got.markdown;
    }
    if (markdown.length > 120) pages.push({ url, title: discovered.find((row) => row.url === url)?.title || `${funder.org} team`, markdown });
  }
  return { pages, errors };
}

export async function followUpPeople(leads, brief, ctx = {}) {
  const { env = process.env, fetcher = fetch, signal, record, live, client } = ctx;
  if (!webConfigured(env)) return { skipped: true, reason: `missing ${webMissing(env).join(' and ')}`, funders: 0, pages: 0, leads: [], errors: [] };
  const maxOrgs = Math.min(20, Math.max(1, Number(env.FOLLOWUP_MAX_ORGS) || 6));
  const maxPages = Math.min(30, Math.max(1, Number(env.FOLLOWUP_MAX_PAGES) || 8));
  const funders = selectFunders(leads, brief, { max: maxOrgs });
  const out = [];
  const errors = [];
  let pages = 0;
  for (const funder of funders) {
    signal?.throwIfAborted?.();
    if (pages >= maxPages) break;
    try {
      const found = await teamPagesFor(funder, { ...ctx, maxPages: Math.min(3, maxPages - pages) });
      pages += found.pages.length;
      errors.push(...found.errors);
      const extracted = await peopleFromPages(found.pages, brief, { env, fetcher, signal, record, live, maxPeople: 12, parent: funder, usageClient: client });
      out.push(...extracted.leads.map((lead) => ({ ...lead, org: lead.org || funder.org })));
      errors.push(...extracted.errors);
    } catch (error) { errors.push(`${funder.org}: ${error.message}`); }
  }
  return { skipped: false, funders: funders.length, pages, leads: out, errors };
}
