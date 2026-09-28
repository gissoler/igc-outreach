import type { Dashboard, FactorKey, FundLink, Recommendation } from './api';

/** Modelo compartido por el Atlas y por "Próximos pasos": grupos, contactos y ubicación. */

export type GroupKey = 'network' | 'state' | 'signal';
export type Group = { id: string; label: string; detail: string; color: string; funds: Recommendation[] };

export const GROUP_OPTIONS: { id: GroupKey; label: string }[] = [
  { id: 'network', label: 'Socios en común' },
  { id: 'state', label: 'Ubicación' },
  { id: 'signal', label: 'Señal principal' },
];

/** Colores de grupo: variables CSS --g0…--g7 (definidas por tema en styles.css, paleta DECODE). */
export const PALETTE_SIZE = 8;

export const SIGNALS: { key: FactorKey; label: string }[] = [
  { key: 'seed', label: 'Comparables' },
  { key: 'coinvest', label: 'Co-inversión' },
  { key: 'thesis', label: 'Afinidad de tesis' },
  { key: 'path', label: 'Warm path' },
  { key: 'activity', label: 'Actividad reciente' },
];

export const STATE_NAMES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut',
  DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
  NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah',
  VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};
/** Códigos de Form D fuera de EE. UU. que usamos hoy (provincias de Canadá), con coordenadas de su ciudad principal. */
export const FOREIGN_REGIONS: Record<string, { label: string; lonLat: [number, number] }> = {
  A6: { label: 'Ontario, Canadá', lonLat: [-79.38, 43.65] },
  A1: { label: 'Alberta, Canadá', lonLat: [-114.07, 51.05] },
  A2: { label: 'Columbia Británica, Canadá', lonLat: [-123.12, 49.28] },
  A8: { label: 'Quebec, Canadá', lonLat: [-73.57, 45.5] },
};

export const cleanPerson = (name: string) => name.replace(/^N\/A\s+/i, '').replace(/,?\s*(Ltd|Inc|LLC)\.?$/i, '').trim();
export const titleCase = (value?: string | null) => (value || '').toLowerCase().replace(/\b\p{L}/gu, (c) => c.toUpperCase());
export const compact = (name: string, max = 26) => (name.length > max ? `${name.slice(0, max - 1).trimEnd()}…` : name);
export const pct = (value: number) => `${(value * 100).toLocaleString('es-CO', { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%`;

export const dominantSignal = (rec: Recommendation): FactorKey =>
  SIGNALS.reduce((best, s) => ((rec.factors[s.key] || 0) > (rec.factors[best] || 0) ? s.key : best), 'thesis' as FactorKey);

export function placeOf(rec: Recommendation) {
  const code = (rec.profile.state || '').toUpperCase();
  const city = titleCase(rec.profile.city);
  if (STATE_NAMES[code]) return { code, region: STATE_NAMES[code], city, label: city ? `${city}, ${code}` : STATE_NAMES[code] };
  const foreign = FOREIGN_REGIONS[code];
  if (foreign) return { code, region: foreign.label, city, label: city ? `${city}, ${foreign.label.split(',')[1]?.trim() || ''}` : foreign.label };
  return { code: '', region: 'Sin ubicación', city, label: city || 'Sin ubicación' };
}

/** Componentes conexos del grafo "comparten socio" → cada componente es un sindicato o red de socios. */
function networkGroups(funds: Recommendation[], links: FundLink[]) {
  const parent = new Map(funds.map((f) => [f.fund_id, f.fund_id]));
  const find = (id: string): string => { const p = parent.get(id)!; if (p === id) return id; const root = find(p); parent.set(id, root); return root; };
  for (const link of links) if (parent.has(link.source) && parent.has(link.target)) parent.set(find(link.source), find(link.target));
  const buckets = new Map<string, Recommendation[]>();
  for (const fund of funds) { const root = find(fund.fund_id); buckets.set(root, [...(buckets.get(root) || []), fund]); }
  const groups: Omit<Group, 'color'>[] = [];
  const loose: Recommendation[] = [];
  for (const [root, members] of buckets) {
    if (members.length < 2) { loose.push(...members); continue; }
    const counts = new Map<string, number>();
    const ids = new Set(members.map((m) => m.fund_id));
    for (const link of links) if (ids.has(link.source)) for (const person of link.shared) counts.set(person, (counts.get(person) || 0) + 1);
    const lead = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || members[0].name;
    groups.push({ id: `net:${root}`, label: cleanPerson(lead), detail: `${members.length} fondos con el mismo socio`, funds: members });
  }
  groups.sort((a, b) => b.funds.length - a.funds.length);
  if (loose.length) groups.push({ id: 'net:loose', label: 'Sin socios en común', detail: `${loose.length} fondos independientes`, funds: loose });
  return groups;
}

