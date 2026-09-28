import type { Dashboard, OutcomeEvent, ProjectConfig, Recommendation, WarmPath } from './api';

/* ───────────── Cuenta demo: todo simulado en el navegador, nunca toca el backend ───────────── */

export type AccountId = 'igc' | 'demo';
const ACCOUNT_KEY = 'warmpath-account';
const CONFIG_KEY = 'warmpath-demo-config';
const DASH_KEY = 'warmpath-demo-dashboard';
const HISTORY_KEY = 'warmpath-demo-history';

const read = <T,>(key: string): T | null => { try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : null; } catch { return null; } };
const write = (key: string, value: unknown) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* sin almacenamiento */ } };
const drop = (key: string) => { try { localStorage.removeItem(key); } catch { /* sin almacenamiento */ } };

export const currentAccount = (): AccountId => { try { return localStorage.getItem(ACCOUNT_KEY) === 'demo' ? 'demo' : 'igc'; } catch { return 'igc'; } };
export const isDemo = () => currentAccount() === 'demo';
export const switchAccount = (id: AccountId) => { try { localStorage.setItem(ACCOUNT_KEY, id); } catch { /* sin almacenamiento */ } };
/** Borra la empresa demo para volver a ver la cuenta en ceros. */
export const resetDemo = () => { [CONFIG_KEY, DASH_KEY, HISTORY_KEY, 'warmpath-demo-steps', 'warmpath-fit-dirty'].forEach(drop); };
export const demoConfig = () => read<ProjectConfig>(CONFIG_KEY);
export const demoOrgName = () => demoConfig()?.founder.org || demoConfig()?.project.name || 'Cuenta nueva';

export const blankConfig = (): ProjectConfig => ({
  project: { name: '', one_liner: '', description: '', sectors: [], keywords: [], stage: 'pre-seed', raise_usd: 1000000, geo: ['US'], funding_types: ['venture'] },
  founder: { name: '', title: '', email: '', linkedin_url: '', org: '' },
  comparables: [],
  team: [], contacts: [], affiliations: [], exclude_funds: [],
  filters: { stages_allowed: ['pre-seed', 'seed'], ticket_min_usd: 100000, ticket_max_usd: 1500000, geos: ['US', 'LATAM', 'GLOBAL'], require_known_stage: false },
  weights: { seed: 0.3, coinvest: 0.2, thesis: 0.25, path: 0.2, activity: 0.05 },
  top_n: 20, hop_penalty: 0.25, max_hops: 4,
});

/** Empresa de ejemplo (inventada) con la que arranca el onboarding: solo hay que revisar y continuar. */
export const sampleConfig = (): ProjectConfig => ({
  ...blankConfig(),
  project: {
    name: 'Aurora',
    one_liner: 'Wearable que mide el estrés y alerta riesgo temprano de neurodegeneración',
    description: 'Aurora combina señales de sueño, actividad y variabilidad cardiaca con evaluaciones cognitivas digitales para bajar el estrés y detectar señales tempranas de deterioro. Pilotos con 3 clínicas en Colombia y EE. UU.',
    sectors: ['mental health', 'wearables', 'digital health'],
    keywords: ['remote monitoring', 'measurement-based care', 'real-world evidence'],
    stage: 'pre-seed', raise_usd: 1500000, geo: ['US', 'CO'], funding_types: ['grant', 'venture'],
  },
  founder: { name: 'Valentina Ríos', title: 'CEO y cofundadora', email: 'valentina@andesneuro.example', linkedin_url: '', org: 'Andes Neuro Labs' },
  comparables: ['Calmwave', 'NeuroNest', 'Mindloop', 'Pulsely'].map((name) => ({ name, domain: '', sec_cik: '', aliases: [], why: '' })),
  team: [
    { name: 'Andrés Gómez', email: '', linkedin_url: '', org: 'Andes Neuro Labs', role: 'cofounder', shares_network: true, closeness: null },
    { name: 'Carolina Pérez', email: '', linkedin_url: '', org: 'Hospital Universitario', role: 'advisor', shares_network: false, closeness: null },
    { name: 'Grupo Andino Salud', email: '', linkedin_url: '', org: 'Grupo Andino Salud', role: 'grupo', shares_network: false, closeness: null },
  ],
  contacts: [{ name: 'Mateo Rincón', org: '', linkedin_url: '', known_by: 'Andrés Gómez', strength: 'fuerte', note: 'Excompañero de maestría' }],
  affiliations: [{ name: 'Universidad de los Andes', kind: 'universidad', members: [] }],
});

