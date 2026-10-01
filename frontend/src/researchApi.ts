import { legacyDeep } from './legacyText';
import type { LiveRunEvent } from './liveRunModel';
export type Brief = {
  name: string;
  role: string;
  company: string;
  product: string;
  description: string;
  industry: string;
  stage: string;
  geography: string;
  fundingTypes: string[];
  amount: string | number | null;
  criteria: string;
  exclusions: string;
  event: string;
  minDays: number;
  mode: 'strategic' | 'financial';
  dataMode: 'live' | 'demo';
  useTeam: boolean;
  useApify: boolean;
  excludeCompetitors: boolean;
  strictTypes: boolean;
  linkedinUrl?: string;
  /** Organización que busca (p. ej. IGC) cuando es distinta de la empresa financiada. */
  organization?: string;
  /** Empresa o proyecto que recibe la financiación (p. ej. Mentiva). */
  venture?: string;
  relation?: string;
  oneLiner?: string;
  round?: string;
  constraints?: string;
  useOfFunds?: string;
  entityType?: string;
  country?: string;
  state?: string;
  city?: string;
  timeline?: string;
  website?: string;
};
export type Evidence = {
  id: string;
  source: string;
  url: string;
  quote: string;
  field: string;
  retrievedAt: string;
  verified: boolean;
};
export type Feedback = {
  decision: string;
  reason: string;
  note: string;
  at: string;
};
export type WarmPlanStep = { when: string | null; what: string };
export type WarmPlan = { route: string; label: string; built: boolean; via?: string; cadenceDays: number | null; updates?: number; why: string; steps: WarmPlanStep[]; hook?: string; source?: 'signals' | 'ai'; evidence?: { id: string; url: string; quote: string } | null };
export type GrantPlan = {
  state: 'eligibility_review' | 'not_pursuing' | 'watching' | 'preparing' | 'decision_needed';
  decision: 'review' | 'no_go' | 'watch' | 'go' | 'conditional_go';
  label: string;
  nextAction: string;
  checklist: { key: string; label: string; done: boolean }[];
  programNumber: string | null;
  agency: string | null;
  deadline: string | null;
  daysToDeadline: number | null;
  policyThemes: string[];
  geography: string | null;
  contactQuestion: string | null;
  /** Cómo se aplica y si la fecha es alcanzable (servidor: applicationRoute.mjs). */
  apply?: {
    route: string; portal: { name: string; url: string } | null; infoUrl: string | null; officialUrl: string | null;
    steps: { key: string; label: string; days: number; required: boolean; skip: boolean }[];
    leadDays: number; daysToDeadline: number | null; feasible: boolean; verdict: 'feasible' | 'tight' | 'not_feasible' | 'closed' | 'unknown';
    nextDeadline: string | null; message: string; contactAdvice: string;
  };
};
/** Una comprobación del código sobre la página (tipo, plazo, elegibilidad, no dilutivo, oficial). */
export type VerifyCheck = { check: string; ok: boolean; detail: string; quote?: string };
export type Milestone = { iso: string | null; phase: string; label: string; quote: string; tbd?: boolean; yearless?: boolean; precision?: string; ambiguous?: boolean; alt?: string; optional?: boolean };
/** Verificación de una convocatoria: nivel (lista principal / a verificar / descartada), motivos y citas. */
export type Verification = {
  verdict: 'apply' | 'watch' | 'skip'; tier: 'main' | 'verify' | 'drop'; status?: string; eligible?: string; daysLeft?: number | null; flags: string[]; today?: string;
  deadlineQuote?: string; blockers?: string[]; reasons?: string[]; drop?: string;
  eligibility?: { decision: string; reason: string; quote: string; types?: Record<string, boolean>; countries?: string[] };
  pageType?: { type: string; isCall: boolean; reason: string; applyQuote?: string; soft?: boolean };
  dates?: { status: string; phase: string; reason: string; quote: string; opens?: string | null; milestones?: Milestone[] };
  checks?: VerifyCheck[];
};
/** Recorrido de un resultado: consulta → buscadores → página leída → lo que extrajo el modelo → lo que verificó el código. */
export type ResultTrace = {
  url?: string; title?: string; query?: string; family?: string; queries?: { query: string; family?: string }[]; providers?: string[]; round?: number;
  fetchedVia?: string; textChars?: number; today?: string; note?: string; verdict?: string; drop?: string | null; reasons?: string[]; name?: string; objective?: string;
  read?: { model?: string; out?: Record<string, unknown> } | null;
  verify?: { verdict?: string; tier?: string; drop?: string | null; reasons?: string[]; blockers?: string[]; flags?: string[]; checks?: VerifyCheck[]; pageType?: Verification['pageType'] | null; dates?: (Verification['dates'] & { claimed?: string | null }) | null; eligibility?: Verification['eligibility'] | null };
};
export type Explanation = { ai: string | null; aiRejected: string | null; facts: string; risks: string[]; unverified: string[]; today: string };
export type BriefInterpretation = {
  objective: string; looking_for?: string; fundType?: string; nonDilutiveOnly?: boolean; focus?: string | null; product?: string | null; geography?: string | null; stage?: string;
  applicant?: { entity: string; forProfit: boolean; entitySource: string; country: string | null; outside: string[]; countrySource: string };
  constraints?: string | null; exclusions?: string | null; today: string; year?: string; recency?: string; providers?: string[]; planner?: string;
};
export type ProviderBench = { provider: string; calls: number; returned: number; errors: number; ms: number; costUsd: number; urls: number; onlyUrls: number; pagesRead: number; apply: number; watch: number; useful: number; usefulPct: number | null; applyPct: number | null; noisePct: number | null; urlsPerCall: number | null; costPerUseful: number | null; uniqueUseful: number; outcomes: Record<string, number>; disabled: string | null };
export type RunAudit = {
  today: string; error?: string;
  brief?: Record<string, unknown>;
  interpretations: BriefInterpretation[];
  counters: { queries: number; queriesYearFixed: number; pagesSeen: number; pagesRead: number; pagesUnread: number; rereadForDates: number; rereadImproved: number; extracted?: number; extractChanged?: number; extractConflicts?: number; extractCredits?: number; extractCacheHits?: number; scrapeCacheHits?: number; readVia?: { crawl4ai: number; jina: number; firecrawl: number }; research?: { steps: number; searches: number; opens: number; newPages: number }; firecrawl?: { credits: number; possiblyCharged: number; cacheHits: number; capReached: boolean; capSkipped: number; daily: { day: string; used: number; possiblyCharged: number; cap: number | null; capReached: boolean } | null }; keptByEngine: number; droppedByEngine: Record<string, number>; skippedBeforeReading: Record<string, number>; verdicts: Record<string, number>; buckets: { top: number; radar: number; discarded: number }; discardReasons: Record<string, number>; radarReasons: Record<string, number> };
  providers?: ProviderBench[];
  grantSources?: { jurisdiction: string | null; portals: { name: string; url: string }[]; portalPages: { objective: string; seeds: number; pages: number; errors: string[] }[]; reporter: { projects: number; medianAward: number | null; orgTypes: { name: string; count: number }[]; institutes: { name: string; count: number }[]; notices: { id: string; projects: number; medianAward: number | null }[] } | null; nsf: { awards: number; medianAward: number | null; programs: { name: string; count: number }[] } | null; errors: string[] } | null;
  expansion?: { objective: string; seeds: number; pages: number; snowball: number; siteDive: number; similar: number; siteDiveVia: string; lateral: { openalex: number; edgar: number; ai: number }; errors: string[] }[];
  comparePrompts?: Record<string, string>;
  orchestrator?: { by: string | null; attempts: { attempt: number; stopped: string | null; strategy: string | null; gap: string | null; by: string | null; diagnosis: string | null; queries: string[]; added: number | null; topBefore: number | null; topAfter: number | null; error: string | null }[] } | null;
  queries: { objective?: string; round?: number; query: string; family?: string; original?: string; returned?: number | null; newPages?: number | null; providers?: string[]; error?: string; researcher?: boolean }[];
  discarded: ResultTrace[];
};
export type Lead = {
  verification?: Verification;
  /** Verificación solo-código (sin lectura del modelo): búsqueda directa en APIs, discovery abierto. */
  codeCheck?: Verification;
  /** Puerta de la lista principal: main (vigencia y elegibilidad verificadas) | verify (a verificar) | drop. */
  gate?: { tier: 'main' | 'verify' | 'drop'; reason: string; source: string; pending?: string };
  explain?: Explanation;
  trace?: ResultTrace;
  warmPlan?: WarmPlan;
  grantPlan?: GrantPlan;
  foundBy?: { provider: string; term: string; objective: string; query: string; gap?: string }[];
  parentKey?: string;
  followUp?: { from: string; question: string };
  sufficiency?: { verdict: 'sufficient' | 'insufficient' | 'contradictory'; gaps: string[]; items: Record<string, { status: string }> };
  eligibility?: { verdict: '✔' | '✖' | '?'; closed: boolean; questions: string[]; method: string };
  activeFund?: { rank: number; dealsInWindow: number };
  id: string;
  key?: string;
  fit?: number;
  /** Extra contacts (e.g. program staff found by Hunter for a grant). */
  contacts?: { name: string; role: string | null; email: string; provenance: string }[];
  hunter?: { domain: string; score: number; status: string | null };
  rank: number;
  person: string | null;
  role: string | null;
  org: string;
  title: string;
  kind: string;
  fundingType: string;
  opportunityType?: 'challenge' | 'prize' | 'accelerator' | 'fellowship' | 'open_call' | string;
  status: string;
  deadline: string | null;
  amount: number | null;
  contact: { type: string; value: string; provenance: string } | null;
  evidence: Evidence[];
  paths: {
    nodes: string[];
    strength: number;
    hypothesis: boolean;
    hops: {
      from: string;
      to: string;
      relation: string;
      strength: number;
      url: string | null;
      evidenceIds: string[];
    }[];
  }[];
  risks: string[];
  missing: string[];
  why: string[];
  score: number;
  breakdown: { factor: string; points: number; max: number }[];
  confidence: string;
  bucket: string;
  discard: string;
  demo: boolean;
  feedback: Feedback | null;
  /** Días hasta el cierre calculados por el servidor (null si no hay fecha). */
  daysToDeadline?: number | null;
  jev?: {
    action: 'prioritize' | 'investigate_more' | 'discard';
    actionConfidence: number;
    actionProbabilities: Record<string, number>;
    strategicFit: number;
    fitConfidence: number;
    evidenceSufficient: number;
    model: string;
    provider?: string;
  };
  draft: {
    subject: string;
    body: string;
    connector: string | null;
    warning: string;
    wordCount: number;
    sections: { label: string; text: string; evidenceIds: string[] }[];
  };
};
export type RunGrant = { id: string; leadId: string; title: string; agency: string; url: string; closeDate: string | null; awardCeiling: number | null; verdict: '✔' | '✖' | '?'; closed: boolean };
export type ActiveFund = { fundId: string; rank: number; name: string; dealsInWindow: number; leads: number; inactive: boolean; signals: { type: string; label: string; url: string | null }[]; why: { text: string; url: string } | null };
export type Job = {
  /** Auditoría de la corrida: qué entendió el motor, qué buscó, qué leyó, qué descartó y por qué. */
  runAudit?: RunAudit;
  searchAudit?: { provider: string; query: string; dimension: string; returned?: number; discovered: number; priority: number; watch: number; discarded: number }[];
  grants?: { evaluations: RunGrant[]; alerts: { id: string; title: string; closeDate: string; days: number; verdict: string; level: string }[] };
  activeInvestors?: { asOf: string; funds: ActiveFund[]; universe: number };
  id: string;
  brief: Brief;
  mode: 'live' | 'demo';
  status: string;
  createdAt: string;
  finishedAt?: string;
  events: { phase: string; message: string; at: string }[];
  leads: Lead[];
  senderEvidence: Evidence[];
  usage?: Record<string, { calls: number; results: number; ms: number; bytes: number; costUsd: number }>;
  queryLedger?: { id: string; parent: string | null; round: number; gap: string; term: string; provider: string; query: string; results: number; newOrgs: number; acceptedLeads: number; costUsd: number; ms: number; error?: string }[];
  loop?: { stopReason: string; sufficient: boolean; partial: boolean };
  plan?: { summary: string; items: { provider: string; query: string }[]; terms?: { term: string; source: 'yours' | 'model' | 'lexicon' }[] };
  /** Eventos estructurados del Live Agent Run (ausente en investigaciones anteriores a este registro). */
  run?: { version: number; events: LiveRunEvent[]; dropped: number };
};
export type History = {
  id: string;
  name: string;
  product: string;
  status: string;
  mode: string;
  createdAt: string;
  /** Campos añadidos al listado (opcionales para compatibilidad con servidores anteriores). */
  company?: string;
  venture?: string;
  finishedAt?: string | null;
  leads?: number;
  top?: number;
}[];
export const API = '/api/research';
/** Error HTTP con código, para distinguir «no existe / no es tuya» (404) de fallos transitorios. */
export class ApiError extends Error {
  status: number;
  code?: string;
  detail?: string;
  constructor(message: string, status: number, code?: string, detail?: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}
export async function api<T>(
  path: string,
  body?: unknown,
  method?: string,
): Promise<T> {
  const r = await fetch(API + path, {
    method: method || (body ? 'POST' : 'GET'),
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const data = await r.json();
  if (!r.ok)
    throw new ApiError(
      typeof data === 'object' && data !== null && 'error' in data
        ? String(data.error)
        : `Error ${r.status}`,
      r.status,
      typeof data === 'object' && data !== null && 'code' in data
        ? String(data.code)
        : undefined,
      typeof data === 'object' && data !== null && 'detail' in data
        ? String(data.detail)
        : undefined,
    );
  return legacyDeep(data) as T;
}
export const blank: Brief = {
  name: '',
  role: '',
  company: '',
  product: '',
  description: '',
  industry: '',
  stage: 'prototype',
  geography: '',
  fundingTypes: ['partnering'],
  amount: '',
  criteria: '',
  exclusions: '',
  event: '',
  minDays: 30,
  mode: 'strategic',
  dataMode: 'live',
  useTeam: false,
  useApify: true,
  excludeCompetitors: false,
  strictTypes: false,
};
export const presets: Record<string, Brief> = {
  ram: {
    ...blank,
    name: 'Ram Mukunda',
    role: 'CEO & Director',
    company: 'IGC Pharma',
    product: 'IGC-AD1',
    description:
      'Phase 2 candidate for agitation in Alzheimer\'s dementia.',
    industry: 'Alzheimer agitation neuroscience',
    stage: 'clinical_phase_2',
    geography: 'United States, Europe',
    fundingTypes: ['partnering'],
    criteria:
      'Prioritize neuroscience partnering and licensing. Confirm the BD lead.',
    useTeam: true,
  },
  rohit: {
    ...blank,
    name: 'Rohit Goel',
    role: 'Senior Director, Accounting & Finance',
    company: 'IGC Pharma',
    product: 'AHA — Agentic Harmonization Assistant',
    description:
      'AI tool for research data harmonization.',
    industry: 'Alzheimer data harmonization artificial intelligence',
    stage: 'prototype',
    geography: 'United States',
    fundingTypes: ['grant'],
    mode: 'financial',
    minDays: 60,
    criteria:
      'Confirm for-profit eligibility and non-US work conditions.',
  },
};
export const fundingLabels: Record<string, string> = {
  partnering: 'Partnering / licensing',
  grant: 'Grant / non-dilutive',
  investment: 'Investment',
  sponsorship: 'Sponsorship',
  debt: 'Debt',
};
export const statusLabels: Record<string, string> = {
  open: 'Open',
  closed: 'Closed',
  unknown: 'Unconfirmed',
  forecasted: 'Forecast',
  active: 'Recent activity',
};

/* ───────── Live Agent Run por SSE (EventSource nativo) ───────── */
export type RunSnapshot = { jobId: string; status: string; events: LiveRunEvent[]; dropped: number; structured: boolean };
export type RunStreamHandlers = {
  onSnapshot: (snapshot: RunSnapshot) => void;
  onEvent: (event: LiveRunEvent) => void;
  onEnd: (status: string) => void;
  /** El navegador está reintentando (reconexión automática con Last-Event-ID). */
  onReconnecting: () => void;
  /** El stream no se puede usar (404, red, servidor sin SSE): el llamador vuelve al sondeo. */
  onFailure: () => void;
};
export function subscribeRun(jobId: string, handlers: RunStreamHandlers): () => void {
  const source = new EventSource(`${API}/jobs/${encodeURIComponent(jobId)}/events`);
  let closed = false;
  let failures = 0;
  const close = () => { closed = true; source.close(); };
  const parse = <T,>(e: Event): T | null => {
    try { return legacyDeep(JSON.parse((e as MessageEvent<string>).data)) as T; } catch { return null; }
  };
  source.addEventListener('snapshot', (e) => { failures = 0; const data = parse<RunSnapshot>(e); if (data && !closed) handlers.onSnapshot(data); });
  source.addEventListener('live', (e) => { const data = parse<LiveRunEvent>(e); if (data && !closed) handlers.onEvent(data); });
  source.addEventListener('end', (e) => { const data = parse<{ status: string }>(e); close(); handlers.onEnd(data?.status || 'done'); });
  source.onerror = () => {
    if (closed) return;
    failures += 1;
    // CLOSED: el servidor respondió con error (p. ej. 404). Tres reintentos seguidos sin snapshot: se usa el sondeo.
    if (source.readyState === EventSource.CLOSED || failures >= 3) { close(); handlers.onFailure(); }
    else handlers.onReconnecting();
  };
  return close;
}
export const frameUrl = (jobId: string, frameId: string) => `${API}/jobs/${encodeURIComponent(jobId)}/frames/${encodeURIComponent(frameId)}`;

/* Página oficial de un lead dentro de la app. `officialPage` dice si el sitio se deja embeber (iframe);
   `browsePage` maneja el navegador remoto: la página corre en el servidor y aquí se ven los fotogramas. */
export type OfficialPage = { url: string | null; status?: number | null; embeddable: boolean; reason: string | null; browser?: { available: boolean; reason: string | null } };
export type BrowseShot = { url: string; title: string; image: string; width: number; height: number };
export type BrowseAction =
  | { action: 'open'; refresh?: boolean } | { action: 'close' } | { action: 'back' } | { action: 'reload' }
  | { action: 'click'; x: number; y: number } | { action: 'scroll'; dy: number } | { action: 'type'; text: string } | { action: 'key'; key: string };
const leadPath = (jobId: string, leadId: string) => `${API}/jobs/${jobId}/leads/${encodeURIComponent(leadId)}`;
export async function officialPage(jobId: string, leadId: string): Promise<OfficialPage> {
  const r = await fetch(`${leadPath(jobId, leadId)}/page`, { signal: AbortSignal.timeout(20000) });
  const data = await r.json();
  if (!r.ok) throw new ApiError(String(data?.error || `Error ${r.status}`), r.status);
  return data as OfficialPage;
}
export async function browsePage(jobId: string, leadId: string, body: BrowseAction): Promise<BrowseShot> {
  const r = await fetch(`${leadPath(jobId, leadId)}/browse`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    signal: AbortSignal.timeout(body.action === 'open' ? 45000 : 25000),
  });
  const data = await r.json();
  if (!r.ok) throw new ApiError(String(data?.error || `Error ${r.status}`), r.status, data?.code);
  return data as BrowseShot;
}
export function closeBrowse(jobId: string, leadId: string) {
  void fetch(`${leadPath(jobId, leadId)}/browse`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'close' }), keepalive: true }).catch(() => {});
}