export function buildGroups(funds: Recommendation[], links: FundLink[], key: GroupKey): Group[] {
  let raw: Omit<Group, 'color'>[];
  if (key === 'network') raw = networkGroups(funds, links);
  else {
    const buckets = new Map<string, { label: string; funds: Recommendation[] }>();
    for (const fund of funds) {
      const id = key === 'state' ? placeOf(fund).region : dominantSignal(fund);
      const label = key === 'state' ? id : SIGNALS.find((s) => s.key === id)!.label;
      const bucket = buckets.get(id) || { label, funds: [] };
      bucket.funds.push(fund); buckets.set(id, bucket);
    }
    raw = [...buckets.entries()].map(([id, b]) => ({ id: `${key}:${id}`, label: b.label, detail: `${b.funds.length} fondos`, funds: b.funds }))
      .sort((a, b) => b.funds.length - a.funds.length);
  }
  return raw.map((g, i) => ({ ...g, color: g.id === 'net:loose' ? 'var(--g-loose)' : `var(--g${i % PALETTE_SIZE})` }));
}

export function useModelData(data: Dashboard, limit = 20) {
  const funds = data.recommendations.slice(0, limit);
  const ids = new Set(funds.map((f) => f.fund_id));
  const links = (data.links || []).filter((l) => ids.has(l.source) && ids.has(l.target));
  return { funds, links };
}

/* ── Geografía mundial: país y continente de cada fondo ── */
export type Continent = 'Norteamérica' | 'Sudamérica' | 'Europa' | 'Asia' | 'África' | 'Oceanía';
/** ISO2 → id numérico de world-atlas, nombre y continente (países frecuentes en capital de riesgo). */
export const COUNTRIES: Record<string, { id: string; name: string; continent: Continent }> = {
  US: { id: '840', name: 'Estados Unidos', continent: 'Norteamérica' }, CA: { id: '124', name: 'Canadá', continent: 'Norteamérica' },
  MX: { id: '484', name: 'México', continent: 'Norteamérica' }, CO: { id: '170', name: 'Colombia', continent: 'Sudamérica' },
  BR: { id: '076', name: 'Brasil', continent: 'Sudamérica' }, AR: { id: '032', name: 'Argentina', continent: 'Sudamérica' },
  CL: { id: '152', name: 'Chile', continent: 'Sudamérica' }, GB: { id: '826', name: 'Reino Unido', continent: 'Europa' },
  DE: { id: '276', name: 'Alemania', continent: 'Europa' }, FR: { id: '250', name: 'Francia', continent: 'Europa' },
  ES: { id: '724', name: 'España', continent: 'Europa' }, NL: { id: '528', name: 'Países Bajos', continent: 'Europa' },
  CH: { id: '756', name: 'Suiza', continent: 'Europa' }, SE: { id: '752', name: 'Suecia', continent: 'Europa' },
  IE: { id: '372', name: 'Irlanda', continent: 'Europa' }, IL: { id: '376', name: 'Israel', continent: 'Asia' },
  IN: { id: '356', name: 'India', continent: 'Asia' }, SG: { id: '702', name: 'Singapur', continent: 'Asia' },
  JP: { id: '392', name: 'Japón', continent: 'Asia' }, CN: { id: '156', name: 'China', continent: 'Asia' },
  AE: { id: '784', name: 'Emiratos Árabes', continent: 'Asia' }, AU: { id: '036', name: 'Australia', continent: 'Oceanía' },
  ZA: { id: '710', name: 'Sudáfrica', continent: 'África' }, NG: { id: '566', name: 'Nigeria', continent: 'África' },
  KE: { id: '404', name: 'Kenia', continent: 'África' },
};
/** Caja [oeste, sur, este, norte] de cada continente para hacer zoom. */
export const CONTINENT_BOX: Record<Continent, [number, number, number, number]> = {
  'Norteamérica': [-168, 8, -52, 72], 'Sudamérica': [-82, -56, -34, 13], 'Europa': [-11, 35, 40, 70],
  'Asia': [26, -10, 150, 60], 'África': [-18, -35, 52, 37], 'Oceanía': [110, -48, 180, -8],
};
export function countryOf(rec: Recommendation): string {
  const code = (rec.profile.state || '').toUpperCase();
  if (STATE_NAMES[code]) return 'US';
  if (FOREIGN_REGIONS[code]) return 'CA';
  const c = (rec.profile.country || '').toUpperCase();
  return COUNTRIES[c] ? c : '';
}
