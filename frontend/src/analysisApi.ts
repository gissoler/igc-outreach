/* Cliente de la capa de análisis (tesis revelada, acercamientos, grants, voz del decisor, backtest). */
import { api, API } from './researchApi';

export type Evidence = { url: string; quote: string; date?: string | null };
export type Signal = { type: 'ritmo' | 'sector' | 'vehiculo' | 'spv' | 'inactivo'; label: string; date: string | null; evidence: Evidence[] };
export type Explanation = { text: string; url: string; quote: string; date: string | null; similarity: number };
export type RevealedFund = { fundId: string; name: string; rank: number; dealsInWindow: number; leads: number; explanation: Explanation[]; momentum: { signals: Signal[]; pace: number; inactive: boolean; newVehicle: boolean; lastActivity: string | null } };
export type RevealedResult = { asOf: string; method: { similarity: string; rerank: string; momentum: boolean }; stage: string | null; sector: string | null; funds: RevealedFund[]; universe: { deals: number; funds: number } };
export type Rate = { k: number; n: number; mean: number | null; lo: number | null; hi: number | null; label: string };
export type OutreachEvent = { id: string; fundName: string; person: string | null; personType: string | null; channel: string; arguments: string[]; variant: string | null; sentAt: string; outcome: string; shared: boolean; note: string };
export type SummaryRow = { key: string; label: string; n: number; replies: number; meetings: number; replyRate: Rate; meetingRate: Rate };
export type Summary = { by: string; total: number; pending: number; stage: string; note: string; rows: SummaryRow[] };
export type OutreachState = { events: OutreachEvent[]; byChannel: Summary; byArgument: Summary; nextVariant: { key: string; mode: string; reason: string } | null; options: { channels: Record<string, string>; arguments: Record<string, string>; outcomes: { key: string; label: string }[] } };
export type NetworkCell = { fundName: string; sector: string | null; stage: string | null; founders: number; replyRate: Rate; meetingRate: Rate; text: string; meetingRoutes: { channel: string; meetings: number }[]; meetingArguments: { argument: string; meetings: number }[]; typicalReply: string | null };
export type Rule = { type: string; requirement: unknown; quote: string; url: string; method: string; verdict: '✔' | '✖' | '?'; why: string };
export type GrantEval = { id: string; number: string; title: string; agency: string; url: string; closeDate: string | null; awardCeiling: number | null; verdict: '✔' | '✖' | '?'; closed: boolean; rules: Rule[]; method: string; questions: string[] };
export type Alert = { id: string; title: string; closeDate: string; days: number; verdict: string; alert: string | null; level: string };
export type ProfileField = { value: unknown; source: string };
export type GrantsState = { evaluations: GrantEval[]; alerts: Alert[]; profile: Record<string, ProfileField | string> };
export type Claim = { text: string; quote: string; url: string; title?: string; position?: string | null; kind?: string };
export type Brief = { person: string; sections: { key: string; label: string; mode?: string; claims: Claim[]; note?: string }[]; objections: { objection: string; quote: string; url: string; answer: string; facts_used: string[]; answerGrounded: boolean; position?: string | null }[]; objectionsNote: string | null; fidelity: { generated: number; supported: number; share: number } | null; sources: number };
export type Status = { deals: number; funds: number; vehicles: number; vehiclesSource: string | null; fleet: Record<string, string | null>; voicePeople: { person_key: string; person: string; n: number; sources: number }[]; outreach: number; judgments: number; backtest: Backtest | null };
export type Metric = { n: number; hitAtK: number | null; mrr: number | null };
export type Backtest = { file: string; at: string; table: Record<string, Record<string, Metric>>; coverage: number | null; vsBaseline: { mean: number; ci95: [number, number] } | null; vsApp: { mean: number; ci95: [number, number] } | null; decision: string; rounds: number };

