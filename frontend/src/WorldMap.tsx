import { Minus, Plus, RotateCcw, Search } from 'lucide-react';
import { geoCentroid, geoNaturalEarth1, geoPath } from 'd3-geo';
import { select } from 'd3-selection';
import 'd3-transition';
import { zoom as d3zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from 'd3-zoom';
import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import type { FeatureCollection, Geometry } from 'geojson';
import worldTopo from 'world-atlas/countries-50m.json';
import usTopo from 'us-atlas/states-10m.json';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { Recommendation } from './api';
import {
  CONTINENT_BOX, COUNTRIES, FOREIGN_REGIONS, STATE_NAMES, compact, countryOf, pct, placeOf, type Continent, type Group,
} from './atlasModel';
import { placeLabels, type Box, type Point } from './atlasGeometry';

/* ── Geografía mundial (Natural Earth 1:50m) + estados de EE. UU. (Census 1:10m) ── */
type Named = { name: string };
const wt = worldTopo as unknown as Topology<{ countries: GeometryCollection<Named> }>;
const WORLD = feature(wt, wt.objects.countries) as FeatureCollection<Geometry, Named>;
const LAND: FeatureCollection<Geometry, Named> = { type: 'FeatureCollection', features: WORLD.features.filter((f) => f.id !== '010') };
const ut = usTopo as unknown as Topology<{ states: GeometryCollection<Named> }>;
const STATES = feature(ut, ut.objects.states) as FeatureCollection<Geometry, Named>;
const ABBR_BY_NAME = Object.fromEntries(Object.entries(STATE_NAMES).map(([abbr, name]) => [name, abbr]));
const STATE_BY_ABBR = new Map(STATES.features.map((f) => [ABBR_BY_NAME[f.properties.name], f]));
const COUNTRY_BY_ID = new Map(WORLD.features.map((f) => [String(f.id), f]));
const LOWER48_BOX: [number, number, number, number] = [-125, 24, -66, 50];

type Level = 'country' | 'region' | 'fund';
type Bubble = { id: string; label: string; lonLat: [number, number]; funds: Recommendation[]; zoomBox?: [number, number, number, number]; feature?: string };

type Props = {
  w: number; h: number;
  funds: Recommendation[];
  groupOf: Map<string, Group>;
  founder: { lonLat: [number, number]; label: string };
  focusId: string | null;
  hoverId: string | null;
  showLabels: boolean;
  showLinks: boolean;
  t: (score: number) => number;
  onHover: (id: string | null, p?: Point) => void;
  onSelect: (id: string) => void;
};

/** Mapa mundial con zoom: mundo → continente → país → estado → ciudad/fondo. */
export function WorldMap({ w, h, funds, groupOf, founder, focusId, hoverId, showLabels, showLinks, t, onHover, onSelect }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const [tf, setTf] = useState<ZoomTransform>(zoomIdentity);
  const [query, setQuery] = useState('');

  const projection = useMemo(() => geoNaturalEarth1().fitExtent([[12, 12], [Math.max(w - 12, 13), Math.max(h - 12, 13)]], LAND), [w, h]);
  const path = useMemo(() => geoPath(projection), [projection]);
  const countryPaths = useMemo(() => LAND.features.map((f, i) => ({ key: `${f.id ?? 'x'}-${i}`, id: String(f.id), d: path(f) || '' })), [path]);
  const statePaths = useMemo(() => STATES.features.map((f) => ({ id: String(f.id), abbr: ABBR_BY_NAME[f.properties.name], d: path(f) || '' })), [path]);

  /** Coordenadas de cada fondo: centroide de su estado (o región extranjera). Las ciudades se separan en pantalla. */
  const geo = useMemo(() => {
    const m = new Map<string, { lonLat: [number, number]; country: string; region: string; regionCode: string; city: string }>();
    for (const f of funds) {
      const place = placeOf(f); const country = countryOf(f);
      let lonLat: [number, number] = [0, 0];
      const st = STATE_BY_ABBR.get(place.code);
      if (st) lonLat = geoCentroid(st) as [number, number];
      else if (FOREIGN_REGIONS[place.code]) lonLat = FOREIGN_REGIONS[place.code].lonLat;
      else if (country && COUNTRY_BY_ID.get(COUNTRIES[country].id)) lonLat = geoCentroid(COUNTRY_BY_ID.get(COUNTRIES[country].id)!) as [number, number];
      m.set(f.fund_id, { lonLat, country, region: place.region, regionCode: place.code, city: place.city || place.region });
    }
    return m;
  }, [funds]);

  const k = tf.k;
  const level: Level = k < 2.4 ? 'country' : k < 7 ? 'region' : 'fund';
  const proj = (ll: [number, number]): Point => { const p = projection(ll) || [0, 0]; const [x, y] = tf.apply(p as [number, number]); return { x, y }; };
  const avg = (items: Recommendation[]): [number, number] => {
    const pts = items.map((f) => geo.get(f.fund_id)!.lonLat);
    return [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];
  };

  /* Zoom */
  useEffect(() => {
    const svg = svgRef.current; if (!svg || !w || !h) return;
    const z = d3zoom<SVGSVGElement, unknown>().scaleExtent([1, 60]).translateExtent([[-w * .2, -h * .2], [w * 1.2, h * 1.2]])
      .on('zoom', (e) => setTf(e.transform));
    zoomRef.current = z;
    select(svg).call(z);
    return () => { select(svg).on('.zoom', null); };
  }, [w, h]);
  const zoomToBox = (box: [number, number, number, number], maxK = 40) => {
    const svg = svgRef.current; const z = zoomRef.current; if (!svg || !z) return;
    const b = path.bounds({ type: 'MultiPoint', coordinates: [[box[0], box[1]], [box[2], box[3]], [box[0], box[3]], [box[2], box[1]]] });
    const dx = b[1][0] - b[0][0]; const dy = b[1][1] - b[0][1];
    const scale = Math.min(maxK, .82 / Math.max(dx / w, dy / h, 1e-6));
    const cx = (b[0][0] + b[1][0]) / 2; const cy = (b[0][1] + b[1][1]) / 2;
    select(svg).transition().duration(850).call(z.transform, zoomIdentity.translate(w / 2 - scale * cx, h / 2 - scale * cy).scale(scale));
  };
  const zoomToPoint = (ll: [number, number], scale = 14) => {
    const svg = svgRef.current; const z = zoomRef.current; if (!svg || !z) return;
    const p = projection(ll); if (!p) return;
    select(svg).transition().duration(850).call(z.transform, zoomIdentity.translate(w / 2 - scale * p[0], h / 2 - scale * p[1]).scale(scale));
  };
  const zoomBy = (factor: number) => { const svg = svgRef.current; const z = zoomRef.current; if (svg && z) select(svg).transition().duration(300).call(z.scaleBy, factor); };
  const reset = () => { const svg = svgRef.current; const z = zoomRef.current; if (svg && z) select(svg).transition().duration(750).call(z.transform, zoomIdentity); };
  const boxOfFeature = (f?: FeatureCollection['features'][number]): [number, number, number, number] | undefined => {
    if (!f) return undefined;
    const b = path.bounds(f); const p0 = projection.invert!(b[0]); const p1 = projection.invert!(b[1]);
    return p0 && p1 ? [p0[0], p1[1], p1[0], p0[1]] : undefined;
  };

  useEffect(() => {
    if (!focusId || !w) return;
    const g = geo.get(focusId); if (g) zoomToPoint(g.lonLat, 16);
  }, [focusId, w, h]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Agregación según el nivel de zoom */
  const bubbles: Bubble[] = useMemo(() => {
    const by = new Map<string, Recommendation[]>();
    const keyOf = (f: Recommendation) => { const g = geo.get(f.fund_id)!; return level === 'country' ? g.country || '?' : g.regionCode || g.country || '?'; };
    funds.forEach((f) => { const key = keyOf(f); by.set(key, [...(by.get(key) || []), f]); });
    return [...by.entries()].map(([key, items]) => {
      const g = geo.get(items[0].fund_id)!;
      if (level === 'country') {
        const info = COUNTRIES[key];
        return { id: `c:${key}`, label: info?.name || 'Sin país', lonLat: avg(items), funds: items, zoomBox: key === 'US' ? LOWER48_BOX : boxOfFeature(info ? COUNTRY_BY_ID.get(info.id) : undefined) };
      }
      return { id: `r:${key}`, label: g.region, lonLat: avg(items), funds: items, zoomBox: boxOfFeature(STATE_BY_ABBR.get(key)) };
    });
  }, [funds, geo, level, path]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Nivel fondo: cada ciudad es un punto; los fondos de una ciudad forman un anillo */
  const fundPoints = useMemo(() => {
    const m = new Map<string, Point>();
    if (level !== 'fund') return m;
    const byRegion = new Map<string, Recommendation[]>();
    funds.forEach((f) => { const r = geo.get(f.fund_id)!.regionCode || '?'; byRegion.set(r, [...(byRegion.get(r) || []), f]); });
    for (const items of byRegion.values()) {
      const center = proj(geo.get(items[0].fund_id)!.lonLat);
      const cities = [...new Set(items.map((f) => geo.get(f.fund_id)!.city))];
      cities.forEach((city, ci) => {
        const members = items.filter((f) => geo.get(f.fund_id)!.city === city);
        const cAngle = ci * 2.4; const cDist = ci === 0 ? 0 : 42;
        const cp = { x: center.x + Math.cos(cAngle) * cDist, y: center.y + Math.sin(cAngle) * cDist };
        const spread = members.length === 1 ? 0 : 18 + Math.sqrt(members.length) * 9;
        const goldenAngle = Math.PI * (3 - Math.sqrt(5));
        const phase = [...city].reduce((sum, char) => sum + char.charCodeAt(0), 0) * .13;
        members.forEach((f, i) => {
          if (members.length === 1) { m.set(f.fund_id, cp); return; }
          const distance = 8 + Math.sqrt((i + .65) / members.length) * spread;
          const angle = phase + i * goldenAngle;
          m.set(f.fund_id, { x: cp.x + Math.cos(angle) * distance, y: cp.y + Math.sin(angle) * distance * .72 });
        });
      });
    }
    return m;
  }, [level, funds, geo, tf, projection]); // eslint-disable-line react-hooks/exhaustive-deps

  const tu = proj(founder.lonLat);
  const arc = (a: Point, b: Point, bendK = .28) => {
    const dx = b.x - a.x; const dy = b.y - a.y; const dist = Math.hypot(dx, dy) || 1; const bend = Math.min(260, dist * bendK); const side = dx >= 0 ? 1 : -1;
    return `M${a.x},${a.y} Q${(a.x + b.x) / 2 + (dy / dist) * bend * side},${(a.y + b.y) / 2 - (dx / dist) * bend * side} ${b.x},${b.y}`;
  };
  const bestScore = (items: Recommendation[]) => Math.max(...items.map((f) => f.score));

  /* Navegación rápida */
  const continents = [...new Set(funds.map((f) => COUNTRIES[countryOf(f)]?.continent).filter(Boolean))] as Continent[];
  const countries = [...new Set(funds.map(countryOf).filter(Boolean))];
  const regions = [...new Map(funds.map((f) => { const g = geo.get(f.fund_id)!; return [g.regionCode, g.region] as const; })).entries()]
    .map(([code, name]) => ({ code, name, n: funds.filter((f) => geo.get(f.fund_id)!.regionCode === code).length }))
    .sort((a, b) => b.n - a.n).slice(0, 5);
  const matches = query.trim().length > 1 ? funds.filter((f) => f.name.toLowerCase().includes(query.toLowerCase())).slice(0, 6) : [];

  /* Etiquetas */
  const labelItems: { id: string; x: number; y: number; w: number; h: number; title: string; meta: string; force?: boolean; strong?: boolean }[] = [];
  const lw = (a: string, b: string) => Math.max(a.length * 6.3, b.length * 5.4) + 22;
  if (level !== 'fund') {
    bubbles.forEach((b) => { const p = proj(b.lonLat); const title = `${b.label} · ${b.funds.length} ${b.funds.length === 1 ? 'fondo' : 'fondos'}`; const meta = `Mejor: ${compact(b.funds[0].name, 22)} · ${pct(bestScore(b.funds))}`; labelItems.push({ id: b.id, x: p.x, y: p.y, w: lw(title, meta), h: 38, title, meta, force: true, strong: b.funds.length >= 3 }); });
  } else {
    funds.forEach((f) => { const p = fundPoints.get(f.fund_id); if (!p) return; const title = compact(f.name, 26); const meta = `${placeOf(f).label} · ${pct(f.score)}`; labelItems.push({ id: f.fund_id, x: p.x, y: p.y, w: lw(title, meta), h: 38, title, meta, force: f.fund_id === focusId }); });
  }
  labelItems.sort((a, b) => Number(b.force) - Number(a.force));
  const obstacles: Box[] = [{ x: tu.x - 40, y: tu.y - 40, w: 160, h: 80 }, { x: 0, y: 0, w: 430, h: 60 }, { x: w - 260, y: 0, w: 260, h: 60 }];
  const placed = showLabels ? placeLabels(labelItems, { x: 6, y: 6, w: w - 12, h: h - 12 }, obstacles) : new Map<string, Box>();

  return (
    <div className="world">
      <svg ref={svgRef} width={w} height={h} className={`world-svg level-${level}`}>
        <defs>
          <pattern id="world-dots" width="6" height="6" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".7" className="atlas-dot" /></pattern>
          <linearGradient id="world-land-gradient" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={w} y2={h}>
            <stop offset="0" stopColor="var(--a-land-1)" /><stop offset=".52" stopColor="var(--a-land-2)" /><stop offset="1" stopColor="var(--a-land-3)" />
          </linearGradient>
          <radialGradient id="world-active-gradient" gradientUnits="objectBoundingBox" cx="68%" cy="36%" r="85%">
            <stop offset="0" stopColor="var(--a-active-1)" /><stop offset=".55" stopColor="var(--a-active-2)" /><stop offset="1" stopColor="var(--a-active-3)" />
          </radialGradient>
          <radialGradient id="hot-glow"><stop offset="0" stopColor="var(--hot-1)" stopOpacity=".95" /><stop offset=".45" stopColor="var(--hot-2)" stopOpacity=".55" /><stop offset="1" stopColor="var(--hot-2)" stopOpacity="0" /></radialGradient>
          <linearGradient id="conn-grad" x1="0" x2="1"><stop offset="0" stopColor="var(--conn-0)" /><stop offset=".5" stopColor="var(--conn-1)" /><stop offset="1" stopColor="var(--conn-2)" /></linearGradient>
        </defs>
        <g transform={tf.toString()}>
          {countryPaths.map((c) => {
            const has = countries.some((iso) => COUNTRIES[iso].id === c.id);
            return <path key={c.key} d={c.d} className={`world-country ${has && level === 'country' ? 'active' : ''} ${has ? 'has' : ''}`} />;
          })}
          <g className="world-states" style={{ opacity: Math.min(1, Math.max(0, (k - 1.6) / 1.4)) }}>
            {statePaths.map((s, i) => <path key={`${s.id}-${i}`} d={s.d} className={funds.some((f) => geo.get(f.fund_id)!.regionCode === s.abbr) ? 'active' : ''} />)}
          </g>
        </g>
        <rect x="0" y="0" width={w} height={h} fill="url(#world-dots)" pointerEvents="none" opacity=".5" />

        {showLinks && <g className="atlas-arcs">
          {level !== 'fund'
            ? bubbles.map((b) => { const p = proj(b.lonLat); return <path key={b.id} d={arc(tu, p)} className="arc" style={{ '--w': 1 + t(bestScore(b.funds)) * 2.2, stroke: `color-mix(in srgb, var(--conn-2) ${Math.round(t(bestScore(b.funds)) * 100)}%, var(--conn-0))` } as CSSProperties} />; })
            : funds.map((f) => { const p = fundPoints.get(f.fund_id); if (!p) return null; return <path key={f.fund_id} d={arc(tu, p, .18)} className={`arc ${hoverId === f.fund_id || focusId === f.fund_id ? 'on' : ''}`} style={{ '--w': .8 + t(f.score) * 1.6, stroke: `color-mix(in srgb, var(--conn-2) ${Math.round(t(f.score) * 100)}%, var(--conn-0))` } as CSSProperties} />; })}
        </g>}

        <g className="atlas-founder">
          <circle cx={tu.x} cy={tu.y} r="44" className="atlas-founder-halo" />
          <circle cx={tu.x} cy={tu.y} r="24" className="atlas-founder-ring" />
          <circle cx={tu.x} cy={tu.y} r="13" className="atlas-founder-core" />
          <circle cx={tu.x} cy={tu.y} r="4" className="atlas-founder-eye" />
          <text x={tu.x + 32} y={tu.y - 2} className="atlas-founder-name">Tú</text>
          <text x={tu.x + 32} y={tu.y + 13} className="atlas-founder-sub">{founder.label.toUpperCase()}</text>
        </g>

        {level !== 'fund' ? bubbles.map((b) => {
          const p = proj(b.lonLat); const r = 7 + Math.sqrt(b.funds.length) * 5;
          return <g key={b.id} className="world-bubble" role="button" tabIndex={0} aria-label={`${b.label}: ${b.funds.length} fondos. Acercar`}
            onClick={() => b.zoomBox ? zoomToBox(b.zoomBox, level === 'country' ? 6 : 40) : zoomToPoint(b.lonLat, level === 'country' ? 4 : 10)}
            onKeyDown={(e) => { if (e.key === 'Enter') b.zoomBox ? zoomToBox(b.zoomBox) : zoomToPoint(b.lonLat); }}>
            <circle cx={p.x} cy={p.y} r={r * 2.6} fill="url(#hot-glow)" pointerEvents="none" />
            <circle cx={p.x} cy={p.y} r={r} className="core" />
            <text x={p.x} y={p.y} textAnchor="middle" dominantBaseline="central">{b.funds.length}</text>
          </g>;
        }) : funds.map((f) => {
          const p = fundPoints.get(f.fund_id); if (!p) return null;
          const color = groupOf.get(f.fund_id)?.color || 'var(--g-loose)'; const r = 4 + t(f.score) * 4;
          const on = hoverId === f.fund_id || focusId === f.fund_id;
          return <g key={f.fund_id} className={`atlas-node ${on ? 'on' : ''} ${focusId === f.fund_id ? 'focus' : ''}`} style={{ '--c': color } as CSSProperties} role="button" tabIndex={0}
            onMouseEnter={() => onHover(f.fund_id, p)} onMouseLeave={() => onHover(null)} onClick={() => onSelect(f.fund_id)}
            onKeyDown={(e) => { if (e.key === 'Enter') onSelect(f.fund_id); }}>
            {focusId === f.fund_id && <circle cx={p.x} cy={p.y} r={r + 16} className="atlas-pulse" />}
            <circle cx={p.x} cy={p.y} r={r + 5} className="atlas-node-ring" />
            <circle cx={p.x} cy={p.y} r={r} className="atlas-node-core" />
            <circle cx={p.x} cy={p.y} r={Math.max(1.4, r * .34)} className="atlas-node-eye" />
            <circle cx={p.x} cy={p.y} r={r + 10} fill="transparent" />
          </g>;
        })}

        {labelItems.map((it) => { const box = placed.get(it.id); return box ? (
          <g key={it.id} className={`atlas-callout ${it.strong ? 'strong' : ''}`} pointerEvents="none">
            <rect x={box.x} y={box.y} width={box.w} height={box.h} rx="5" />
            <text x={box.x + 10} y={box.y + 16}>{it.title}</text>
            <text x={box.x + 10} y={box.y + 30} className="meta">{it.meta}</text>
          </g>) : null; })}
      </svg>

      <nav className="world-nav" aria-label="Zonas">
        <button onClick={reset}>Mundo</button>
        {continents.map((c) => <button key={c} onClick={() => zoomToBox(CONTINENT_BOX[c], 8)}>{c}</button>)}
        {countries.map((c) => <button key={c} onClick={() => zoomToBox(c === 'US' ? LOWER48_BOX : boxOfFeature(COUNTRY_BY_ID.get(COUNTRIES[c].id)) || CONTINENT_BOX[COUNTRIES[c].continent], 10)}>{COUNTRIES[c].name}</button>)}
        {regions.map((r) => <button key={r.code} onClick={() => { const b = boxOfFeature(STATE_BY_ABBR.get(r.code)); if (b) zoomToBox(b, 40); else { const f = funds.find((x) => geo.get(x.fund_id)!.regionCode === r.code); if (f) zoomToPoint(geo.get(f.fund_id)!.lonLat, 12); } }}>{r.name} <b>{r.n}</b></button>)}
      </nav>
      <div className="world-search">
        <Search size={15} />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar inversionista" aria-label="Buscar inversionista" />
        {matches.length > 0 && <ul>{matches.map((f) => <li key={f.fund_id}><button onClick={() => { setQuery(''); zoomToPoint(geo.get(f.fund_id)!.lonLat, 16); onHover(null); setTimeout(() => onSelect(f.fund_id), 900); }}><b>{compact(f.name, 30)}</b><small>{placeOf(f).label} · {pct(f.score)}</small></button></li>)}</ul>}
      </div>
      <div className="world-zoom">
        <button onClick={() => zoomBy(1.8)} aria-label="Acercar"><Plus size={16} /></button>
        <button onClick={() => zoomBy(1 / 1.8)} aria-label="Alejar"><Minus size={16} /></button>
        <button onClick={reset} aria-label="Ver el mundo"><RotateCcw size={15} /></button>
      </div>
      <div className="world-level">{level === 'country' ? 'Vista por país' : level === 'region' ? 'Vista por estado / región' : 'Vista por ciudad y fondo'} · rueda o pellizca para hacer zoom</div>
    </div>
  );
}
