import { demoApi, isDemo } from './demo';
export type Readiness = { id: string; label: string; ready: boolean; detail: string };
export type FactorKey = 'seed' | 'coinvest' | 'thesis' | 'path' | 'activity';
export type PathHop = {
  from: string;
  from_name: string;
  to: string;
  to_name: string;
  s: number;
  rel: string;
  hypothesis: boolean;
  evidence: string;
  sources: string[];
};
export type WarmPath = {
  nodes: string[];
  hops: PathHop[];
  strength: number;
  weakest: number;
  n_hops: number;
  has_hypothesis: boolean;
  connector: string | null;
};
export type Recommendation = {
  run_id: string;
  rank: number;
  fund_id: string;
  name: string;
  score: number;
  factors: Record<FactorKey, number>;
  best_path: WarmPath | null;
  outcome_stage?: string | null;
  profile: {
    thesis?: string | null;
    thesis_quote?: string | null;
    thesis_url?: string | null;
    stages?: string[] | null;
    sectors?: string[] | null;
    geos?: string[] | null;
    ticket_min?: number | null;
    ticket_max?: number | null;
    ticket_kind?: string | null;
    ticket_quote?: string | null;
    fund_size?: number | null;
    last_activity?: string | null;
    domain?: string | null;
    linkedin?: string | null;
    photo_url?: string | null;
    city?: string | null;
    state?: string | null;
    country?: string | null;
    vehicle?: string | null;
    source_ref?: string | null;
    source_date?: string | null;
    total_sold?: number | null;
  };
  /** Socios / directores públicos del fondo (Form D). */
  people?: { name: string; key: string }[];
};
/** Dos fondos del top que comparten al menos un socio o director. */
export type FundLink = { source: string; target: string; shared: string[] };
export type FundingType = 'grant' | 'venture' | 'angel' | 'corporate' | 'debt' | 'bootstrapping';
export type TeamRole = 'cofounder' | 'equipo' | 'advisor' | 'board' | 'inversionista' | 'grupo';
export type TeamMember = { name: string; email: string; linkedin_url: string; org: string; role: TeamRole; shares_network: boolean; closeness: number | null };
export type DeclaredContact = { name: string; org: string; linkedin_url: string; known_by: string; strength: 'fuerte' | 'media' | 'debil'; note: string };
export type Affiliation = { name: string; kind: 'universidad' | 'empresa' | 'aceleradora' | 'comunidad' | 'grupo'; members: string[] };
export type IntakeSummary = {
  objectives: string[]; maturity: string; competitors: string[]; criteria: string[]; constraints: string[];
  use_of_funds: string; timeline: string; website: string; organization?: string; relation?: string;
  documents: { name: string; chars: number; at: string }[];
  evidence: Record<string, { origin: string; confidence: string; quote: string }>;
  plan?: { objectives: string[]; steps: { goal: string; source: string; why: string; status: string; cost: string }[]; skipped: { source: string; reason: string }[]; rules: string[] };
  confirmedAt: string;
};
export type ProjectConfig = {
  project: {
    name: string;
    one_liner: string;
    description: string;
    sectors: string[];
    keywords: string[];
    stage: string;
    raise_usd: number | null;
    geo: string[];
    funding_types?: FundingType[];
    /** Empresa financiada cuando la organización que busca es otra (IGC → Mentiva). */
    venture?: string;
    relation?: string;
  };
  founder: { name: string; title?: string; email: string; linkedin_url: string; org: string };
  linkedin_profile?: {
    linkedinUrl: string; name: string; headline: string; role: string;
    organization: string; location: string; verifiedAt: string; source: string;
  };
  linkedin_interactions?: {
    count: number; posts: number; actor: string; status: string; error?: string; updatedAt: string;
  };
  comparables: { name: string; domain: string; sec_cik: string; aliases: string[]; why: string }[];
  /** Perfil confirmado en el prerregistro conversacional (objetivos, madurez, evidencia y plan). */
  intake?: IntakeSummary;
  team: TeamMember[];
  contacts: DeclaredContact[];
  affiliations: Affiliation[];
  exclude_funds: string[];
  filters: {
    stages_allowed: string[];
    ticket_min_usd: number | null;
    ticket_max_usd: number | null;
    geos: string[];
    require_known_stage: boolean;
  };
  weights: Record<FactorKey, number>;
  top_n: number;
  hop_penalty: number;
  max_hops: number;
};
export type Dashboard = {
  project: ProjectConfig['project'];
  founder: ProjectConfig['founder'];
  team?: TeamMember[];
  filters: ProjectConfig['filters'];
  weights: Record<FactorKey, number>;
  stats: Record<string, number>;
  readiness: Readiness[];
  latest_run_id: string | null;
  recommendations: Recommendation[];
  links?: FundLink[];
  outcomes: { stage: string; count: number }[];
};

export type OutcomeEvent = { stage: string; connector_id: string; note: string; ts: string };

const API = import.meta.env.VITE_API_URL || '';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.detail || `Error ${response.status}`);
  }
  return response.json() as Promise<T>;
}

const realApi = {
  dashboard: () => request<Dashboard>('/api/dashboard'),
  config: () => request<ProjectConfig>('/api/config'),
  saveConfig: (config: ProjectConfig) => request('/api/config', { method: 'PUT', body: JSON.stringify(config) }),
  run: () => request<{ run_id: string }>('/api/run', { method: 'POST', body: JSON.stringify({ resolve_entities: true, use_embeddings: false }) }),
  outcome: (investorId: string, stage: string, connector = '', note = '') =>
    request('/api/outcomes', { method: 'POST', body: JSON.stringify({ investor_id: investorId, stage, connector_id: connector, note }) }),
  history: (investorId: string) => request<OutcomeEvent[]>(`/api/outcomes/${encodeURIComponent(investorId)}`),
};

/** La cuenta demo responde desde el navegador (datos simulados); la cuenta real, desde el backend. */
export const api: typeof realApi = {
  dashboard: () => (isDemo() ? demoApi.dashboard() : realApi.dashboard()),
  config: () => (isDemo() ? demoApi.config() : realApi.config()),
  saveConfig: (config) => (isDemo() ? demoApi.saveConfig(config) : realApi.saveConfig(config)),
  run: () => (isDemo() ? demoApi.run() : realApi.run()),
  outcome: (...args) => (isDemo() ? demoApi.outcome(...args) : realApi.outcome(...args)),
  history: (id) => (isDemo() ? demoApi.history(id) : realApi.history(id)),
};
