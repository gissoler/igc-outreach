/* Contactos con Apollo, en código y después del juez: el modelo ya no decide si se gasta o no. Solo búsquedas de organización y
   personas (sin enriquecimiento ni envíos); el tope de créditos lo impone ApolloBudget. */
const TITLES = {
  grant: ['program officer', 'program director', 'grants manager', 'director of innovation', 'small business program manager'],
  investment: ['partner', 'managing director', 'principal', 'investment director', 'venture partner'],
};
const SECOND_LEVEL = new Set(['co', 'com', 'org', 'gov', 'ac', 'edu', 'net']);
export function orgDomain(url) {
  let host = ''; try { host = new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return null; }
  const p = host.split('.'); if (p.length < 2) return null;
  return p.length >= 3 && p[p.length - 1].length === 2 && SECOND_LEVEL.has(p[p.length - 2]) ? p.slice(-3).join('.') : p.slice(-2).join('.');
}
const personOf = (p) => ({ source: 'apollo', name: [p.first_name, p.last_name || p.last_name_obfuscated].filter(Boolean).join(' ') || p.name || null, title: p.title || null,
  organization: p.organization?.name || p.organization_name || null, linkedin_url: p.linkedin_url || null, apollo_id: p.id || null, has_email: p.has_email ?? null });

// Los contactos que ya trae el hallazgo (p. ej. el correo de la agencia en el registro oficial) se conservan delante de los de Apollo.
const setContacts = (f, rows) => { f.contacts = [...(f.contacts || []).filter((c) => c?.source === 'registry'), ...rows]; };
export async function contactStage({ findings = [], objective = 'grant', tools, trace, env = process.env, maxOrgs = Number(env.ENGINE_AGENT_APOLLO_ORGS) || 5, peoplePerOrg = Number(env.APOLLO_PEOPLE_PER_ORG) || 3, alreadyQueried = new Set(), configured = Boolean(env.APOLLO_API_KEY) } = {}) {
  const out = { orgs: 0, people: 0, credits: 0, skipped: null, domains: [] };
  if (String(env.APOLLO_ENABLED ?? '1') === '0') { out.skipped = 'APOLLO_ENABLED=0'; return out; }
  if (!configured) { out.skipped = 'APOLLO_API_KEY missing'; trace?.event?.('tool_call', { tool: 'apollo', args: { op: 'stage' }, results_n: 0, ms_call: 0, error: 'APOLLO_NOT_CONFIGURED' }); return out; }
  const before = tools.usage?.().apollo_credits || 0; const done = new Map();
  for (const f of findings) {
    if (out.orgs >= maxOrgs) break;
    if (f.eligible === 'no' || f.status === 'closed') continue;
    // Del registro se buscan personas en el sitio de la agencia (enlace «más información»), nunca en el del registro.
    const domain = orgDomain(f.registry ? f.registry.moreInfoUrl || '' : f.url); if (!domain || alreadyQueried.has(domain)) { if (domain && done.has(domain)) setContacts(f, done.get(domain)); continue; }
    alreadyQueried.add(domain); out.orgs++; out.domains.push(domain);
    const org = await tools.apollo({ op: 'organization', domain, n: 1 });
    if (org?.error || !org?.rows?.length) { setContacts(f, []); done.set(domain, []); continue; }
    const people = await tools.apollo({ op: 'people', domain, titles: TITLES[objective] || TITLES.grant, n: peoplePerOrg });
    const rows = (people?.rows || []).map(personOf); setContacts(f, rows); done.set(domain, rows); out.people += rows.length;
    if (!rows.length) { const any = await tools.apollo({ op: 'people', domain, titles: [], n: peoplePerOrg }); const r2 = (any?.rows || []).map(personOf); setContacts(f, r2); done.set(domain, r2); out.people += r2.length; }
  }
  out.credits = (tools.usage?.().apollo_credits || 0) - before;
  return out;
}