export const analysisApi = {
  status: () => api<Status>('/analysis/status'),
  revealed: (profile: string, stage?: string) => api<RevealedResult>('/analysis/revealed', { profile, stage, limit: 20 }),
  outreach: () => api<OutreachState>('/outreach'),
  addOutreach: (e: Partial<OutreachEvent>) => api<OutreachEvent>('/outreach', e),
  updateOutreach: (id: string, e: Partial<OutreachEvent>) => api<OutreachEvent>(`/outreach/${id}`, e, 'PUT'),
  importOutreach: (csv: string, shared: boolean) => api<{ imported: number; errors: string[] }>('/outreach/import', { csv, shared }),
  network: (fund: string) => api<{ cells: NetworkCell[]; hiddenCells: number; note: string; minFounders: number }>(`/outreach/network?fund=${encodeURIComponent(fund)}`),
  grants: () => api<GrantsState>('/grants'),
  evaluateJob: (jobId: string) => api<{ evaluations: GrantEval[]; alerts: Alert[] }>('/grants/evaluate', { jobId }),
  saveProfile: (p: Record<string, unknown>) => api<Record<string, ProfileField>>('/grants/profile', p, 'PUT'),
  icsUrl: `${API}/grants/calendar.ics`,
  brief: (person: string, profile: string, facts: { text: string; source: string }[]) => api<Brief>('/voice/brief', { person, profile, facts }),
  simulate: (person: string, message: string, history: { role: string; text: string }[]) => api<{ reply: string; citations: Claim[]; evidence: boolean }>('/voice/simulate', { person, message, history }),
};

/* ───────── Agente asesor ───────── */
export type Finding = { id: string; severity: 'alta' | 'media' | 'info'; tag: 'V' | 'I'; title: string; detail: string; leadKeys: string[] };
export type RelState = { touches: number; updates: number; lastTouch: string | null; nextDue: string | null; replied: boolean; meeting: boolean; declined: boolean; stage: string };
export type ShortItem = { leadKey: string; name: string; person: string; org: string; role: string | null; cls: string; label: string; reason: string; score: number; warm: number; pathHops: number; hypothesis: boolean; evidence: { url: string; quote: string }[]; state: RelState; stageLabel: string; move: { kind: string; text: string; via?: string } };
export type Connector = { key: string; name: string; org?: string; role?: string; internal: boolean; leadKey?: string; score: number; targets: { leadKey: string; name: string; weakest: number; hypothesis: boolean; relation: string; url: string | null }[] };
export type Memo = { method: string; headline: string; paragraphs: { text: string; refs: string[] }[]; note?: string; dropped?: number; generationId?: string | null };
export type Item = { text: string; public: boolean };
export type UpdateForm = { id: string; period: string; language: 'es' | 'en'; tldr: string; metrics: { name: string; value: string; previous: string; unit: string; public: boolean }[]; highlights: Item[]; lowlights: Item[]; market: Item[]; asks: Item[]; nextMilestones: Item[]; raisingInMonths: number | null };
export type AdvisorState = { jobId: string; venture: string; asOf: string; cadenceDays: number; findings: Finding[]; list: ShortItem[]; excluded: { leadKey: string; name: string; cls: string; label: string; reason: string }[]; connectors: Connector[]; readiness: { ready: boolean; checks: { ok: boolean; label: string; rule: string }[] }; plan: { when: string; what: string }[]; playbook: { id: string; rule: string; url: string; quote: string }[]; memo: Memo; updates: UpdateForm[] };
export type Draft = { subject: string; body: string; warnings: string[]; method: string; note?: string; wordCount: number; generationId: string | null; recipient: { type: string; name: string } };
export type IntroDraft = { connector: string; target: string; ask: string; forwardable: string; rules: string[] };