/* Nombres 100 % inventados: cualquier parecido con un fondo real es casual. */
const FUNDS: [string, string, string][] = [
  ['Cedar & Pike Ventures', 'Boston', 'MA'], ['Lumen Ridge Capital', 'San Francisco', 'CA'], ['Harbor Oak Bio Fund', 'Cambridge', 'MA'],
  ['Quillstone Ventures', 'New York', 'NY'], ['Brightwater Health Capital', 'Austin', 'TX'], ['Mesa Verde Seed', 'Denver', 'CO'],
  ['Orchard Loop Ventures', 'Palo Alto', 'CA'], ['Tidewater Life Sciences', 'Baltimore', 'MD'], ['Ironbark Capital', 'Chicago', 'IL'],
  ['Solace Health Fund', 'Nashville', 'TN'], ['Keystone Meadow VC', 'Philadelphia', 'PA'], ['Bluefin Clinical Ventures', 'San Diego', 'CA'],
  ['Juniper Arc Partners', 'Seattle', 'WA'], ['Copperline Seed', 'Miami', 'FL'], ['Halcyon Care Ventures', 'Atlanta', 'GA'],
  ['Starling Bio Partners', 'Raleigh', 'NC'], ['Redwood Signal Capital', 'Los Angeles', 'CA'], ['Aster Vale Ventures', 'Minneapolis', 'MN'],
  ['Northpoint Pulse Fund', 'New Haven', 'CT'], ['Granite Wave Health', 'Salt Lake City', 'UT'], ['Silverleaf Therapeutics Fund', 'Princeton', 'NJ'],
  ['Prairie Light Ventures', 'Kansas City', 'MO'], ['Marigold Seed Capital', 'Brooklyn', 'NY'], ['Evergreen Loop Health', 'Portland', 'OR'],
];
const FIRST = ['Laura', 'Daniel', 'Priya', 'Marcus', 'Elena', 'Tomás', 'Hannah', 'Kenji', 'Sofía', 'Owen', 'Amara', 'Lucas', 'Nadia', 'Ethan', 'Irene', 'Gabriel'];
const LAST = ['Whitfield', 'Okafor', 'Castellanos', 'Brennan', 'Lindqvist', 'Moreau', 'Ashby', 'Takeda', 'Valdés', 'Hartley', 'Mensah', 'Rourke', 'Ferreira', 'Kowalski'];
const CONNECTORS = ['Andrea Salcedo', 'Mateo Rincón', 'Julia Brandt', 'Samuel Ortiz', 'Clara Webb', 'Diego Montaño'];

/** Generador determinista (mismo proyecto → mismos resultados). */
function rng(seed: string) {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
}
const slug = (s: string) => s.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function pathTo(cfg: ProjectConfig, fund: string, partner: string, r: () => number, i: number): WarmPath | null {
  const founder = cfg.founder.name || 'Tú';
  const team = cfg.team.filter((m) => m.name.trim());
  const contactAt = cfg.contacts.find((c) => c.org && c.org.toLowerCase() === fund.toLowerCase());
  const hop = (from: string, to: string, s: number, rel: string, evidence: string, hypothesis = false) =>
    ({ from: `p:${slug(from)}`, from_name: from, to: `p:${slug(to)}`, to_name: to, s, rel, hypothesis, evidence, sources: [rel === 'team' ? 'config' : 'linkedin'] });
  let hops;
  if (contactAt) {
    const knower = contactAt.known_by || founder;
    hops = [...(knower !== founder ? [hop(founder, knower, 0.9, 'team', 'Equipo declarado en Configuración')] : []),
      hop(knower, contactAt.name, contactAt.strength === 'fuerte' ? 0.8 : contactAt.strength === 'media' ? 0.55 : 0.3, 'knows', `Declarado: ${knower} conoce a ${contactAt.name}`),
      { ...hop(contactAt.name, fund, 0.7, 'partner_of', `Declarado: ${contactAt.name} trabaja en ${fund}`), to: `f:${slug(fund)}` }];
  } else if (i % 3 === 2) {
    return null;
  } else {
    const viaTeam = team.length && i % 2 === 1 ? team[i % team.length] : null;
    const connector = CONNECTORS[i % CONNECTORS.length];
    const s1 = Math.round((0.45 + r() * 0.4) * 100) / 100;
    hops = [...(viaTeam ? [hop(founder, viaTeam.name, 0.88, 'team', `Equipo (${viaTeam.role}) declarado en Configuración`)] : []),
      hop(viaTeam?.name || founder, connector, s1, 'knows', `${Math.round(6 + r() * 30)} mensajes LinkedIn en 24 meses; recíproco`),
      hop(connector, partner, Math.round((0.35 + r() * 0.35) * 100) / 100, i % 4 === 0 ? 'hypothesis' : 'co_director', i % 4 === 0 ? `HIPÓTESIS: ${connector} trabaja en una empresa del portafolio` : `Co-directores en un Form D (simulado)`, i % 4 === 0),
      { ...hop(partner, fund, 0.9, 'partner_of', `Socio en el Form D de ${fund} (simulado)`), to: `f:${slug(fund)}` }];
  }
  const ss = hops.map((h) => h.s);
  return {
    nodes: [hops[0].from, ...hops.map((h) => h.to)], hops,
    strength: Math.round(ss.reduce((a, b) => a * b, 1) * 1e4) / 1e4, weakest: Math.min(...ss), n_hops: hops.length,
    has_hypothesis: hops.some((h) => h.hypothesis), connector: hops.length >= 2 ? hops[0].to_name : null,
  };
}

