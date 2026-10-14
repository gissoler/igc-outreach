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
const personOf = (p) => ({ source: 'apollo', email: null, name: [p.first_name, p.last_name || p.last_name_obfuscated].filter(Boolean).join(' ') || p.name || null, title: p.title || null,
  organization: p.organization?.name || p.organization_name || null, linkedin_url: p.linkedin_url || null, apollo_id: p.id || null, has_email: p.has_email ?? null });

// Los contactos que ya trae el hallazgo (p. ej. el correo de la agencia en el registro oficial) se conservan delante de los de Apollo.
const setContacts = (f, rows) => { f.contacts = [...(f.contacts || []).filter((c) => c?.source === 'registry'), ...rows]; };
/* Política (14-10, decisión de la dueña): Apollo es sobre todo para outreach a INVERSORES. Ahí cada persona se enriquece
   (nombre completo, LinkedIn y correo de trabajo) porque un nombre enmascarado no sirve para escribir.
   En grants Apollo queda apagado por defecto (APOLLO_FOR_GRANTS=1 lo enciende; APOLLO_ENRICH_GRANTS=1 también enriquece):
   para una convocatoria el contacto útil es el oficial del registro o de la página. */
const enrichOn = (objective, env) => objective !== 'grant' ? String(env.APOLLO_ENRICH ?? '1') !== '0' : String(env.APOLLO_ENRICH_GRANTS || '') === '1';
async function enrich(rows, { tools, domain, n }) {
  const out = [];
  for (const [i, p] of rows.entries()) {
    if (i >= n || !p.apollo_id) { out.push(p); continue; }
    const m = await tools.apollo({ op: 'match', id: p.apollo_id, domain });
    const q = m?.rows?.[0];
    out.push(q ? { ...p, name: [q.first_name, q.last_name].filter(Boolean).join(' ') || q.name || p.name, title: q.title || p.title, linkedin_url: q.linkedin_url || p.linkedin_url, email: q.email && !/^email_not_unlocked/i.test(q.email) ? q.email : null, email_status: q.email_status || null, enriched: true } : p);
  }
  return out;
}
export async function contactStage({ findings = [], objective = 'grant', tools, trace, env = process.env, maxOrgs = Number(env.ENGINE_AGENT_APOLLO_ORGS) || 5, peoplePerOrg = Number(env.APOLLO_PEOPLE_PER_ORG) || 3, alreadyQueried = new Set(), configured = Boolean(env.APOLLO_API_KEY) } = {}) {
  const out = { orgs: 0, people: 0, credits: 0, skipped: null, domains: [] };
  if (String(env.APOLLO_ENABLED ?? '1') === '0') { out.skipped = 'APOLLO_ENABLED=0'; return out; }
  if (!configured) { out.skipped = 'APOLLO_API_KEY missing'; trace?.event?.('tool_call', { tool: 'apollo', args: { op: 'stage' }, results_n: 0, ms_call: 0, error: 'APOLLO_NOT_CONFIGURED' }); return out; }
  if (objective === 'grant' && String(env.APOLLO_FOR_GRANTS || '') !== '1') { out.skipped = 'grants: APOLLO_FOR_GRANTS=0 (Apollo se reserva para inversores)'; return out; }
  const before = tools.usage?.().apollo_credits || 0; const done = new Map();
  for (const f of findings) {
    if (out.orgs >= maxOrgs) break;
    if (f.eligible === 'no' || f.status === 'closed') continue;
    // Del registro se buscan personas en el sitio de la agencia (enlace «más información»), nunca en el del registro.
    const domain0 = orgDomain(f.registry ? f.registry.moreInfoUrl || '' : f.url); const domain = domain0 && !/^(grants\.gov|sam\.gov)$/.test(domain0) ? domain0 : null; if (!domain || alreadyQueried.has(domain)) { if (domain && done.has(domain)) setContacts(f, done.get(domain)); continue; }
    alreadyQueried.add(domain); out.orgs++; out.domains.push(domain);
    const org = await tools.apollo({ op: 'organization', domain, n: 1 });
    if (org?.error || !org?.rows?.length) { setContacts(f, []); done.set(domain, []); continue; }
    const people = await tools.apollo({ op: 'people', domain, titles: TITLES[objective] || TITLES.grant, n: peoplePerOrg });
    let rows = (people?.rows || []).map(personOf);
    if (rows.length && enrichOn(objective, env)) rows = await enrich(rows, { tools, domain, n: Number(env.APOLLO_ENRICH_PER_ORG) || 2 });
    setContacts(f, rows); done.set(domain, rows); out.people += rows.length;
    if (!rows.length) { const any = await tools.apollo({ op: 'people', domain, titles: [], n: peoplePerOrg }); const r2 = (any?.rows || []).map(personOf); setContacts(f, r2); done.set(domain, r2); out.people += r2.length; }
  }
  out.credits = (tools.usage?.().apollo_credits || 0) - before;
  return out;
}
