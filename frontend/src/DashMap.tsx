import { ArrowRight, CalendarDays, CircleDollarSign, Gauge, Minus, Plus, RotateCcw } from 'lucide-react';
import { geoAlbers, geoCentroid, geoPath } from 'd3-geo';
import { select } from 'd3-selection';
import 'd3-transition';
import { zoom as d3zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from 'd3-zoom';
import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import type { FeatureCollection, Geometry } from 'geojson';
import statesTopo from 'us-atlas/states-10m.json';
import worldTopo from 'world-atlas/countries-50m.json';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Dashboard, Recommendation } from './api';
import { FOREIGN_REGIONS, STATE_NAMES, cleanPerson, compact, pct, placeOf } from './atlasModel';
import { placeLabels, useSize, type Box } from './atlasGeometry';
import { fmtDay, planContext } from './warmPlan';
import { Avatar, investorImage, money } from './ui';
import { COUNTY_MESH, GoldPin, STATE_MESH, US_NATION } from './mapKit';

type Named = { name: string };
const st = statesTopo as unknown as Topology<{ states: GeometryCollection<Named> }>;
const STATES = feature(st, st.objects.states) as FeatureCollection<Geometry, Named>;
const wt = worldTopo as unknown as Topology<{ countries: GeometryCollection<Named> }>;
const NEIGHBORS = (feature(wt, wt.objects.countries) as FeatureCollection<Geometry, Named>).features.filter((f) => ['124', '484'].includes(String(f.id)));
const ABBR = Object.fromEntries(Object.entries(STATE_NAMES).map(([a, n]) => [n, a]));
const STATE_BY_ABBR = new Map(STATES.features.map((f) => [ABBR[f.properties.name], f]));

const lonLatOf = (f: Recommendation): [number, number] | null => {
  const code = placeOf(f).code;
  const s = STATE_BY_ABBR.get(code);
  if (s) return geoCentroid(s) as [number, number];
  return FOREIGN_REGIONS[code]?.lonLat || null;
};
/** Fondo con la actividad más reciente (Form D más nuevo); desempata el ranking. */
export const latestActivityFund = (funds: Recommendation[]) =>
  funds.slice().sort((a, b) => (b.profile.last_activity || '').localeCompare(a.profile.last_activity || '') || a.rank - b.rank)[0];