/** Construye un dashboard creíble a partir de lo que el usuario llenó en el onboarding. */
export function buildDemoDashboard(cfg: ProjectConfig): Dashboard {
  const r = rng(`${cfg.project.name}|${cfg.project.sectors.join(',')}`);
  const runId = (() => { const d = new Date(); const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; })();
  const sectors = cfg.project.sectors.length ? cfg.project.sectors : ['health'];
  const partners = Array.from({ length: 16 }, (_, i) => `${FIRST[i % FIRST.length]} ${LAST[(i * 5) % LAST.length]}`);
  const pool = [...FUNDS].sort(() => r() - 0.5).slice(0, Math.min(cfg.top_n || 20, FUNDS.length));
  const recs: Recommendation[] = pool.map(([name, city, state], i) => {
    const fid = `f:${slug(name)}`;
    const people = [partners[i % partners.length], ...(i % 3 === 0 ? [partners[(i + 5) % partners.length]] : [])];
    const bp = pathTo(cfg, name, people[0], r, i);
    const factors = {
      seed: i < 4 ? Math.round((0.5 + r() * 0.5) * 100) / 100 : Math.round(r() * 0.3 * 100) / 100,
      coinvest: Math.round(r() * 0.8 * 100) / 100,
      thesis: Math.round((0.25 + r() * 0.6) * 100) / 100,
      path: bp ? Math.round(bp.strength * (bp.has_hypothesis ? 0.5 : 1) * 1e4) / 1e4 : 0,
      activity: Math.round((0.4 + r() * 0.6) * 100) / 100,
    };
    const w = cfg.weights; const tot = Object.values(w).reduce((a, b) => a + b, 0) || 1;
    const score = (Object.keys(factors) as (keyof typeof factors)[]).reduce((s, k) => s + (w[k] / tot) * factors[k], 0);
    const size = Math.round((40 + r() * 260)) * 1e6;
    const daysAgo = Math.round(r() * 200);
    const last = new Date(Date.now() - daysAgo * 864e5).toISOString().slice(0, 10);
    return {
      run_id: runId, rank: 0, fund_id: fid, name, score: Math.round(score * 1e4) / 1e4, factors, best_path: bp, outcome_stage: null,
      profile: {
        thesis: `Invertimos en ${sectors[i % sectors.length]} en etapas tempranas, con foco en equipos técnicos y evidencia clínica.`,
        thesis_quote: `“We back early-stage ${sectors[i % sectors.length]} founders building with real-world evidence.” (texto simulado)`,
        thesis_url: null, stages: i % 4 === 3 ? ['seed', 'series-a'] : ['pre-seed', 'seed'], sectors: sectors.slice(0, 3), geos: ['US'],
        ticket_min: i % 2 ? 250000 : null, ticket_max: i % 2 ? 1500000 : null, ticket_kind: i % 2 ? 'declared' : null,
        fund_size: size, last_activity: last, city: city.toUpperCase(), state, country: 'US',
        vehicle: `${name} Fund I, L.P.`, source_ref: 'simulado', source_date: last, total_sold: Math.round(size * (0.3 + r() * 0.6)),
      },
      people: people.map((p) => ({ name: p, key: p.toLowerCase() })),
    };
  }).sort((a, b) => b.score - a.score).map((rec, i) => ({ ...rec, rank: i + 1 }));

  const links = [] as { source: string; target: string; shared: string[] }[];
  recs.forEach((a, i) => recs.slice(i + 1).forEach((b) => {
    const shared = (a.people || []).filter((p) => (b.people || []).some((q) => q.key === p.key)).map((p) => p.name);
    if (shared.length) links.push({ source: a.fund_id, target: b.fund_id, shared });
  }));
  const teamN = cfg.team.filter((m) => m.name.trim()).length;
  return {
    project: cfg.project, founder: cfg.founder, team: cfg.team, filters: cfg.filters, weights: cfg.weights,
    stats: { provenance: 9412, entities: 6120 + teamN * 410, edges: 4230 + teamN * 380 + cfg.contacts.length * 4, interactions: 1248 + teamN * 520, fund_profile: 1874, review_queue: 3, outcomes: 0 },
    readiness: [
      { id: 'profile', label: 'Perfil de la empresa', ready: true, detail: 'Onboarding' },
      { id: 'comparables', label: 'Comparables', ready: cfg.comparables.length >= 3, detail: `${cfg.comparables.length} configurados` },
      { id: 'rounds', label: 'Rondas con evidencia', ready: true, detail: '38 rondas citadas (simulado)' },
      { id: 'funds', label: 'Universo de fondos', ready: true, detail: '1.874 perfiles' },
      { id: 'network', label: 'Red del founder', ready: true, detail: `${(1248 + teamN * 520).toLocaleString('es-CO')} interacciones` },
      { id: 'team', label: 'Equipo y red declarada', ready: teamN > 0 || cfg.contacts.length > 0, detail: `${teamN} personas · ${cfg.contacts.length} contactos` },
    ],
    latest_run_id: runId, recommendations: recs, links, outcomes: [],
  };
}