export type EvidenceItem = { id: string; source: string; url: string | null; title: string; text: string; date: string | null };
export type Claim2 = { text: string; evidence: string[] };
export type Dossier = { summary: string; role: { kind: string; title: string; evidence: string[] }; current_focus: Claim2[]; fit: { verdict: string; reasons: Claim2[] }; warm_paths: { via: string; relationship: string; strength: number; would_introduce: string; reasoning: string; evidence: string[]; knownPath?: boolean }[]; best_route: { type: string; via: string; why: string }; common_ground: Claim2[]; ask: { text: string; why: string }; timing: { when: string; why: string }; risks: string[]; open_questions: string[]; confidence: string; verification: { claims: number; kept: number; dropped: number; reasons: string[] } };
export type DossierResult = { key: string; leadKey: string | null; person: string; org: string | null; role: string | null; mode: string; dossier: Dossier; model: string; evidence: EvidenceItem[]; trace: { step: number; action: string; args: Record<string, string>; thought?: string }[]; createdAt: string; cached?: boolean };
export type RefItem = { text: string; refs: string[] };
export type RoadAction = { who: string; what: string; via: string; why: string; refs: string[] };
export type Roadmap = { headline: string; diagnosis: RefItem[]; thesis: string; phases: { name: string; window: string; goal: string; exit_criteria: string[]; actions: RoadAction[] }[]; first_week: RoadAction[]; update_plan: { cadence_days: number; themes: RefItem[] }; do_not: RefItem[]; risks: RefItem[]; verification: { dropped: number; reasons: string[] } };
export type DeepRun = { id: string; status: string; role: string; startedAt: string; finishedAt?: string; events: { at: string; type: string; message?: string; contact?: string; step?: number; action?: string; thought?: string }[]; dossiers: DossierResult[]; roadmap: Roadmap | null; critic: { verdict: string; issues: { severity: string; issue: string; fix: string }[] } | null; revised?: boolean; strategistRole?: string; errors: { contact: string; error: string }[] };
export type EdgeJudgment = { id: string; from: string; to: string; judgment: { strength: number; relationship: string; would_introduce: string }; human: { strength: number } | null };

export const advisorApi = {
  deepStart: (b: { jobId: string; refresh?: boolean; samples?: number }) => api<{ runId: string }>('/advisor/deep', b),
  deepLatest: (jobId: string) => api<{ run: DeepRun | null; role: string | null; running: boolean }>(`/advisor/deep?jobId=${encodeURIComponent(jobId)}`),
  deepRun: (id: string) => api<{ run: DeepRun; running: boolean }>(`/advisor/deep/${id}`),
  deepCancel: (id: string) => api<{ ok: boolean }>(`/advisor/deep/${id}/cancel`, {}),
  dossierFeedback: (key: string, verdict: string, note: string) => api<{ ok: boolean }>('/advisor/dossier/feedback', { key, verdict, note }),
  edges: () => api<{ edges: EdgeJudgment[] }>('/advisor/edges'),
  edgeLabel: (id: string, strength: number) => api<{ ok: boolean }>('/advisor/edge/label', { id, strength }),
  state: (jobId: string | null, cadence: number) => api<AdvisorState>(`/advisor?${new URLSearchParams({ ...(jobId ? { jobId } : {}), cadence: String(cadence) })}`),
  memo: (jobId: string, cadence: number) => api<Memo>('/advisor/memo', { jobId, cadence }),
  saveUpdate: (u: Partial<UpdateForm> & { jobId: string }) => api<UpdateForm>('/advisor/updates', u),
  compose: (b: { jobId: string; updateId: string; polish: boolean; cadence: number; leadKey?: string; connectorKey?: string }) => api<Draft>('/advisor/compose', b),
  intro: (b: { jobId: string; connectorKey: string; leadKey?: string; language?: string }) => api<IntroDraft>('/advisor/intro', b),
  sent: (b: { jobId: string; channel: string; sentAt: string; updateId?: string; generationId?: string; leadKey?: string; connectorKey?: string }) => api<unknown>('/advisor/sent', b),
  review: (generationId: string, label: 'aprobado' | 'editado' | 'rechazado', final?: string) => api<{ ok: boolean }>('/advisor/review', { generationId, label, final }),
};