export function DashMap({ data, funds, focusId, onOpen, showLinks = true, showLabels = true }: {
  data: Dashboard; funds: Recommendation[]; focusId: string | null; onOpen: (id: string) => void; showLinks?: boolean; showLabels?: boolean;
}) {
  const [ref, { w, h }] = useSize<HTMLDivElement>();
  const svgRef = useRef<SVGSVGElement>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const [tf, setTf] = useState<ZoomTransform>(zoomIdentity);
  const latest = useMemo(() => latestActivityFund(funds), [funds]);
  const [picked, setPicked] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  useEffect(() => { if (focusId) setPicked(focusId); }, [focusId]);
  const focus = funds.find((f) => f.fund_id === picked) || latest;
  const ctx = useMemo(() => planContext(data), [data]);
  const narrow = w < 720;

  /* Cámara cercana: el fondo en foco queda a la derecha (el mar queda fuera) y la tarjeta a la izquierda, sobre tierra. */
  const projection = useMemo(() => {
    if (!w || !h) return null;
    /* Encuadre fijo en grados alrededor del foco (≈ 900 km de ancho): el zoom no depende del tamaño de la pantalla. */
    const ll = focus ? lonLatOf(focus) : null;
    if (!ll) return geoAlbers().fitExtent([[0, 0], [w, h]], US_NATION);
    const [lon, lat] = ll;
    const box: FeatureCollection = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'MultiPoint', coordinates: narrow ? [[lon - 5, lat - 3], [lon + 3, lat + 3]] : [[lon - 9, lat - 3.2], [lon + 2.6, lat + 3.2]] } }] };
    const p = geoAlbers().fitExtent([[0, 0], [w, h]], box);
    const [x, y] = p(ll)!; const [tx, ty] = p.translate();
    p.translate([tx + (w * (narrow ? .62 : .72) - x), ty + (h * (narrow ? .3 : .42) - y)]);
    return p;
  }, [w, h, focus?.fund_id, narrow]); // eslint-disable-line react-hooks/exhaustive-deps
  const geo = useMemo(() => {
    if (!projection) return null;
    const path = geoPath(projection);
    return { land: path(US_NATION) || '', neighbors: NEIGHBORS.map((f) => path(f) || ''), counties: path(COUNTY_MESH) || '', states: path(STATE_MESH) || '' };
  }, [projection]);

  useEffect(() => {
    const svg = svgRef.current; if (!svg || !w || !h) return;
    const z = d3zoom<SVGSVGElement, unknown>().scaleExtent([.3, 4]).on('zoom', (e) => setTf(e.transform));
    zoomRef.current = z; select(svg).call(z).on('dblclick.zoom', null);
    return () => { select(svg).on('.zoom', null); };
  }, [w, h]);
  const resetView = () => { const svg = svgRef.current; const z = zoomRef.current; if (svg && z) select(svg).transition().duration(600).call(z.transform as never, zoomIdentity); };
  useEffect(resetView, [focus?.fund_id]); // eslint-disable-line react-hooks/exhaustive-deps
  const zoomBy = (f: number) => { const svg = svgRef.current; const z = zoomRef.current; if (svg && z) select(svg).transition().duration(300).call(z.scaleBy as never, f); };

  /* Pines: los fondos de un mismo estado se abren en abanico hacia tierra (oeste); el foco va en el centro. */
  const pins = useMemo(() => {
    if (!projection) return [];
    const byCode = new Map<string, Recommendation[]>();
    funds.forEach((f) => { const c = placeOf(f).code || '?'; byCode.set(c, [...(byCode.get(c) || []), f]); });
    const out: { f: Recommendation; x: number; y: number }[] = [];
    for (const members of byCode.values()) {
      const ll = lonLatOf(members[0]); if (!ll) continue;
      const [bx, by] = projection(ll)!;
      const ordered = members.slice().sort((a, b) => Number(b.fund_id === focus?.fund_id) - Number(a.fund_id === focus?.fund_id) || a.rank - b.rank);
      ordered.forEach((f, i) => {
        const r = i === 0 ? 0 : 66 * Math.sqrt(i); const a = Math.PI * (.52 + .96 * ((i * .618) % 1));
        out.push({ f, x: bx + Math.cos(a) * r, y: by + Math.sin(a) * r });
      });
    }
    return out;
  }, [projection, funds, focus?.fund_id]);

  if (!w || !h || !geo) return <div className="dm" ref={ref} />;
  const S = (x: number, y: number) => ({ x: tf.x + x * tf.k, y: tf.y + y * tf.k });
  const pos = new Map(pins.map((p) => [p.f.fund_id, S(p.x, p.y)]));
  const fp = focus ? pos.get(focus.fund_id) : undefined;

  /* Tarjeta a la izquierda; ruta del pin en foco hasta su borde derecho. */
  const cardW = Math.min(340, w - 32); const cardH = 296;
  const card = narrow ? { x: 16, y: h - cardH - 16 } : { x: 18, y: Math.max(16, Math.min(h - cardH - 16, (fp?.y || h / 2) + 40)) };
  const route = fp ? (() => {
    const ex = card.x + cardW; const ey = card.y + 70;
    if (narrow) return `M${fp.x},${fp.y + 4} L${fp.x},${card.y}`;
    const mx = ex + (fp.x - ex) * .45;
    const dy = ey > fp.y ? 1 : -1;
    return `M${fp.x - 4},${fp.y - 10} L${mx + 18},${fp.y - 10} Q${mx},${fp.y - 10} ${mx},${fp.y - 10 + 18 * dy} L${mx},${ey - 18 * dy} Q${mx},${ey} ${mx - 18},${ey} L${ex},${ey}`;
  })() : '';
  const peers = focus ? ctx.peersOf(focus.fund_id) : [];
  const peerRoutes = fp ? peers.map((p) => { const q = pos.get(p.fund_id); if (!q) return null; const mx = (fp.x + q.x) / 2; const my = Math.min(fp.y, q.y) - 36 - Math.abs(fp.x - q.x) * .12; return { id: p.fund_id, d: `M${fp.x},${fp.y - 17} Q${mx},${my} ${q.x},${q.y - 17}` }; }).filter(Boolean) as { id: string; d: string }[] : [];

  /* Etiquetas sin choques (nombre corto + afinidad) */
  const cardBox: Box = { x: card.x - 8, y: card.y - 8, w: cardW + 16, h: cardH + 16 };
  const pinBoxes: Box[] = [...pos.values()].map((p) => ({ x: p.x - 13, y: p.y - 36, w: 26, h: 38 }));
  const items = pins.map((p) => { const q = pos.get(p.f.fund_id)!; const on = p.f.fund_id === focus?.fund_id; const t = compact(p.f.name, on ? 30 : 22); return { id: p.f.fund_id, x: q.x, y: q.y - 24, w: Math.max(t.length * 7.3, 40) + 58, h: 28, force: on || p.f.fund_id === hover, title: t, pct: pct(p.f.score), on }; })
    .sort((a, b) => Number(b.force) - Number(a.force) || (funds.find((f) => f.fund_id === a.id)!.rank - funds.find((f) => f.fund_id === b.id)!.rank));
  const placed = !showLabels ? new Map<string, Box>(placeLabels(items.filter((i) => i.on), { x: 6, y: 6, w: w - 12, h: h - 12 }, [cardBox])) : placeLabels(items, { x: 6, y: 6, w: w - 12, h: h - 12 }, [cardBox, { x: 0, y: h - 140, w: 60, h: 140 }, ...pinBoxes]);

  const net = focus ? ctx.groupOf.get(focus.fund_id) : undefined;
  const people = (focus?.people || []).map((p) => cleanPerson(p.name));
  const ticket = focus && (focus.profile.ticket_min || focus.profile.ticket_max) ? `${money(focus.profile.ticket_min)}–${money(focus.profile.ticket_max)}` : focus?.profile.total_sold ? money(focus.profile.total_sold) : '—';
  const isLatest = focus?.fund_id === latest?.fund_id;

  return (
    <div className="dm" ref={ref}>
      <svg ref={svgRef} width={w} height={h} className="dm-svg" aria-label="Mapa de fondos">
        <g transform={tf.toString()} className="streets">
          {geo.neighbors.map((d, i) => <path key={i} d={d} className="st-land far" />)}
          <path d={geo.land} className="st-land" />
          <path d={geo.counties} className="st-road casing" style={{ strokeWidth: 4.2 / tf.k }} />
          <path d={geo.counties} className="st-road" style={{ strokeWidth: 2 / tf.k }} />
          <path d={geo.states} className="st-avenue casing" style={{ strokeWidth: 10.5 / tf.k }} />
          <path d={geo.states} className="st-avenue" style={{ strokeWidth: 6 / tf.k }} />
        </g>
        <g className="dm-routes">
          {showLinks && peerRoutes.map((r) => <g key={r.id}><path d={r.d} className="dm-peer casing" /><path d={r.d} className={`dm-peer ${hover === r.id ? 'on' : ''}`} /></g>)}
          {route && <><path d={route} className="dm-route casing" /><path d={route} className="dm-route" /></>}
        </g>
        {pins.map((p) => {
          const q = pos.get(p.f.fund_id)!; if (q.x < -40 || q.y < -40 || q.x > w + 40 || q.y > h + 60) return null;
          const on = p.f.fund_id === focus?.fund_id;
          return <g key={p.f.fund_id} className={`gp ${on ? 'on' : ''} ${peers.some((x) => x.fund_id === p.f.fund_id) ? 'peer' : ''}`} transform={`translate(${q.x},${q.y})`} role="button" tabIndex={0}
            onClick={() => setPicked(p.f.fund_id)} onMouseEnter={() => setHover(p.f.fund_id)} onMouseLeave={() => setHover(null)}
            onKeyDown={(e) => { if (e.key === 'Enter') setPicked(p.f.fund_id); }}>
            <title>{`${p.f.name} · ${placeOf(p.f).label} · ${pct(p.f.score)}`}</title>
            {on && <circle cx="0" cy="-30" r="34" className="gp-pulse" />}
            <g transform={`scale(${on ? 1.45 : 1.3})`}><GoldPin big={on} /></g>
          </g>;
        })}
        {items.map((it) => { const b = placed.get(it.id); return b ? <g key={it.id} className={`gp-tag ${it.on ? 'on' : ''}`} pointerEvents="none">
          <rect x={b.x} y={b.y} width={b.w} height={b.h} rx="7" />
          <text x={b.x + 10} y={b.y + 18.5}>{it.title}</text>
          <text x={b.x + b.w - 9} y={b.y + 18.5} textAnchor="end" className="pct">{it.pct}</text>
        </g> : null; })}
      </svg>

      {focus && <article className="dm-card" style={{ left: card.x, top: card.y, width: cardW }}>
        <header>
          <Avatar className="dm-card-logo" name={focus.name} src={investorImage(focus)} />
          <div><h3>{focus.name}</h3><p>{placeOf(focus).label} · <em>{isLatest ? 'Actividad más reciente' : `#${focus.rank} en tu ranking`}</em></p></div>
        </header>
        <div className="dm-stats">
          <span><Gauge size={15} /> {pct(focus.score)}</span>
          <span><CalendarDays size={15} /> {fmtDay(focus.profile.last_activity) || '—'}</span>
          <span><CircleDollarSign size={15} /> {ticket}</span>
        </div>
        <h4>{focus.profile.total_sold ? `Levantó ${money(focus.profile.total_sold)} en su última ronda` : 'Fondo activo en tu sector'}</h4>
        <ul>
          {net ? <li>Comparte socio con {net.size - 1} fondos de tu top ({net.lead}): son las rutas azules.</li> : focus.best_path ? <li>Warm path de {focus.best_path.n_hops} saltos ({Math.round(focus.best_path.strength * 100)}%).</li> : null}
          <li>{people.length ? `Contacto: ${people.slice(0, 2).join(', ')}${people.length > 2 ? ` +${people.length - 2}` : ''}.` : 'Sin contacto público todavía.'}</li>
        </ul>
        <button className="dm-cta" onClick={() => onOpen(focus.fund_id)}>Ver ficha y plan <ArrowRight size={15} /></button>
      </article>}

      <div className="dm-zoom">
        <button onClick={() => zoomBy(1.6)} aria-label="Acercar"><Plus size={15} /></button>
        <button onClick={() => zoomBy(1 / 1.6)} aria-label="Alejar"><Minus size={15} /></button>
        <button onClick={() => { setPicked(null); resetView(); }} aria-label="Volver al fondo más reciente"><RotateCcw size={14} /></button>
      </div>
    </div>
  );
}
