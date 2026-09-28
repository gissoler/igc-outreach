import { mesh, feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import type { FeatureCollection } from 'geojson';
import countiesTopo from 'us-atlas/counties-10m.json';

/* Capas "callejero" compartidas por el mapa del dashboard y el de Inversionistas:
   condados = calles, estados = avenidas (bordes internos de EE. UU.). */
const ct = countiesTopo as unknown as Topology<{ counties: GeometryCollection; states: GeometryCollection; nation: GeometryCollection }>;
export const US_NATION = feature(ct, ct.objects.nation) as FeatureCollection;
export const COUNTY_MESH = mesh(ct, ct.objects.counties, (a, b) => a !== b && (Number(a.id) / 1000 | 0) === (Number(b.id) / 1000 | 0));
export const STATE_MESH = mesh(ct, ct.objects.states, (a, b) => a !== b);

/** Pin dorado (mismo ícono en ambos mapas). La punta queda en (0,0). */
export function GoldPin({ count, big = false }: { count?: number; big?: boolean }) {
  const s = big ? 1.3 : 1;
  return <g transform={`scale(${s})`}>
    <ellipse cx="0" cy="1" rx="5" ry="2" className="gp-shadow" />
    <path d="M0 0 C-3 -6 -9 -10 -9 -17 A9 9 0 1 1 9 -17 C9 -10 3 -6 0 0 Z" className="gp-body" />
    {count && count > 1 ? <text x="0" y="-16.5" textAnchor="middle" dominantBaseline="central" className="gp-count">{count}</text> : <circle cx="0" cy="-17" r="3.4" className="gp-eye" />}
  </g>;
}
