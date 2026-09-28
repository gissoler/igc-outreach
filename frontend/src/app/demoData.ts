/* ─────────────────────────────────────────────────────────────────────────────
   DEMO EJECUTIVA — personas, organizaciones, URLs y evidencias FICTICIAS.
   Sirve para contar la historia completa (warm paths de 1–3 saltos, Apify y Jev
   ejecutados, fuentes que fallan) sin consultar servicios ni gastar crédito.
   Se carga solo desde la ruta #/demo, nunca se mezcla con datos de una cuenta,
   y cada pantalla que la usa muestra la franja «DATOS DE DEMOSTRACIÓN».
   El score de cada candidato se calcula con la MISMA fórmula del motor real
   (research/server/research/core.mjs → evaluate) para que sea auditable.
   ───────────────────────────────────────────────────────────────────────────── */
import type { NetworkGraphData } from '../accountApi';
import type { Brief, Evidence, Job, Lead } from '../researchApi';
import type { LiveRunEvent } from '../liveRunModel';
import { WEIGHTS } from './model';

const T0 = Date.parse('2026-09-24T14:02:00Z');
const at = (sec: number) => new Date(T0 + sec * 1000).toISOString();
const daysAgo = (d: number) => new Date(T0 - d * 86_400_000).toISOString();
let evSeq = 0;
const ev = (source: string, slug: string, quote: string, field: string, verified = true, age = 3): Evidence => ({
  id: `demo-ev-${++evSeq}`, source, url: `https://example.org/demo/${slug}`, quote, field, retrievedAt: daysAgo(age), verified,
});

export const DEMO_BRIEF: Brief = {
  name: 'Ana Ríos', role: 'CEO and co-founder', company: 'Lumen Neuro', organization: 'Lumen Neuro', venture: 'Lumen Neuro', relation: 'same',
  product: 'LN-2 · passive agitation monitor', description: 'Non-invasive sensor and model that predicts agitation episodes in dementia care homes. Pilot with 3 homes and 140 patients.',
  oneLiner: 'Predicts dementia agitation episodes 40 minutes early.', industry: 'neurology dementia agitation digital health sensors',
  stage: 'prototype', round: 'seed', geography: 'United States, Europe', fundingTypes: ['investment', 'partnering'], amount: 2_500_000,
  criteria: 'Funds focused on digital health or neuroscience; $250k–1M tickets', constraints: 'Avoid funds invested in direct competitors',
  exclusions: 'Calmwave Labs', event: '', minDays: 30, mode: 'strategic', dataMode: 'demo', useTeam: true, useApify: true, excludeCompetitors: true, strictTypes: false,
  useOfFunds: 'Multicenter clinical validation and CE marking', timeline: '6 months', website: 'https://example.org/lumen',
};

type Hop = { to: string; relation: string; strength: number; evidence: Evidence[] };
type Spec = {
  person: string | null; role: string | null; org: string; title: string; fundingType: string; kind?: string;
  status?: string; deadline?: string | null; days?: number | null; contact?: Lead['contact'];
  fit: number; timing: number; amountFit?: number; evidence: Evidence[]; paths?: { hypothesis: boolean; hops: Hop[] }[];
  risks?: string[]; missing?: string[]; bucket: 'top' | 'radar' | 'discarded'; discard?: string; confidence: 'alta' | 'media' | 'baja';
  jev?: Lead['jev']; hits: string[];
};

const APIFY = 'Apify · harvestapi/linkedin-profile-search';
const MUTUAL = 'Apify · data_link_miner/linkedin-shared-connections';
const WEB = 'Official site (demo)';
const EXA = 'Exa · semantic search';
const SCI = 'OpenAlex';
const SEC = 'SEC EDGAR · Form D';
const PUB = 'Public LinkedIn interaction';
const TEAM = 'Lumen Neuro · team';
const li = (slug: string) => ({ type: 'linkedin', value: `https://example.org/demo/linkedin/${slug}`, provenance: 'Public profile via harvestapi/linkedin-profile-search (demo)' });

