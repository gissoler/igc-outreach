/* ─────────────────────────────────────────────────────────────────────────────
   Hunter.io: emails profesionales y más personas por organización.
   · email-finder  → persona con nombre + dominio de su organización → su email.
   · domain-search → organización sin persona → personas con cargo y email en ese dominio
                     (se añaden como candidatos nuevos, colgando de la organización).
   · Solo dominios propios de la contraparte: nada de redes, agregadores, prensa ni registros públicos.
   · El email llega con su confianza (score) y estado de verificación de Hunter; nunca se envía nada.
   · Clave solo en el servidor (HUNTER_API_KEY, cabecera X-API-KEY). Presupuesto por corrida.
   ───────────────────────────────────────────────────────────────────────────── */
import { candidate, evidence, norm, safeUrl } from './core.mjs';
import { hostKind } from './verify.mjs';

const API = 'https://api.hunter.io/v2';
export const HUNTER_SOURCE = 'Hunter.io';
export const hunterConfigured = (env = process.env) => Boolean(String(env.HUNTER_API_KEY || '').trim());
const clamp = (value, min, max, fallback) => { const n = Number(value); return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : fallback; };

/** Dominios que no son de la contraparte: registros, prensa, plataformas, buscadores. */
const NOT_OWN = /(^|\.)(grants\.gov|simpler\.grants\.gov|sam\.gov|nih\.gov|reporter\.nih\.gov|clinicaltrials\.gov|europa\.eu|ec\.europa\.eu|cordis\.europa\.eu|wikipedia\.org|wikimedia\.org|github\.com|google\.com|googleusercontent\.com|apple\.com|amazon\.com|microsoft\.com|bloomberg\.com|reuters\.com|forbes\.com|techcrunch\.com|businesswire\.com|prnewswire\.com|globenewswire\.com|finsmes\.com|venturebeat\.com|axios\.com|nytimes\.com|wsj\.com|ft\.com|cnbc\.com|bbc\.co\.uk|theguardian\.com|fiercebiotech\.com|fiercehealthcare\.com|mobihealthnews\.com|statnews\.com|sifted\.eu|entrepreneur\.com|inc\.com|yahoo\.com|msn\.com|notion\.site|typeform\.com|airtable\.com|docs\.google\.com|forms\.gle|eventbrite\.com|lu\.ma|openalex\.org|doi\.org|pubmed\.ncbi\.nlm\.nih\.gov|ncbi\.nlm\.nih\.gov|researchgate\.net|arxiv\.org|scholar\.google\.com)$/i;
const TWO_LEVEL = /\.(co|com|org|net|ac|gov|edu|or|ne|go)\.[a-z]{2}$/i;

/** host → dominio registrable aproximado (acme.co.uk, acme.com). */
export function registrableDomain(host) {
  const h = String(host || '').toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  if (!h || /^\d+\.\d+\.\d+\.\d+$/.test(h) || !h.includes('.')) return '';
  const parts = h.split('.');
  return parts.slice(TWO_LEVEL.test(h) ? -3 : -2).join('.');
}

/** Dominio propio del lead: su canal web o su evidencia, si no es prensa/red/agregador/registro. */
export function leadDomain(lead) {
  const urls = [lead?.contact?.type === 'web' || lead?.contact?.type === 'source' ? lead.contact.value : null, ...(lead?.evidence || []).map((e) => e.url)];
  for (const raw of urls) {
    const url = safeUrl(raw);
    if (!url || hostKind(url) !== 'other') continue;
    const host = new URL(url).hostname;
    const domain = registrableDomain(host);
    if (domain && !NOT_OWN.test(host) && !NOT_OWN.test(domain)) return domain;
  }
  return '';
}

