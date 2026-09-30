import type { ProjectConfig } from './api';

export type AccountSource = { source: string; count: number; updatedAt: string | null };
export type AccountConnector = { import: boolean; oauth: boolean; configured?: boolean; server?: boolean; status?: string };
export type LinkedInPublicProfile = {
  linkedinUrl: string;
  name: string;
  headline: string;
  role: string;
  organization: string;
  location: string;
  verifiedAt: string;
  source: string;
};
export type LinkedInInteractions = { count: number; posts: number; actor: string; actors?: string[]; status: string; error?: string; errors?: {source:string;message:string}[] };
export type NetworkGraphData = {
  ownerId: string;
  nodes: { id:string; label:string; subtitle:string; kind:string; url:string|null }[];
  edges: { id:string; from:string; to:string; kind:string; strength:number; verified:boolean; source:string; evidenceUrl:string|null }[];
  summary: { people:number; verified:number; public:number; mutualPaths:number };
  updatedAt: string;
};
export type AuthenticatedGraphResult = { query:string; people:number; direct:number; mutualPaths:number; actors:string[]; errors:string[] };
export type AccountSession = {
  /** browser: anonymous workspace tied to a key kept in this browser (no login). */
  user: { id: string; email: string; name: string; browser?: boolean };
  profile: (ProjectConfig & { onboardingComplete?: boolean }) | null;
  sources: AccountSource[];
};

const BASE = '/api/research';
export class ApiError extends Error {
  code?: string;
  constructor(message: string, code?: string) { super(message); this.code = code; }
}
async function request<T>(path: string, init?: RequestInit, timeout = 20_000): Promise<T> {
  const response = await fetch(BASE + path, {
    ...init,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    signal: AbortSignal.timeout(timeout),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(body.error || `Error ${response.status}`, body.code);
  return body as T;
}

export const accountApi = {
  me: () => request<AccountSession>('/auth/me'),
  /** Opens (or creates) the workspace of this browser. There is no sign-in: no email, no password. */
  browser: (key: string) => request<AccountSession>('/auth/browser', { method: 'POST', body: JSON.stringify({ key }) }),
  logout: () => request<{ loggedOut: boolean }>('/auth/logout', { method: 'POST', body: '{}' }),
  saveProfile: (profile: ProjectConfig & { onboardingComplete?: boolean }) =>
    request<ProjectConfig & { onboardingComplete?: boolean }>('/account/profile', { method: 'PUT', body: JSON.stringify(profile) }),
  sources: () => request<AccountSource[]>('/account/sources'),
  connectors: () => request<Record<string, AccountConnector>>('/account/connectors'),
  connectLinkedIn: (url: string, manual?: { name: string; role?: string; organization?: string }) =>
    request<{ profile: ProjectConfig & { onboardingComplete?: boolean; linkedin_profile?: LinkedInPublicProfile }; linkedin: LinkedInPublicProfile; interactions: LinkedInInteractions }>('/account/linkedin', { method: 'POST', body: JSON.stringify({ url, manual }) }, 190_000),
  networkGraph: () => request<NetworkGraphData>('/account/network-graph'),
  buildAuthenticatedGraph: (cookie: string) =>
    request<{ graph:NetworkGraphData; result:AuthenticatedGraphResult }>('/account/network-graph', { method:'POST', body:JSON.stringify({cookie}) }, 190_000),
  deleteAuthenticatedGraph: () => request<NetworkGraphData>('/account/network-graph', { method:'DELETE', body:'{}' }),
  importSource: (source: string, content: string, fileName: string) =>
    request<AccountSource>(`/account/sources/${source}`, { method: 'POST', body: JSON.stringify({ content, fileName }) }),
  disconnectSource: (source: string) =>
    request<AccountSource>(`/account/sources/${source}`, { method: 'DELETE', body: '{}' }),
};

export type IntakeField = { value: unknown; origin: string; confidence: 'source' | 'inferred' | 'user'; quote: string; at: string };
export type IntakeMessage = { role: 'user' | 'assistant'; text: string; at: string; files?: string[]; model?: string | null };
export type IntakeDocument = { id: string; name: string; type: string; size: number; chars: number; pages: number | null; at: string; preview: string };
export type IntakePlan = NonNullable<NonNullable<ProjectConfig['intake']>['plan']>;
export type IntakeState = {
  id: string;
  messages: IntakeMessage[];
  documents: IntakeDocument[];
  fields: Record<string, IntakeField>;
  missing: string[];
  /** Fields the plan needs for this goal (server-defined). Progress = planFields filled. */
  planFields?: string[];
  skipped: string[];
  pending: string | null;
  confirmedAt: string | null;
  plan: IntakePlan;
  model: { configured: boolean; model: string | null; reasoning: boolean };
  changed?: string[];
  modelError?: string | null;
};
export type IntakeUpload = { name: string; type: string; size: number; text: string; pages?: number };

/* Agente de prerregistro: conversación + documentos -> perfil que el usuario confirma. */
export const intakeApi = {
  get: () => request<IntakeState>('/intake'),
  message: (text: string, documents: IntakeUpload[]) =>
    request<IntakeState>('/intake/message', { method: 'POST', body: JSON.stringify({ text, documents }) }, 150_000),
  field: (path: string, value: unknown) =>
    request<IntakeState>('/intake/field', { method: 'PUT', body: JSON.stringify({ path, value }) }),
  removeDocument: (id: string) => request<IntakeState>(`/intake/documents/${id}`, { method: 'DELETE', body: '{}' }),
  reset: () => request<IntakeState>('/intake/reset', { method: 'POST', body: '{}' }),
  confirm: () =>
    request<{ profile: ProjectConfig & { onboardingComplete?: boolean }; intake: IntakeState }>('/intake/confirm', { method: 'POST', body: '{}' }),
};

/* ───────── Browser workspace key (feedback 29/09: no login; progress stays in this browser) ───────── */
const KEY = 'igc-browser-key';
let memoryKey = '';
const newKey = () => { const b = new Uint8Array(32); crypto.getRandomValues(b); return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
/** The key that identifies this browser's workspace; created on first use. */
export function browserKey(): string {
  try { let k = localStorage.getItem(KEY); if (!k) { k = newKey(); localStorage.setItem(KEY, k); } return k; }
  catch { memoryKey ||= newKey(); return memoryKey; }
}
/** Forget this browser's workspace; the next visit starts a new, empty one. */
export function resetBrowserKey() { try { localStorage.removeItem(KEY); } catch { /* no storage */ } memoryKey = ''; }
