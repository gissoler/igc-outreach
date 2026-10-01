import { GENERIC, grantMatch } from './grantMatch.mjs';
import { applicantProfile, checkApplicant } from './applicant.mjs';
import { createHash } from 'node:crypto';

export const norm = (s = '') =>
  String(s)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
export const id = (...parts) =>
  createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 20);
export const safeUrl = (value) => {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password
      ? u.href
      : null;
  } catch {
    return null;
  }
};
export const fundingTypes = ['partnering', 'grant', 'investment', 'debt', 'sponsorship'];
export const RELATIONS = ['same', 'subsidiary', 'spinout', 'sponsored', 'portfolio', 'client', 'other'];
export function validateBrief(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('The form must be an object.');
  const brief = {};
  for (const key of [
    'name',
    'role',
    'company',
    'product',
    'description',
    'industry',
    'stage',
    'geography',
  ]) {
    if (
      typeof input[key] !== 'string' ||
      !input[key].trim() ||
      input[key].length > (key === 'description' ? 3000 : 200)
    )
      throw new Error(`Fill in ${key} (valid length).`);
    brief[key] = input[key].trim();
  }
  for (const key of ['criteria', 'exclusions', 'event']) {
    if (
      input[key] != null &&
      (typeof input[key] !== 'string' || input[key].length > 1000)
    )
      throw new Error(`Field ${key} is invalid.`);
    brief[key] = input[key]?.trim() || '';
  }
  if (
    !Array.isArray(input.fundingTypes) ||
    !input.fundingTypes.length ||
    input.fundingTypes.some((t) => !fundingTypes.includes(t))
  )
    throw new Error('Pick at least one valid funding type.');
  brief.fundingTypes = [...new Set(input.fundingTypes)];
  brief.mode = input.mode === 'financial' ? 'financial' : 'strategic';
  if (!['live', 'demo'].includes(input.dataMode))
    throw new Error('Choose live or demo mode.');
  brief.dataMode = input.dataMode;
  brief.amount =
    input.amount === '' || input.amount == null ? null : Number(input.amount);
  if (
    brief.amount !== null &&
    (!Number.isFinite(brief.amount) || brief.amount <= 0 || brief.amount > 1e12)
  )
    throw new Error('Amount must be positive and under one trillion USD.');
  brief.minDays = Number(input.minDays ?? 30);
  if (
    !Number.isInteger(brief.minDays) ||
    brief.minDays < 0 ||
    brief.minDays > 730
  )
    throw new Error('Lead time must be 0–730 days.');
  brief.useTeam = input.useTeam === true;
  brief.useApify = input.useApify !== false;
  if (
    ![
      'idea',
      'prototype',
      'preclinical',
      'clinical_phase_1',
      'clinical_phase_2',
      'clinical_phase_3',
      'marketed',
      'other',
    ].includes(brief.stage)
  )
    throw new Error('Invalid stage.');
  brief.excludeCompetitors = input.excludeCompetitors === true;
  brief.strictTypes = input.strictTypes === true;
  // Contexto opcional del perfil confirmado: quién busca (organization), para qué empresa
  // (venture) y todo lo que el prerregistro capturó (criterios, restricciones, ronda...).
  for (const [key, max] of [['organization', 200], ['venture', 200], ['oneLiner', 300], ['round', 40], ['constraints', 1000], ['useOfFunds', 500], ['timeline', 100], ['website', 300]]) {
    if (input[key] != null && (typeof input[key] !== 'string' || input[key].length > max))
      throw new Error(`Field ${key} is invalid.`);
    brief[key] = input[key]?.trim() || '';
  }
  brief.relation = RELATIONS.includes(input.relation) ? input.relation : brief.organization && brief.venture && norm(brief.organization) !== norm(brief.venture) ? 'other' : 'same';
  return brief;
}
export const isIGC = (b) => /\bigc\b/.test(norm(`${b.company} ${b.organization || ''}`));
/** Empresa que recibe la financiación (Mentiva) aunque quien busca sea otra organización (IGC). */
export const ventureOf = (b) => b.venture || b.company;
export function makePlan(b) {
  const text = norm(`${b.industry} ${b.description} ${b.product}`);
  const alzheimer = /alzheimer|dementia|demencia|adrd/.test(text);
  const data = /data|datos|harmon|armon|mint|artificial/.test(text);
  const topic = alzheimer ? 'Alzheimer' : b.industry;
  const query = alzheimer
    ? data
      ? 'Alzheimer data'
      : 'Alzheimer agitation'
    : `${b.industry} ${b.product}`;
  const grantsOnly = b.fundingTypes.length === 1 && b.fundingTypes[0] === 'grant';
  return {
    topic,
    query,
    scientificQuery: alzheimer
      ? data
        ? 'Alzheimer artificial intelligence'
        : 'agitation'
      : b.industry,
    summary: `${ventureOf(b) !== b.product ? `${ventureOf(b)} · ` : ''}${b.product}${b.organization && norm(b.organization) !== norm(ventureOf(b)) ? ` (backed by ${b.organization})` : ''}: ${b.fundingTypes.join(', ')} · ${b.stage}${b.round ? ` · ${b.round}` : ''} · ${b.geography}${b.amount ? ` · USD ${b.amount}` : ''}${b.constraints ? ` · avoid: ${b.constraints.slice(0, 120)}` : ''}`,
    items: [
      ...(b.fundingTypes.includes('partnering')
        ? [
            {
              provider: 'OpenAlex',
              query:
                isIGC(b) && b.useTeam
                  ? `Co-authors of Jeffrey L. Cummings: ${query}`
                  : query,
            },
            { provider: 'ClinicalTrials.gov', query: topic },
          ]
        : []),
      ...(b.fundingTypes.some((t) =>
        ['grant', 'investment', 'debt'].includes(t),
      )
        ? [
            { provider: 'Grants.gov', query },
            { provider: 'NIH RePORTER', query },
          ]
        : []),
      ...(grantsOnly && b.useApify
        ? [{ provider: 'Open web opportunities', query: 'Challenges, prizes, accelerators and startup calls by topic and stage' }]
        : []),
      ...(alzheimer
        ? [{ provider: 'Official radar', query: 'ADDF · a2 Collective · CDMRP' }]
        : []),
      ...(!grantsOnly && b.useApify
        ? [{ provider: 'Firecrawl + ScrapeGraph', query: 'Fund and organization teams on public pages' }]
        : []),
      ...(!grantsOnly ? [{
        provider: 'Exa (semantic search)',
        query: `Full profile by goal (${b.fundingTypes.join(', ')}), with criteria and constraints`,
      }] : []),
      ...(b.fundingTypes.includes('investment')
        ? [{ provider: 'Funding rounds', query: `${b.industry} ${b.round || 'early-stage'} · Exa news o Serper` }]
        : []),
      ...(!grantsOnly ? [{
        provider: 'Serper (optional)',
        query:
          `${query} ${b.fundingTypes.join(' ')} ${b.geography} ${b.criteria}`.slice(
            0,
            500,
          ),
      }] : []),
    ],
    alzheimer,
  };
}
export function evidence(
  source,
  url,
  quote,
  field,
  now = new Date().toISOString(),
  verified = true,
) {
  const clean = safeUrl(url);
  if (!clean || !quote)
    throw new Error('Evidence without a safe URL or content.');
  return {
    id: id(source, clean, field, quote),
    source,
    url: clean,
    quote: String(quote).slice(0, 1200),
    field,
    retrievedAt: now,
    verified,
  };
}
export function candidate(data) {
  return {
    person: null,
    role: null,
    org: '',
    title: '',
    kind: 'research',
    fundingType: 'partnering',
    status: 'unknown',
    deadline: null,
    amount: null,
    contact: null,
    evidence: [],
    paths: [],
    risks: [],
    missing: [],
    searchText: '',
    demo: false,
    foundBy: [],
    facts: {},
    sufficiency: null,
    ...data,
  };
}
/** Número de convocatoria (NSF 26-512, PAR-25-297, RFA-AG-27-005…): la misma llamada llega del registro oficial y del motor web con claves distintas. */
const CALL_NUMBER = /\b(?:(NSF)\s?(\d{2}-\d{3,4})|((?:PAR|RFA|PA|NOT|OTA|HRSA|DE-FOA|PD)-[A-Z]{0,4}-?\d{2}-\d{2,4}))\b/i;
export const callNumber = (l) => {
  const m = CALL_NUMBER.exec(`${l.externalId || ''} ${l.title || ''}`);
  return m ? (m[1] ? `NSF-${m[2]}` : m[3].toUpperCase()) : null;
};
export function dedupe(leads) {
  const map = new Map();
  for (const l of leads) {
    const key =
      l.person && !['opportunity', 'radar'].includes(l.kind)
        ? l.personId ? `person-id:${l.personId}` : `person:${norm(l.person)}:${norm(l.org)}`
        : `opportunity:${callNumber(l) || l.externalId || `${norm(l.org)}:${norm(l.title)}`}`;
    if (!map.has(key)) map.set(key, { ...l, key, id: id(key) });
    else {
      const current = map.get(key);
      current.risks = [...new Set([...current.risks, ...l.risks, ...(norm(current.org) !== norm(l.org) ? [`Other past affiliation in the evidence: ${l.org}`] : [])])];
      current.evidence = [
        ...new Map(
          [...current.evidence, ...l.evidence].map((e) => [e.id, e]),
        ).values(),
      ];
      current.paths = [...new Map([...current.paths, ...l.paths].map(p=>[p.hops.at(-1)?.url || JSON.stringify(p.nodes),p])).values()].slice(0, 3);
      current.foundBy = [...new Map([...(current.foundBy || []), ...(l.foundBy || [])].map((x) => [`${x.provider}|${x.objective || ''}|${x.term || ''}|${x.query || ''}`, x])).values()];
      current.facts = { ...current.facts, ...l.facts };
      current.sufficiency ||= l.sufficiency || null;
      if (!current.contact && l.contact) current.contact = l.contact;
    }
  }
  return [...map.values()].map(l => {
    const works = new Set(l.evidence.filter(e=>e.field==='work').map(e=>e.url)).size;
    if (l.personId && works && l.paths.length) {
      const s = Math.min(.9, .3 + .1 * works);
      return {...l, paths:l.paths.map(p=>p.nodes.length===3 ? {...p,strength:Math.round(.65*s*1000)/1000,hops:p.hops.map((h,i)=>i===1?{...h,strength:s,relation:`Co-authored ${works} papers; past affiliation`}:h)}:p)};
    }
    return l;
  });
}
export function evaluate(
  leads,
  brief,
  rejected = new Set(),
  today = new Date(),
  terms = [],
) {
  const exclusions = brief.exclusions
    .split(/[,;\n]/)
    .map(norm)
    .filter(Boolean);
  const tokenSources = [
    { label: brief.industry, value: brief.industry },
    ...terms.map((term) => ({ label: typeof term === 'string' ? term : term.term, value: typeof term === 'string' ? term : term.term })),
  ].filter((x) => x.value);
  // Palabras genéricas («research», «data», «infrastructure»…) nunca cuentan como encaje temático.
  const specific = (value) => norm(value).split(' ').filter((t) => t.length > 2 && !GENERIC.has(t) && !GENERIC.has(t.replace(/s$/, '')));
  const tokens = [...new Set(tokenSources.flatMap((x) => specific(x.value)))];
  const profile = applicantProfile(brief);
  const ranked = dedupe(leads).map((l) => {
    const verified = l.evidence.filter((e) => e.verified);
    const hay = norm(
      `${l.title} ${l.searchText} ${l.evidence.map((e) => e.quote).join(' ')}`,
    );
    const hits = tokens.filter((t) => hay.includes(t));
    const matchedTerms = tokenSources.filter((source) => specific(source.value).some((t) => hay.includes(t))).map((source) => source.label);
    const grantOpp = l.fundingType === 'grant' && l.kind === 'opportunity';
    // Convocatorias: la rúbrica sobre campos oficiales (título, alcance, ALN) decide si hay encaje.
    const match = grantOpp ? grantMatch(l, brief, terms) : null;
    let fit = Math.min(
      1,
      hits.length / Math.max(2, Math.min(6, tokens.length)),
    );
    if (match?.verdict === 'mismatch') fit = 0;
    else if (match?.verdict === 'weak') fit = Math.min(fit, 0.35);
    const type = brief.fundingTypes.includes(l.fundingType) ? 1 : 0.15;
    const deadline = l.deadline ? Date.parse(l.deadline + 'T23:59:59Z') : NaN;
    const days = Number.isFinite(deadline)
      ? (deadline - today.getTime()) / 86400000
      : null;
    if (days !== null && days < 0) l.status = 'closed';
    const timing =
      l.status === 'open'
        ? days === null
          ? 0.4
          : days >= brief.minDays
            ? 1
            : 0.2
        : l.status === 'active'
          ? 0.6
          : l.status === 'closed'
            ? 0
            : 0.1;
    const path = Math.max(0, ...l.paths.map((p) => p.strength));
    const contact = l.contact?.type === 'email' ? 1 : l.contact ? 0.4 : 0;
    const amountFit =
      !brief.amount || !l.amount ? 0.3 : l.amount >= brief.amount ? 1 : 0;
    const grantOpportunity = l.fundingType === 'grant' && l.kind === 'opportunity';
    const weights =
      grantOpportunity
        ? { fit: 35, type: 20, timing: 25, path: 0, contact: 0, amountFit: 20 }
        : brief.mode === 'financial'
        ? { fit: 25, type: 25, timing: 25, path: 5, contact: 10, amountFit: 10 }
        : {
            fit: 35,
            type: 20,
            timing: 10,
            path: 30,
            contact: 5,
            amountFit: 0,
          };
    const values = { fit, type, timing, path, contact, amountFit };
    const breakdown = Object.entries(weights).map(([factor, weight]) => ({
      factor,
      points: Math.round(values[factor] * weight * 10) / 10,
      max: weight,
    }));
    if (brief.mode === 'financial' && /Principal investigator/i.test(l.role || ''))
      breakdown.push({factor: 'mandate', points: -10, max: 0});
    const penalty = verified.length ? 1 : 0.5;
    const score = Math.round(
      breakdown.reduce((n, x) => n + x.points, 0) * penalty,
    );
    let discard = '';
    if (!verified.length && !l.demo)
      discard = 'No confirmed evidence; search lead.';
    if (exclusions.some((x) => norm(l.org).includes(x)))
      discard = 'Excluded by your criteria.';
    if (rejected.has(l.key))
      discard = 'Rejected before for this user, product and mode.';
    if (brief.strictTypes && type < 1)
      discard = 'Different funding type than requested.';
    if (brief.excludeCompetitors && l.risks.includes('competitor_conflict'))
      discard = 'Excluded competitor.';
    if (l.facts?.funder_type === 'not_funder')
      discard = 'Verified page indicates this organization is not a funder.';
    if (l.fundingType === 'grant' && l.kind !== 'opportunity')
      discard = 'Historical grant intelligence; not an open funding opportunity.';
    if (match?.verdict === 'mismatch') discard = match.summary;
    // Regla (30/09): sin vigencia y elegibilidad verificadas, una convocatoria no entra en la lista principal.
    const gate = grantOpp && !l.demo ? grantGate(l, days, profile) : null;
    if (gate?.tier === 'drop' && !discard) discard = gate.reason;
    const watch =
      gate?.tier === 'verify' ||
      match?.verdict === 'weak' ||
      l.kind === 'radar' ||
      l.status === 'closed' ||
      l.status === 'forecasted' ||
      (days !== null && days < brief.minDays);
    const missing = [
      ...new Set([
        ...l.missing,
        ...(!grantOpportunity && !l.person ? ['No named decision-maker'] : []),
        ...(!grantOpportunity && !l.role ? ['Current role not confirmed'] : []),
        ...(!grantOpportunity && (!l.contact || l.contact.type !== 'email')
          ? ['No public email']
          : []),
        ...(match?.verdict === 'weak' ? [match.summary] : []),
        'Geographic eligibility and stage to confirm',
        ...(brief.amount && !l.amount
          ? ['Available amount not confirmed']
          : []),
      ]),
    ];
    const why = grantOpportunity ? [
      match.summary,
      `Specific ${l.status} grant opportunity${l.externalId ? ` (${l.externalId})` : ''}; eligibility must be resolved against the notice.`,
      l.deadline ? `Published deadline: ${l.deadline}.` : 'Deadline is not confirmed.',
      ...(brief.criteria ? [`Policy or program priorities to validate: ${brief.criteria}`] : []),
      ...(brief.amount ? [l.amount ? `Published ceiling USD ${l.amount}; stated target USD ${brief.amount}.` : 'No published amount to compare with your target.'] : []),
    ] : [
      hits.length
        ? `Matches ${matchedTerms.slice(0, 3).join(', ') || hits.slice(0, 4).join(', ')} in the evidence.`
        : 'Limited topic match: review before contacting.',
      type === 1
        ? `Category ${l.fundingType} requested; ${l.kind === 'person' || l.kind === 'research' ? 'interest in funding or partnering not confirmed yet' : 'validate eligibility'}.`
        : 'Adjacent type; penalized in ranking.',
      l.paths.length
        ? 'Professional relationship evidenced; willingness to introduce unknown.'
        : 'No verified intro path.',
      `Target geography: ${brief.geography}. Stage fit ${brief.stage}: to validate.`,
      ...(brief.criteria
        ? [`Additional criteria to validate: ${brief.criteria}`]
        : []),
      ...(brief.constraints
        ? [`Declared constraints to review: ${brief.constraints}`]
        : []),
      ...(brief.amount
        ? [
            l.amount
              ? `Published ceiling USD ${l.amount}; stated target USD ${brief.amount}.`
              : 'No published amount to compare with your target.',
          ]
        : []),
    ];
    return {
      ...l,
      fit,
      matchedTerms,
      ...(match ? { grantMatch: match } : {}),
      score,
      breakdown,
      missing,
      why,
      confidence:
        l.demo || !verified.length
          ? 'baja'
          : l.contact?.type === 'email' && l.status === 'open' && l.role
            ? 'alta'
            : 'media',
      bucket: discard ? 'discarded' : watch ? 'radar' : 'top',
      discard,
      daysToDeadline: days === null ? null : Math.floor(days),
      ...(gate ? { gate } : {}),
    };
  });
  // Una persona o contacto sacado de una convocatoria (Hunter, seguimiento) no puede estar por encima de ella:
  // si la convocatoria no está en la lista principal (cerrada, sin fecha, no elegible), el contacto baja a radar.
  const byKey = new Map(ranked.map((l) => [l.key, l]));
  for (const l of ranked) {
    const parent = l.parentKey && byKey.get(l.parentKey);
    if (parent && l.bucket === 'top' && parent.bucket !== 'top') {
      l.bucket = 'radar';
      l.missing = [...new Set([...(l.missing || []), `Linked opportunity "${String(parent.title || parent.org).slice(0, 80)}" is ${parent.bucket === 'discarded' ? `discarded (${String(parent.discard || '').slice(0, 80)})` : 'not verified as open and eligible'}`])];
    }
  }
  const ranks = { top: 0, radar: 0, discarded: 0 };
  return ranked
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .map((l) => ({ ...l, rank: ++ranks[l.bucket] }));
}
const dropText = (ver) => {
  const r = ver.drop || ver.reasons?.[0] || '';
  if (r === 'closed') return `Closed on ${ver.today}: ${ver.dates?.reason || 'the deadline has passed'}.`;
  if (r.startsWith('not_a_call')) return `Not a call: ${ver.pageType?.reason || r}.`;
  if (r === 'not_eligible') return `Not eligible: ${ver.eligibility?.reason || 'the page excludes this applicant'}.`;
  if (r === 'aggregator' || r === 'social_host') return 'Aggregator or social network, not the official source.';
  return `Discarded by verification: ${r}.`;
};
/** Puerta de la lista principal para una convocatoria: main | verify | drop, con motivo. */
export function grantGate(l, days, profile = applicantProfile({})) {
  const ver = l.verification || l.codeCheck;
  if (ver?.tier) return ver.tier === 'drop' ? { tier: 'drop', reason: dropText(ver), source: l.verification ? 'read' : 'code' } : { tier: ver.tier, reason: ver.tier === 'main' ? 'Open today and eligible, both verified on the page' : (ver.blockers?.[0] || 'To verify'), source: l.verification ? 'read' : 'code' };
  // Registros oficiales (Grants.gov, radar): plazo del registro + elegibilidad del aviso oficial.
  const vigent = l.status === 'open' && days !== null && days >= 0;
  const eligText = (l.evidence || []).filter((e) => e.field === 'eligibility').map((e) => e.quote).join('. ');
  const byEnricher = l.eligibility?.verdict === '✔' ? 'yes' : l.eligibility?.verdict === '✖' ? 'no' : null;
  const code = eligText ? checkApplicant('', profile, { modelQuote: eligText }) : null;
  const elig = byEnricher || code?.decision || 'unclear';
  if (elig === 'no' && !byEnricher) return { tier: 'drop', reason: `Not eligible: ${code.reason}.`, source: 'official' };
  if (!vigent) return { tier: 'verify', reason: l.status === 'forecasted' ? 'Forecast: not open yet' : l.status === 'closed' ? 'Closed' : 'Deadline not verified', source: 'official' };
  // Excepción anotada: en un registro oficial (Grants.gov) sin tipos de solicitante, la elegibilidad la resuelve el paso de
  // elegibilidad y el plan de la convocatoria (✖ → descartada). Queda en la lista con la elegibilidad como pendiente visible.
  if (elig !== 'yes') return { tier: 'main', pending: 'eligibility', reason: `Open per the official registry; eligibility pending${code?.reason ? ` (${code.reason})` : ''}`, source: 'official' };
  return { tier: 'main', reason: 'Open (official registry deadline) and eligible per the official notice', source: 'official' };
}
export function buildDraft(lead, brief, senderFacts = []) {
  if (lead.fundingType === 'grant' || lead.kind === 'opportunity') {
    const number = lead.externalId || 'program number to confirm';
    // Rechazada por la rúbrica: no se prepara propuesta ni borrador (caso NSF 23-525, 30/09).
    if (lead.grantMatch?.verdict === 'mismatch') {
      const body = `Official call: ${number} — ${lead.title}\n\nDo not pursue: ${lead.grantMatch.summary.replace(/^Off-topic: /, '')}\nNo application draft is generated for an off-topic call.`;
      return { subject: `Not a match · ${number}`, body, sections: [], connector: null, status: 'rejected', warning: 'Rejected by the matching rubric. Do not prepare a proposal for this call.', wordCount: body.split(/\s+/).length };
    }
    // Una convocatoria se aplica en el portal; no es un correo. Solo se sugiere una pregunta si hay contacto de programa publicado.
    const plan = lead.grantPlan || {};
    const apply = plan.apply;
    const question = plan.contactQuestion;
    const steps = (apply?.steps || []).filter((x) => !x.skip).map((x, i) => `${i + 1}. ${x.label}${x.days ? ` (~${x.days} days)` : ''}`);
    const body = [
      `${lead.demo ? '[DEMO — DO NOT USE]\n' : ''}Official call: ${number} — ${lead.title}`,
      `Where to apply: ${apply?.portal ? `${apply.portal.name} (${apply.portal.url})` : 'the official program page'}${apply?.officialUrl ? `\nOfficial notice: ${apply.officialUrl}` : ''}`,
      `Deadline: ${lead.deadline || 'not published'}${apply?.message ? ` — ${apply.message}` : ''}`,
      steps.length ? `Steps:\n${steps.join('\n')}` : null,
      question ? `Optional question for the program contact:\n${question}` : apply?.contactAdvice || null,
    ].filter(Boolean).join('\n\n');
    return { subject: `How to apply · ${number}`, body, sections: [], connector: null, status: 'grant work item', warning: 'Grant applications go through the official portal. This is a work item, not an email.', wordCount: body.split(/\s+/).length };
  }
  const recipientFact = lead.evidence.find(
    (e) => e.verified && ['work', 'title', 'opportunity'].includes(e.field),
  );
  const label = lead.demo ? '[DEMO — DO NOT SEND]\n' : '';
  const common = recipientFact
    ? `Your work on "${recipientFact.quote.slice(0, 160)}" prompted this note.`
    : 'I\'d like to confirm whether your team reviews collaboration proposals.';
  const identity = senderFacts.find(e => e.field === 'sender');
  const sender = identity
    ? identity.statement || identity.quote
    : '[Your name and role; confirm before sending]';
  const product = senderFacts.find((e) => e.field === 'product');
  // Free-form product descriptions, amounts, criteria and event dates never enter drafts.
  const context = `${sender}.${product ? ` ${product.statement || product.quote}.` : ' I\'d like to share a public description of our project.'}`;
  const ask =
    lead.status === 'closed' || lead.kind === 'radar'
      ? 'Could you tell me whether there will be a next cycle and the right channel to ask about eligibility?'
      : 'Would you have 20 minutes to explore fit and point me to the right person?';
  const sections = [
    {
      label: 'Common ground / reason',
      text: common,
      evidenceIds: recipientFact ? [recipientFact.id] : [],
    },
    {
      label: 'Public context',
      text: context,
      evidenceIds: senderFacts.map((e) => e.id),
    },
    { label: 'Ask', text: ask, evidenceIds: [] },
  ];
  // Feedback 28/09: 4–5 lines max, two paragraphs — why you / who we are + the ask.
  const body = label + `${common}\n\n${context} ${ask}`;
  const path = lead.paths[0];
  const connector =
    path && path.nodes.length > 2
      ? `${label}Hi ${path.nodes[1]}, public evidence shows you worked with ${path.nodes.at(-1)}. Would you be comfortable asking if they'd take a short intro?

To forward, only with their permission: we'd like to explore a collaboration and can share public project information in a 20-minute call.`
      : null;
  return {
    subject: 'Collaboration and fit',
    body,
    sections,
    connector,
    status: 'template with public facts',
    warning:
      'No confirmed personal relationship. Human review required; no material non-public info. The system never sends messages.',
    wordCount: body.split(/\s+/).length,
  };
}
export function csvFor(job) {
  const escape = (v) => {
    const value = String(v ?? '');
    return `"${(/^[=+\-@\t\r]/.test(value) ? "'" : '') + value.replaceAll('"', '""')}"`;
  };
  const columns = [
    'rank',
    'score',
    'mode',
    'bucket',
    'person',
    'role',
    'organization',
    'opportunity',
    'funding_type',
    'status',
    'deadline',
    'amount_usd',
    'confidence',
    'contact',
    'why_inference',
    'missing',
    'risks',
    'sources',
    'draft',
    'decision',
    'reason',
  ];
  const rows = job.leads.map((l) => [
    l.rank,
    l.score,
    job.mode,
    l.bucket,
    l.person,
    l.role,
    l.org,
    l.title,
    l.fundingType,
    l.status,
    l.deadline,
    l.amount,
    l.confidence,
    l.contact?.value,
    l.why.join(' | '),
    l.missing.join(' | '),
    l.risks.join(' | '),
    l.evidence.map((e) => e.url).join(' | '),
    l.draft.body,
    l.feedback?.decision,
    l.feedback?.reason,
  ]);
  return (
    '\uFEFF' +
    [columns, ...rows].map((row) => row.map(escape).join(',')).join('\r\n')
  );
}