/** Cargos que deciden o reciben propuestas, por tipo de financiación. */
const ROLE = {
  investment: /partner|principal|invest|venture|managing director|general partner|\bgp\b|associate|founder|ceo|chief investment|portfolio|platform|scout/i,
  debt: /debt|credit|lending|loan|partner|principal|director|finance/i,
  grant: /grant|program|programme|fund|partnership|innovation|director|officer|manager|head/i,
  sponsorship: /partnership|sponsor|marketing|brand|community|events|developer relations|startup/i,
  partnering: /business development|partnership|alliance|corporate development|licens|innovation|director|head|vp/i,
};
const roleFor = (fundingType) => ROLE[fundingType] || ROLE.partnering;
const SENIOR = new Set(['executive', 'senior']);

export function makeHunter({ env = process.env, fetcher = fetch, signal, usageClient = null } = {}) {
  const apiKey = String(env.HUNTER_API_KEY || '').trim();
  let calls = 0; let disabled = '';
  const budget = clamp(env.HUNTER_MAX_CALLS, 0, 200, 30);
  async function get(path, params) {
    if (!apiKey) throw new Error('HUNTER_API_KEY not set.');
    if (disabled) throw Object.assign(new Error(disabled), { fatal: true });
    if (calls >= budget) throw Object.assign(new Error(`Hunter budget reached (${budget} calls; HUNTER_MAX_CALLS).`), { budget: true });
    calls++;
    const started = Date.now();
    const timeout = AbortSignal.timeout(clamp(env.HUNTER_TIMEOUT_MS, 3000, 60000, 20000));
    let r;
    for (let attempt = 0; attempt < 3; attempt++) {
      r = await fetcher(`${API}/${path}?${new URLSearchParams(params)}`, { headers: { 'X-API-KEY': apiKey, Accept: 'application/json' }, signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
      if (r.status !== 429 || attempt === 2) break;
      await new Promise((resolve) => setTimeout(resolve, 600 * 2 ** attempt));
    }
    const data = await r.json().catch(() => ({}));
    usageClient?.track?.(HUNTER_SOURCE, { calls: 1, results: Array.isArray(data?.data?.emails) ? data.data.emails.length : data?.data?.email ? 1 : 0, ms: Date.now() - started });
    if (!r.ok) {
      const detail = String(data?.errors?.[0]?.details || data?.errors?.[0]?.id || '').slice(0, 160);
      const message = `Hunter HTTP ${r.status}${detail ? `: ${detail}` : ''}`;
      // Clave inválida, plan agotado o cuota: no seguir gastando llamadas en esta corrida.
      if ([401, 402, 403].includes(r.status) || /usage|quota|limit|plan|credit/i.test(detail)) disabled = message;
      throw Object.assign(new Error(message), { status: r.status, fatal: Boolean(disabled) });
    }
    return data?.data || {};
  }
  return {
    get calls() { return calls; },
    get disabled() { return disabled; },
    domainSearch: (domain, { limit = 10, department = '' } = {}) => get('domain-search', { domain, limit: String(clamp(limit, 1, 100, 10)), type: 'personal', ...(department ? { department } : {}) }),
    emailFinder: (domain, fullName) => get('email-finder', { domain, full_name: fullName }),
  };
}

const splitName = (e) => [e.first_name, e.last_name].filter(Boolean).join(' ').trim();
const verifiedStatus = (e) => String(e?.verification?.status || '').toLowerCase();
const provenanceOf = (e, domain) => {
  const score = Number(e.confidence ?? e.score) || 0;
  const status = verifiedStatus(e);
  const sources = Array.isArray(e.sources) ? e.sources.length : 0;
  return `Hunter.io · ${domain} · confidence ${score}%${status ? ` · ${status}` : ''}${sources ? ` · seen on ${sources} public page${sources === 1 ? '' : 's'}` : ' · pattern-based'}`;
};
/** Evidencia con URL real: la primera página pública donde Hunter vio el email; si no hay, la ficha de Hunter del dominio. */
function emailEvidence(e, domain, name) {
  const uri = (Array.isArray(e.sources) ? e.sources : []).map((s) => safeUrl(s?.uri)).find(Boolean);
  const quote = `${name || e.value || e.email}${e.position ? ` · ${e.position}` : ''} · ${e.value || e.email} (${provenanceOf(e, domain)})`;
  return evidence(`${HUNTER_SOURCE} · ${domain}`, uri || `https://hunter.io/search/${encodeURIComponent(domain)}`, quote, 'contact', undefined, Boolean(uri));
}

/**
 * Enriquecimiento de contactos con Hunter. No borra nada: solo añade emails y personas.
 *  · personas sin email → email-finder (si el score llega a HUNTER_MIN_SCORE)
 *  · organizaciones/oportunidades sin persona → domain-search: personas con cargo relevante
 *    (inversión, deuda, partners, patrocinio: candidatos nuevos; grants: contacto del programa)
 * @returns {{ leads, stats: { calls, emailsAdded, peopleAdded, domains, errors[] , skipped? } }}
 */
export async function enrichWithHunter(leads, brief, { env = process.env, fetcher = fetch, signal, usageClient = null, hunter = null, maxDomains, maxPeople, seen = { domains: new Set(), people: new Set() } } = {}) {
  const stats = { calls: 0, emailsAdded: 0, peopleAdded: 0, domains: 0, errors: [] };
  if (!hunter && !hunterConfigured(env)) return { leads, stats: { ...stats, skipped: 'HUNTER_API_KEY not set' } };
  const h = hunter || makeHunter({ env, fetcher, signal, usageClient });
  const minScore = clamp(env.HUNTER_MIN_SCORE, 0, 100, 70);
  const domainsCap = clamp(maxDomains ?? env.HUNTER_MAX_DOMAINS, 0, 60, 12);
  const perDomain = clamp(maxPeople ?? env.HUNTER_PEOPLE_PER_DOMAIN, 1, 10, 3);
  const own = [brief.company, brief.organization, brief.venture].map(norm).filter(Boolean);
  const excluded = String(brief.exclusions || '').split(/[,;\n]/).map(norm).filter(Boolean);
  const out = leads.map((lead) => ({ ...lead }));
  const known = new Set(out.filter((l) => l.person).map((l) => `${norm(l.person)}|${norm(l.org)}`));
  const knownEmails = new Set(out.filter((l) => l.contact?.type === 'email').map((l) => String(l.contact.value).toLowerCase()));
  const order = (l) => (l.bucket === 'top' ? 0 : l.bucket === 'radar' ? 1 : l.bucket === 'discarded' ? 3 : 2) * 1000 - (Number(l.score) || 0);
  const queue = out.filter((l) => l.bucket !== 'discarded' && !l.demo).sort((a, b) => order(a) - order(b));
  const stop = (error) => { stats.errors.push(error.message); return Boolean(error.fatal || error.budget || signal?.aborted); };

  // 1 · Personas sin email: email-finder.
  for (const lead of queue) {
    if (!lead.person || lead.contact?.type === 'email' || lead.person.trim().split(/\s+/).length < 2) continue;
    const domain = leadDomain(lead);
    const tried = `${norm(lead.person)}@${domain}`;
    if (!domain || seen.people.has(tried)) continue;
    seen.people.add(tried);
    try {
      const found = await h.emailFinder(domain, lead.person);
      if (found?.email && Number(found.score) >= minScore && !knownEmails.has(found.email.toLowerCase()) && verifiedStatus(found) !== 'invalid') {
        knownEmails.add(found.email.toLowerCase());
        lead.contact = { type: 'email', value: found.email, provenance: provenanceOf(found, domain) };
        lead.evidence = [...(lead.evidence || []), emailEvidence(found, domain, lead.person)];
        lead.missing = (lead.missing || []).filter((m) => m !== 'No public email');
        lead.hunter = { domain, score: Number(found.score) || 0, status: verifiedStatus(found) || null };
        stats.emailsAdded++;
      }
    } catch (error) { if (stop(error)) break; }
  }

  // 2 · Organizaciones y oportunidades: domain-search → personas con cargo relevante.
  const seenDomains = seen.domains;
  let domainsThisCall = 0;
  for (const lead of queue) {
    if (h.disabled || domainsThisCall >= domainsCap) break;
    if (lead.person) continue;
    const domain = leadDomain(lead);
    const hay = norm(`${lead.org} ${domain}`);
    if (!domain || seenDomains.has(domain) || own.some((x) => hay.includes(x)) || excluded.some((x) => hay.includes(x))) continue;
    seenDomains.add(domain); domainsThisCall++;
    let data;
    try { data = await h.domainSearch(domain, { limit: 10 }); } catch (error) { if (stop(error)) break; continue; }
    stats.domains++;
    const roleRe = roleFor(lead.fundingType);
    const emails = (Array.isArray(data?.emails) ? data.emails : [])
      .filter((e) => e?.value && Number(e.confidence) >= minScore && verifiedStatus(e) !== 'invalid' && !knownEmails.has(String(e.value).toLowerCase()))
      .filter((e) => splitName(e) && (roleRe.test(String(e.position || '')) || roleRe.test(String(e.department || '')) || SENIOR.has(String(e.seniority || ''))))
      .sort((a, b) => (roleRe.test(String(b.position || '')) - roleRe.test(String(a.position || ''))) || (Number(b.confidence) - Number(a.confidence)))
      .slice(0, perDomain);
    const orgName = String(lead.org || data?.organization || domain).trim();
    if (lead.kind === 'opportunity') {
      // Grants y convocatorias: la persona del programa queda como contacto de la oportunidad (no como candidato aparte).
      const best = emails[0];
      if (best && lead.contact?.type !== 'email') {
        knownEmails.add(String(best.value).toLowerCase());
        lead.contacts = [...(lead.contacts || []), ...emails.map((e) => ({ name: splitName(e), role: e.position || null, email: e.value, provenance: provenanceOf(e, domain) }))];
        lead.contact = { type: 'email', value: best.value, provenance: `${splitName(best)}${best.position ? `, ${best.position}` : ''} · ${provenanceOf(best, domain)}` };
        lead.evidence = [...(lead.evidence || []), emailEvidence(best, domain, splitName(best))];
        stats.emailsAdded++;
      }
      continue;
    }
    for (const e of emails) {
      const name = splitName(e);
      const key = `${norm(name)}|${norm(orgName)}`;
      if (known.has(key)) continue;
      known.add(key); knownEmails.add(String(e.value).toLowerCase());
      out.push(candidate({
        externalId: `hunter:${domain}:${norm(name)}`,
        person: name,
        role: e.position || null,
        org: orgName,
        title: e.position ? `${e.position} at ${orgName}` : `Works at ${orgName}`,
        kind: 'person',
        fundingType: lead.fundingType,
        status: 'unknown',
        contact: { type: 'email', value: e.value, provenance: provenanceOf(e, domain) },
        ...(safeUrl(e.linkedin) ? { linkedin: safeUrl(e.linkedin) } : {}),
        evidence: [...(lead.evidence || []).filter((x) => x.verified).slice(0, 2), emailEvidence(e, domain, name)],
        risks: ['Person and email from Hunter.io: confirm the role is current before reaching out'],
        missing: [...(e.position ? [] : ['Role not confirmed']), 'Funding authority not confirmed'],
        searchText: `${e.position || ''} ${e.department || ''} ${orgName} ${lead.searchText || ''}`.slice(0, 4000),
        parentKey: lead.key || lead.externalId || `org:${domain}`,
        followUp: { from: orgName, question: `Who decides at ${orgName}?` },
        foundBy: [{ provider: HUNTER_SOURCE, term: domain, objective: lead.fundingType, query: `domain-search ${domain}` }],
      }));
      stats.peopleAdded++;
    }
  }
  stats.calls = h.calls;
  if (h.disabled && !stats.errors.includes(h.disabled)) stats.errors.push(h.disabled);
  return { leads: out, stats };
}