const specs: Spec[] = [
  { person: 'Priya Nair', role: 'Partner', org: 'Cobalt Neuro Capital', title: 'Partner at Cobalt Neuro Capital · neurotech thesis', fundingType: 'investment', status: 'active', fit: 1, timing: 0.6, contact: li('priya-nair'), bucket: 'top', confidence: 'alta', hits: ['neurology', 'dementia', 'digital health', 'sensors'],
    evidence: [ev(APIFY, 'linkedin/priya-nair', 'Priya Nair · Partner · Cobalt Neuro Capital · Boston', 'profile', true, 4), ev(WEB, 'cobalt/thesis', 'We invest at seed and Series A in neurotech, dementia and digital health for older adults.', 'title', true, 6), ev(SEC, 'formd/cobalt-fund-ii', 'Cobalt Neuro Capital Fund II · Form D · US$85M · 2025', 'opportunity', true, 30)],
    paths: [{ hypothesis: false, hops: [{ to: 'Diego Ferrer', relation: 'First-degree connection confirmed from the authorized session', strength: 0.95, evidence: [ev('Apify · authenticated network', 'linkedin/diego-ferrer', 'Diego Ferrer · first-degree connection seen in the authorized session', 'connection', true, 2)] }, { to: 'Priya Nair', relation: 'Shared connection found by Apify', strength: 0.86, evidence: [ev(MUTUAL, 'mutual/diego-priya', 'Authenticated path: Ana Ríos → Diego Ferrer → Priya Nair', 'mutual_connection', true, 2)] }] }],
    jev: { action: 'prioritize', actionConfidence: 0.82, actionProbabilities: { prioritize: 0.82, investigate_more: 0.16, discard: 0.02 }, strategicFit: 3.6, fitConfidence: 0.78, evidenceSufficient: 0.84, model: 'jev-latest (demo)' },
    risks: ['Typical ticket not published'], missing: ['Available amount not confirmed'] },
  { person: 'Owen Hale', role: 'Principal', org: 'Northbeam Ventures', title: 'Principal at Northbeam Ventures · digital health', fundingType: 'investment', status: 'active', fit: 0.75, timing: 0.6, contact: li('owen-hale'), bucket: 'top', confidence: 'media', hits: ['digital health', 'sensors', 'dementia'],
    evidence: [ev(APIFY, 'linkedin/owen-hale', 'Owen Hale · Principal · Northbeam Ventures · London', 'profile', true, 5), ev(EXA, 'news/northbeam-seed', 'Northbeam leads the seed round of a remote-monitoring startup for care homes.', 'opportunity', true, 40)],
    paths: [{ hypothesis: false, hops: [{ to: 'Julia Moreau', relation: 'First-degree connection confirmed from the authorized session', strength: 0.95, evidence: [ev('Apify · authenticated network', 'linkedin/julia-moreau', 'Julia Moreau · first-degree connection seen in the authorized session', 'connection', true, 2)] }, { to: 'Owen Hale', relation: 'Shared connection found by Apify; Julia founded one of their portfolio companies', strength: 0.8, evidence: [ev(MUTUAL, 'mutual/julia-owen', 'Authenticated path: Ana Ríos → Julia Moreau → Owen Hale', 'mutual_connection', true, 2)] }] }],
    jev: { action: 'prioritize', actionConfidence: 0.71, actionProbabilities: { prioritize: 0.71, investigate_more: 0.26, discard: 0.03 }, strategicFit: 3.1, fitConfidence: 0.7, evidenceSufficient: 0.72, model: 'jev-latest (demo)' },
    missing: ['No public email', 'Ticket fit to confirm'] },
  { person: 'Hannah Weiss', role: 'VP Business Development, Neuroscience', org: 'Veridian Pharma', title: 'VP BD at Veridian Pharma · neuroscience partnerships', fundingType: 'partnering', status: 'active', fit: 0.75, timing: 0.6, contact: li('hannah-weiss'), bucket: 'top', confidence: 'media', hits: ['neurology', 'dementia', 'agitation'],
    evidence: [ev(APIFY, 'linkedin/hannah-weiss', 'Hannah Weiss · VP Business Development, Neuroscience · Veridian Pharma', 'profile', true, 6), ev(SCI, 'openalex/agitation-2024', 'Digital biomarkers of agitation in long-term care: a multicentre study (2024)', 'work', true, 90)],
    paths: [{ hypothesis: true, hops: [{ to: 'Elena Duarte', relation: 'Same company / public advisor; personal access not confirmed', strength: 0.65, evidence: [ev(TEAM, 'lumen/team', 'Advisor Elena Duarte · former BD director', 'team', true, 10)] }, { to: 'Hannah Weiss', relation: 'Co-authored 2 papers; past affiliation', strength: 0.7, evidence: [ev(SCI, 'openalex/duarte-weiss', 'Elena Duarte · Hannah Weiss · co-authors · 2022', 'work', true, 700)] }] }],
    jev: { action: 'prioritize', actionConfidence: 0.64, actionProbabilities: { prioritize: 0.64, investigate_more: 0.33, discard: 0.03 }, strategicFit: 3.2, fitConfidence: 0.66, evidenceSufficient: 0.69, model: 'jev-latest (demo)' },
    risks: ['Co-authorship isn\'t friendship or investment authority', '2022 co-authorship: confirm it\'s current'], missing: ['No public email'] },
  { person: 'Rafael Ortiz', role: 'Head of Search & Evaluation', org: 'Atlas Therapeutics', title: 'Search & Evaluation at Atlas Therapeutics', fundingType: 'partnering', status: 'active', fit: 0.5, timing: 0.6, contact: li('rafael-ortiz'), bucket: 'top', confidence: 'media', hits: ['neurology', 'dementia'],
    evidence: [ev(APIFY, 'linkedin/rafael-ortiz', 'Rafael Ortiz · Head of Search & Evaluation · Atlas Therapeutics', 'profile', true, 3), ev(WEB, 'atlas/partnering', 'Atlas seeks digital assets that complement its dementia pipeline.', 'title', true, 20)],
    paths: [{ hypothesis: true, hops: [{ to: 'Tomás Ibarra', relation: 'Same company / co-founder; access confirmed internally', strength: 0.65, evidence: [ev(TEAM, 'lumen/team-tomas', 'CSO Tomás Ibarra · co-founder', 'team', true, 10)] }, { to: 'Rafael Ortiz', relation: 'Co-authored 1 paper; past affiliation', strength: 0.6, evidence: [ev(SCI, 'openalex/ibarra-ortiz', 'Tomás Ibarra · Rafael Ortiz · co-authors · 2021', 'work', true, 1100)] }] }],
    jev: { action: 'prioritize', actionConfidence: 0.58, actionProbabilities: { prioritize: 0.58, investigate_more: 0.38, discard: 0.04 }, strategicFit: 2.8, fitConfidence: 0.6, evidenceSufficient: 0.66, model: 'jev-latest (demo)' },
    risks: ['2021 co-authorship: may not be current'], missing: ['No public email'] },
  { person: 'Marco Bellini', role: 'Investment Director', org: 'Meridian Health Fund', title: 'Investment Director at Meridian Health Fund', fundingType: 'investment', status: 'active', fit: 0.75, timing: 0.6, contact: li('marco-bellini'), bucket: 'top', confidence: 'media', hits: ['digital health', 'dementia', 'sensors'],
    evidence: [ev(APIFY, 'linkedin/marco-bellini', 'Marco Bellini · Investment Director · Meridian Health Fund · Milan', 'profile', true, 4), ev(EXA, 'meridian/portfolio', 'Meridian invested in 4 elder-care companies in 2025.', 'opportunity', true, 60)],
    paths: [{ hypothesis: true, hops: [{ to: 'Marco Bellini', relation: 'Documented public relationship: 2 of your comments, 3 reactions, 1 reply; not a first-degree connection', strength: 0.35, evidence: [ev(PUB, 'linkedin/activity-marco', 'Marco Bellini · 2 of your comments · 3 reactions · 1 reply · 2026-08-30', 'public_interaction', true, 25)] }] }],
    jev: { action: 'prioritize', actionConfidence: 0.61, actionProbabilities: { prioritize: 0.61, investigate_more: 0.35, discard: 0.04 }, strategicFit: 3.0, fitConfidence: 0.64, evidenceSufficient: 0.7, model: 'jev-latest (demo)' },
    missing: ['No public email'] },
  { person: 'Lucía Paredes', role: 'Program Officer', org: 'Aurora Foundation', title: 'Aurora Dementia Innovation Program 2026', fundingType: 'partnering', status: 'open', deadline: '2026-12-15', days: 82, fit: 0.75, timing: 1, contact: { type: 'email', value: 'programas@example.org', provenance: 'Email published in the call (demo)' }, bucket: 'top', confidence: 'alta', hits: ['dementia', 'agitation', 'digital health'],
    evidence: [ev(WEB, 'aurora/call-2026', 'Open until December 15, 2026 for dementia technology pilots. Contact: Lucía Paredes, Program Officer.', 'opportunity', true, 5)],
    jev: { action: 'prioritize', actionConfidence: 0.77, actionProbabilities: { prioritize: 0.77, investigate_more: 0.2, discard: 0.03 }, strategicFit: 3.3, fitConfidence: 0.74, evidenceSufficient: 0.81, model: 'jev-latest (demo)' },
    missing: ['For-profit eligibility to confirm'] },
  { person: 'Sofía Lang', role: 'Partner', org: 'Solstice Angels', title: 'Partner at Solstice Angels · health angel network', fundingType: 'investment', status: 'active', fit: 0.5, timing: 0.6, contact: li('sofia-lang'), bucket: 'radar', confidence: 'media', hits: ['digital health', 'sensors'],
    evidence: [ev(APIFY, 'linkedin/sofia-lang', 'Sofía Lang · Partner · Solstice Angels', 'profile', true, 7)],
    paths: [{ hypothesis: false, hops: [{ to: 'Diego Ferrer', relation: 'First-degree connection confirmed from the authorized session', strength: 0.95, evidence: [ev('Apify · authenticated network', 'linkedin/diego-ferrer-2', 'Diego Ferrer · first-degree connection seen in the authorized session', 'connection', true, 2)] }, { to: 'Sofía Lang', relation: 'Shared connection found by Apify', strength: 0.82, evidence: [ev(MUTUAL, 'mutual/diego-sofia', 'Authenticated path: Ana Ríos → Diego Ferrer → Sofía Lang', 'mutual_connection', true, 2)] }] }],
    jev: { action: 'investigate_more', actionConfidence: 0.52, actionProbabilities: { prioritize: 0.4, investigate_more: 0.52, discard: 0.08 }, strategicFit: 2.2, fitConfidence: 0.55, evidenceSufficient: 0.48, model: 'jev-latest (demo)' },
    missing: ['Jev found insufficient evidence; needs review.', 'Investment thesis not published'] },
  { person: 'Irene Castell', role: 'Principal', org: 'Harbor Bio Fund', title: 'Principal at Harbor Bio Fund', fundingType: 'investment', status: 'active', fit: 0.5, timing: 0.6, contact: li('irene-castell'), bucket: 'radar', confidence: 'media', hits: ['neurology', 'dementia'],
    evidence: [ev(APIFY, 'linkedin/irene-castell', 'Irene Castell · Principal · Harbor Bio Fund', 'profile', true, 9), ev(EXA, 'harbor/thesis', 'Harbor prioritizes therapeutics; digital devices selectively.', 'title', true, 120)],
    jev: { action: 'investigate_more', actionConfidence: 0.6, actionProbabilities: { prioritize: 0.3, investigate_more: 0.6, discard: 0.1 }, strategicFit: 2.0, fitConfidence: 0.58, evidenceSufficient: 0.55, model: 'jev-latest (demo)' },
    missing: ['Jev recommends more evidence before prioritizing.', 'No public email'] },
  { person: null, role: null, org: 'Keystone Neuro Grants', title: 'Keystone Pilot Awards · 2026 cycle', fundingType: 'partnering', kind: 'opportunity', status: 'closed', deadline: '2026-08-31', days: -24, fit: 0.75, timing: 0, bucket: 'radar', confidence: 'media', hits: ['dementia', 'agitation', 'digital health'],
    evidence: [ev(WEB, 'keystone/2026', 'Keystone Pilot Awards 2026 · closes August 31, 2026 · up to $250,000.', 'opportunity', true, 15)], missing: ['No named decision-maker'] },
  { person: null, role: null, org: 'Brightwater Foundation', title: 'Brightwater Aging Tech · 2027 cycle (forecast)', fundingType: 'partnering', kind: 'radar', status: 'forecasted', fit: 0.5, timing: 0.1, bucket: 'radar', confidence: 'baja', hits: ['dementia', 'digital health'],
    evidence: [ev(WEB, 'brightwater/2027', 'The 2027 cycle is expected to open in Q1.', 'opportunity', true, 45)], missing: ['No named decision-maker', 'Opening date not confirmed'] },
  { person: 'Noah Brandt', role: 'Associate', org: 'Kestrel Capital', title: 'Associate at Kestrel Capital', fundingType: 'investment', status: 'active', fit: 0.25, timing: 0.6, contact: li('noah-brandt'), bucket: 'radar', confidence: 'media', hits: ['digital health'],
    evidence: [ev(APIFY, 'linkedin/noah-brandt', 'Noah Brandt · Associate · Kestrel Capital', 'profile', true, 8)],
    paths: [{ hypothesis: true, hops: [{ to: 'Kenji Arai', relation: 'Documented public interaction: 1 of your comments; not a first-degree connection', strength: 0.3, evidence: [ev(PUB, 'linkedin/activity-kenji', 'Kenji Arai · 1 of your comments · 2026-06-02', 'public_interaction', true, 115)] }, { to: 'Noah Brandt', relation: 'Possible contact: same university (no verifiable link)', strength: 0.25, evidence: [ev(EXA, 'kestrel/alumni', 'Undated alumni list', 'education', false, 400)] }] }],
    jev: { action: 'investigate_more', actionConfidence: 0.66, actionProbabilities: { prioritize: 0.2, investigate_more: 0.66, discard: 0.14 }, strategicFit: 1.6, fitConfidence: 0.6, evidenceSufficient: 0.42, model: 'jev-latest (demo)' },
    missing: ['Jev recommends more evidence before prioritizing.', 'Decision authority not confirmed (Associate)'] },
  { person: null, role: null, org: 'Horizon Digital Health Program', title: 'European digital health call · closes in 21 days', fundingType: 'partnering', kind: 'opportunity', status: 'open', deadline: '2026-10-15', days: 21, fit: 0.75, timing: 0.2, contact: { type: 'email', value: 'info@example.org', provenance: 'Email published in the call (demo)' }, bucket: 'radar', confidence: 'alta', hits: ['digital health', 'dementia', 'sensors'],
    evidence: [ev(WEB, 'horizonte/call', 'Open until October 15, 2026; consortia from at least 3 countries.', 'opportunity', true, 5)], missing: ['Requires a 3-country consortium'] },
  { person: 'Julian Park', role: 'Managing Partner', org: 'Calmwave Labs', title: 'Managing Partner at Calmwave Labs', fundingType: 'investment', status: 'active', fit: 0.75, timing: 0.6, contact: li('julian-park'), bucket: 'discarded', discard: 'Excluded by your criteria.', confidence: 'media', hits: ['dementia', 'sensors', 'digital health'],
    evidence: [ev(APIFY, 'linkedin/julian-park', 'Julian Park · Managing Partner · Calmwave Labs', 'profile', true, 6)], risks: ['competitor_conflict'] },
  { person: 'Grace Liu', role: null, org: 'Pinecrest Partners', title: 'Mentioned in an angel investor list', fundingType: 'investment', status: 'unknown', fit: 0.25, timing: 0.1, bucket: 'discarded', discard: 'No confirmed evidence; search lead.', confidence: 'baja', hits: ['digital health'],
    evidence: [ev('Web search (Serper)', 'serper/list', 'Snippet: «… Grace Liu, angel investor …»', 'snippet', false, 300)] },
  { person: 'Victor Hsu', role: 'Director, Oncology BD', org: 'Oriel Biosciences', title: 'Oncology BD', fundingType: 'partnering', status: 'active', fit: 0, timing: 0.6, contact: li('victor-hsu'), bucket: 'discarded', discard: 'Rejected before for this user, product and mode.', confidence: 'media', hits: [],
    evidence: [ev(APIFY, 'linkedin/victor-hsu', 'Victor Hsu · Director, Oncology BD · Oriel Biosciences', 'profile', true, 12)] },
];