/* ───────────── "Backend" demo para api.ts ───────────── */
export const demoApi = {
  dashboard: async (): Promise<Dashboard> => {
    const d = read<Dashboard>(DASH_KEY);
    if (d) return d;
    const cfg = demoConfig();
    if (!cfg) throw new Error('La cuenta demo aún no tiene empresa configurada');
    const built = buildDemoDashboard(cfg); write(DASH_KEY, built); return built;
  },
  config: async () => demoConfig() || blankConfig(),
  saveConfig: async (cfg: ProjectConfig) => { write(CONFIG_KEY, cfg); return { status: 'saved' }; },
  run: async () => { const cfg = demoConfig() || blankConfig(); const d = buildDemoDashboard(cfg); const old = read<Dashboard>(DASH_KEY); if (old) keepOutcomes(old, d); write(DASH_KEY, d); return { run_id: d.latest_run_id || '' }; },
  outcome: async (investorId: string, stage: string, connector = '', note = '') => {
    const d = await demoApi.dashboard();
    const rec = d.recommendations.find((x) => x.fund_id === investorId); if (rec) rec.outcome_stage = stage;
    const counts = new Map<string, number>(); d.recommendations.forEach((x) => { if (x.outcome_stage) counts.set(x.outcome_stage, (counts.get(x.outcome_stage) || 0) + 1); });
    d.outcomes = [...counts].map(([s, count]) => ({ stage: s, count }));
    write(DASH_KEY, d);
    const hist = read<Record<string, OutcomeEvent[]>>(HISTORY_KEY) || {};
    hist[investorId] = [{ stage, connector_id: connector, note, ts: new Date().toISOString() }, ...(hist[investorId] || [])];
    write(HISTORY_KEY, hist);
    return { status: 'saved' };
  },
  history: async (investorId: string) => (read<Record<string, OutcomeEvent[]>>(HISTORY_KEY) || {})[investorId] || [],
};

function keepOutcomes(old: Dashboard, next: Dashboard) {
  const by = new Map(old.recommendations.map((r) => [r.fund_id, r.outcome_stage]));
  next.recommendations.forEach((r) => { r.outcome_stage = by.get(r.fund_id) || null; });
  next.outcomes = old.outcomes;
}