function buildLead(s: Spec, i: number): Lead {
  const you = DEMO_BRIEF.name;
  const paths = (s.paths || []).map((p) => {
    const nodes = [you, ...p.hops.map((h) => h.to)];
    const hops = p.hops.map((h, k) => ({ from: nodes[k], to: h.to, relation: h.relation, strength: h.strength, url: h.evidence[0]?.url || null, evidenceIds: h.evidence.map((e) => e.id) }));
    return { nodes, strength: Math.round(p.hops.reduce((n, h) => n * h.strength, 1) * 1000) / 1000, hypothesis: p.hypothesis, hops };
  });
  const pathEvidence = (s.paths || []).flatMap((p) => p.hops.flatMap((h) => h.evidence));
  const evidence = [...s.evidence, ...pathEvidence];
  const w = WEIGHTS.strategic;
  const values: Record<string, number> = {
    fit: s.fit, type: DEMO_BRIEF.fundingTypes.includes(s.fundingType) ? 1 : 0.15, timing: s.timing,
    path: Math.max(0, ...paths.map((p) => p.strength)), contact: s.contact?.type === 'email' ? 1 : s.contact ? 0.4 : 0, amountFit: s.amountFit ?? 0.3,
  };
  const breakdown = Object.entries(w).map(([factor, weight]) => ({ factor, points: Math.round(values[factor] * weight * 10) / 10, max: weight }));
  const penalty = evidence.some((e) => e.verified) ? 1 : 0.5;
  const score = Math.round(breakdown.reduce((n, f) => n + f.points, 0) * penalty);
  const target = s.person || s.org;
  const p0 = paths[0];
  return {
    id: `demo-lead-${i + 1}`, rank: 0, person: s.person, role: s.role, org: s.org, title: s.title, kind: s.kind || 'person', fundingType: s.fundingType,
    status: s.status || 'unknown', deadline: s.deadline || null, daysToDeadline: s.days ?? null, amount: null, contact: s.contact || null, evidence, paths,
    risks: [...(s.risks || []), 'DEMO: don\'t contact or decide on this data'],
    missing: [...new Set([...(s.missing || []), ...(!s.person ? ['No named decision-maker'] : []), 'Geographic eligibility and stage to confirm'])],
    why: [s.hits.length ? `Matches ${s.hits.slice(0, 4).join(', ')} in the evidence.` : 'Limited topic match: review before contacting.',
      DEMO_BRIEF.fundingTypes.includes(s.fundingType) ? `Category ${s.fundingType} requested; interest not confirmed yet.` : 'Adjacent type.',
      paths.length ? 'Professional relationship evidenced; willingness to introduce unknown.' : 'No verified intro path.'],
    score, breakdown, confidence: s.confidence, bucket: s.bucket, discard: s.discard || '', demo: true, feedback: null, jev: s.jev,
    draft: {
      subject: `[DEMO] ${s.fundingType === 'investment' ? 'Lumen Neuro seed round' : 'Partnering with Lumen Neuro'}`,
      body: `[DEMO — DO NOT SEND]
Hi ${target.split(' ')[0]}, ${s.evidence[0] ? `I saw "${s.evidence[0].quote.slice(0, 90)}».` : ''}"

I'm Ana Ríos, CEO of Lumen Neuro: we predict dementia agitation episodes with passive sensors (pilot in 3 care homes).

Would you have 20 minutes to explore fit?`,
      connector: p0 && p0.nodes.length > 2 ? `[DEMO — DO NOT SEND]
Hi ${p0.nodes[1].split(' ')[0]}. I see you know ${target}. We're raising a $2.5M seed for Lumen Neuro. Would you feel comfortable asking if they'd take an intro? Here's a forwardable paragraph:

"Lumen Neuro predicts dementia agitation episodes 40 minutes early. Pilot with 140 patients. Looking for partners with a neurotech thesis."` : null,
      warning: 'DEMO. Human review required; the system never sends messages.', wordCount: 60,
      sections: [{ label: 'Common ground / reason', text: s.evidence[0]?.quote || '', evidenceIds: s.evidence[0] ? [s.evidence[0].id] : [] }, { label: 'Ask', text: 'Would you have 20 minutes to explore fit?', evidenceIds: [] }],
    },
  };
}

function withRanks(leads: Lead[]): Lead[] {
  const ranks: Record<string, number> = { top: 0, radar: 0, discarded: 0 };
  return [...leads].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).map((l) => ({ ...l, rank: ++ranks[l.bucket] }));
}

let seq = 0;
const e = (sec: number, phase: LiveRunEvent['phase'], title: string, message: string, extra: Partial<LiveRunEvent> = {}): LiveRunEvent => ({ id: `demo:${++seq}`, sequence: seq, at: at(sec), phase, title, message, ...extra });
function runEvents(leads: Lead[]): LiveRunEvent[] {
  seq = 0;
  const top = leads.filter((l) => l.bucket === 'top').length, radar = leads.filter((l) => l.bucket === 'radar').length, disc = leads.filter((l) => l.bucket === 'discarded').length;
  const api = (sec: number, provider: string, host: string, endpoint: string, callId: string, n: number, ms: number, status: 'success' | 'error' = 'success', http = 200): LiveRunEvent[] => [
    e(sec, 'api_request', `POST ${host}`, `POST request to ${host}${endpoint}.`, { provider, status: 'running', publicUrl: `https://${host}${endpoint}`, detail: { kind: 'api', callId, method: 'POST', host, endpoint: `https://${host}${endpoint}`, params: {}, query: 'dementia agitation digital health (demo)' } }),
    e(sec + ms / 1000, 'api_response', `HTTP ${http} · ${host}`, status === 'error' ? `${host} returned HTTP ${http}.` : `${host} returned ${n} records in ${ms} ms.`, { provider, status, resultCount: n, durationMs: ms, detail: { kind: 'api', callId, method: 'POST', host, endpoint: `https://${host}${endpoint}`, params: {}, httpStatus: http, preview: status === 'error' ? [] : [{ title: 'Sample record (demo)', subtitle: host }] } }),
  ];
  const sources = ['Sender public profile', 'OpenAlex', 'NIH RePORTER', 'Exa', 'Funding rounds (Exa)', 'Apify'];
  return [
    e(0, 'planning', 'Search plan', 'Lumen Neuro · LN-2: investment, partnering · prototype · seed · United States, Europe · USD 2500000', { status: 'success', detail: { kind: 'plan', items: [], sources } }),
    e(0.2, 'planning', 'Source skipped', 'Serper: no SERPER_API_KEY; broad web search skipped.', { status: 'pending' }),
    e(0.5, 'source_started', 'Source started', 'Sender public profile: query started.', { provider: 'Sender public profile', status: 'running' }),
    e(1.6, 'source_completed', 'Source finished', 'Sender public profile: 2 facts with provenance.', { provider: 'Sender public profile', status: 'success', resultCount: 2, durationMs: 1100 }),
    e(1.7, 'source_started', 'Source started', 'OpenAlex: query started (in parallel with 3 more sources).', { provider: 'OpenAlex', status: 'running', detail: { parallel: 4 } }),
    ...api(1.8, 'OpenAlex', 'api.openalex.org', '/works', 'oa1', 48, 1320),
    e(3.4, 'source_completed', 'Source finished', 'OpenAlex: 6 candidates with provenance.', { provider: 'OpenAlex', status: 'success', resultCount: 6, durationMs: 1700 }),
    e(1.7, 'source_started', 'Source started', 'NIH RePORTER: query started (in parallel with 3 more sources).', { provider: 'NIH RePORTER', status: 'running', detail: { parallel: 4 } }),
    ...api(1.9, 'NIH RePORTER', 'api.reporter.nih.gov', '/v2/projects/search', 'nih1', 0, 2100, 'error', 503),
    e(4.1, 'source_completed', 'Source error', 'NIH RePORTER: HTTP 503 (service unavailable)', { provider: 'NIH RePORTER', status: 'error', resultCount: 0, durationMs: 2400 }),
    e(1.7, 'source_started', 'Source started', 'Exa: query started (in parallel with 3 more sources).', { provider: 'Exa', status: 'running', detail: { parallel: 4 } }),
    ...api(1.9, 'Exa', 'api.exa.ai', '/search', 'exa1', 8, 2400), ...api(4.4, 'Exa', 'api.exa.ai', '/search', 'exa2', 8, 2100),
    e(6.6, 'source_completed', 'Source finished', 'Exa: 7 candidates with provenance.', { provider: 'Exa', status: 'success', resultCount: 7, durationMs: 4900 }),
    e(1.7, 'source_started', 'Source started', 'Funding rounds (Exa): query started (in parallel with 3 more sources).', { provider: 'Funding rounds (Exa)', status: 'running', detail: { parallel: 4 } }),
    ...api(2.0, 'Funding rounds (Exa)', 'api.exa.ai', '/search?category=news', 'exa3', 8, 1900),
    e(4.0, 'source_completed', 'Source finished', 'Funding rounds (Exa): 3 candidates with provenance.', { provider: 'Funding rounds (Exa)', status: 'success', resultCount: 3, durationMs: 2300 }),
    e(6.8, 'source_started', 'Source started', 'Apify: query started.', { provider: 'Apify', status: 'running' }),
    ...api(6.9, 'Apify', 'api.apify.com', '/v2/acts/run-sync', 'ap1', 10, 6700).map((x) => ({ ...x, message: x.phase === 'api_request' ? 'Running Actor harvestapi/linkedin-profile-search (sync, up to 10 results).' : x.message })),
    ...api(13.7, 'Apify', 'api.apify.com', '/v2/acts/run-sync', 'ap2', 4, 5200).map((x) => ({ ...x, message: x.phase === 'api_request' ? 'Running Actor data_link_miner/linkedin-shared-connections (sync, up to 15 results).' : x.message })),
    ...api(19.0, 'Apify', 'api.apify.com', '/v2/acts/run-sync', 'ap3', 5, 4100).map((x) => ({ ...x, message: x.phase === 'api_request' ? 'Running Actor harvestapi/linkedin-company-employees (sync, up to 20 results).' : x.message })),
    e(23.2, 'source_completed', 'Source finished', 'Apify: 11 candidates with provenance.', { provider: 'Apify', status: 'success', resultCount: 11, durationMs: 16400 }),
    e(23.3, 'source_started', 'Network match', `Comparing ${leads.length} candidates with 42 imported contacts.`, { provider: 'Your network (warm paths)', status: 'running' }),
    e(23.4, 'source_completed', 'Match complete', `${leads.filter((l) => l.paths.length).length} candidates with a documented path from your network or team.`, { provider: 'Your network (warm paths)', status: 'success', resultCount: leads.filter((l) => l.paths.length).length, durationMs: 80 }),
    e(23.5, 'evaluating', 'Evaluation started', `Evaluating ${leads.length} candidates: evidence, duplicates, timing and feedback.`, { status: 'running', resultCount: leads.length }),
    e(23.6, 'evaluating', 'Structured decision', 'Jev is scoring fit, evidence and next action.', { provider: 'Jev', status: 'running' }),
    e(27.1, 'evaluating', 'Jev decisions applied', `Jev reviewed ${leads.filter((l) => l.jev).length} candidates; uncertain ones go to radar.`, { provider: 'Jev', status: 'success', resultCount: leads.filter((l) => l.jev).length, durationMs: 3500 }),
    e(27.3, 'evaluating', 'Candidates ranked', `${top} priority, ${radar} on radar and ${disc} discarded after de-duplication and scoring.`, { status: 'success', resultCount: leads.length, durationMs: 3800 }),
    e(27.6, 'drafting', 'Drafts written', `${leads.length} drafts created; nothing is sent.`, { status: 'success', resultCount: leads.length }),
    e(28.4, 'completed', 'Done with warnings', `${top} candidates prioritized; ${radar} on radar.`, { status: 'warning', resultCount: leads.length, detail: { jobStatus: 'partial' } }),
  ].sort((a, b) => a.at.localeCompare(b.at)).map((x, k) => ({ ...x, sequence: k + 1, id: `demo:${k + 1}` }));
}

export function demoJob(): Job {
  evSeq = 0;
  const leads = withRanks(specs.map(buildLead));
  return {
    id: 'demo-ejecutiva', brief: DEMO_BRIEF, mode: 'demo', status: 'partial', createdAt: at(0), finishedAt: at(28.4),
    events: [], leads, senderEvidence: [], plan: { summary: 'Lumen Neuro · LN-2: seed investment and neurotech partnering · United States and Europe', items: [] },
    run: { version: 1, events: runEvents(leads), dropped: 0 },
  };
}

/** Red del founder (ficticia): equipo, contactos directos e interacciones públicas. */
export function demoNetwork(): NetworkGraphData {
  const n = (id: string, label: string, subtitle: string, kind: string) => ({ id, label, subtitle, kind, url: null });
  return {
    ownerId: 'o', updatedAt: at(0),
    nodes: [n('o', 'Ana Ríos', 'CEO · Lumen Neuro', 'owner'), n('t1', 'Tomás Ibarra', 'CSO and co-founder · Lumen Neuro', 'team'), n('t2', 'Elena Duarte', 'Advisor · former BD director', 'team'),
      n('c1', 'Diego Ferrer', 'Angel investor · former colleague', 'connection'), n('c2', 'Julia Moreau', 'Founder · Northbeam portfolio company', 'connection'), n('c3', 'Kenji Arai', 'Geriatrician · public interaction', 'public'), n('c4', 'Laura Méndez', 'Pilot care home director', 'connection')],
    edges: [
      { id: 'e1', from: 'o', to: 't1', kind: 'team', strength: 0.95, verified: true, source: 'Lumen Neuro · team', evidenceUrl: null },
      { id: 'e2', from: 'o', to: 't2', kind: 'team', strength: 0.8, verified: true, source: 'Lumen Neuro · team', evidenceUrl: null },
      { id: 'e3', from: 'o', to: 'c1', kind: 'connected_1st', strength: 0.95, verified: true, source: 'LinkedIn authenticated via Apify', evidenceUrl: null },
      { id: 'e4', from: 'o', to: 'c2', kind: 'connected_1st', strength: 0.95, verified: true, source: 'LinkedIn authenticated via Apify', evidenceUrl: null },
      { id: 'e5', from: 'o', to: 'c3', kind: 'public_interaction', strength: 0.3, verified: false, source: 'Public LinkedIn activity', evidenceUrl: null },
      { id: 'e6', from: 'o', to: 'c4', kind: 'imported_contact', strength: 0.5, verified: false, source: 'Imported CSV contacts', evidenceUrl: null },
    ],
    summary: { people: 6, verified: 4, public: 1, mutualPaths: 3 },
  };
}
