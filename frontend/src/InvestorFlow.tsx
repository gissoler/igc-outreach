import { ArrowUpRight, ChevronDown, GitBranch, List, Map as MapIcon, Network } from 'lucide-react';
import { geoAlbers, geoPath } from 'd3-geo';
import { linkHorizontal } from 'd3-shape';
import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import usAtlas from 'us-atlas/states-10m.json';
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import type { Dashboard, Recommendation } from './api';
import {
  FOREIGN_REGIONS, GROUP_OPTIONS, STATE_NAMES, buildGroups, cleanPerson, compact, pct, placeOf, useModelData,
  type Group, type GroupKey,
} from './atlasModel';
import { placeLabels, useSize, type Box, type Point } from './atlasGeometry';
import { WorldMap } from './WorldMap';
import { DashMap } from './DashMap';

export type ViewMode = 'map' | 'chord' | 'tree' | 'table';
type Hover = { id: string; x: number; y: number } | null;

const VIEWS: { id: ViewMode; label: string; icon: typeof MapIcon }[] = [
  { id: 'map', label: 'Mapa', icon: MapIcon },
  { id: 'chord', label: 'Chord', icon: Network },
  { id: 'tree', label: 'Jerárquica', icon: GitBranch },
  { id: 'table', label: 'Tabla', icon: List },
];

/* ── Geografía: EE. UU. continental (us-atlas, Census 1:10m) ── */
type StateProps = { name: string };
const topo = usAtlas as unknown as Topology<{ states: GeometryCollection<StateProps> }>;
const ALL_STATES = feature(topo, topo.objects.states) as FeatureCollection<Geometry, StateProps>;
const LOWER48: FeatureCollection<Geometry, StateProps> = {
  type: 'FeatureCollection',
  features: ALL_STATES.features.filter((f) => !['02', '15', '60', '66', '69', '72', '78'].includes(String(f.id))),
};
const ABBR_BY_NAME = Object.fromEntries(Object.entries(STATE_NAMES).map(([abbr, name]) => [name, abbr]));
const FOUNDER_HOME: Record<string, { label: string; anchor: [number, number]; lonLat: [number, number] }> = {
  CO: { label: 'Bogotá, CO', anchor: [-80.2, 25.8], lonLat: [-74.07, 4.71] },
  MX: { label: 'Ciudad de México', anchor: [-99.1, 26.5], lonLat: [-99.13, 19.43] },
};

type Props = {
  data: Dashboard;
  /** preview = tarjeta del dashboard (vista rápida); full = página dedicada "Red". */
  mode?: 'preview' | 'full';
  /** Clic en un fondo: en el dashboard lleva al módulo Inversionistas; en el módulo abre el panel lateral. */
  onSelect: (id: string) => void;
  /** Solo en el módulo: fondo seleccionado, contenido de la vista Tabla y panel lateral con la ficha. */
  selectedId?: string | null;
  table?: ReactNode;
  side?: ReactNode;
  initialView?: ViewMode;
  onViewChange?: (view: ViewMode) => void;
  onExplore?: () => void;
  /** Fondo a ubicar en el mapa (p. ej. al hacer clic en el leaderboard). */
  focusId?: string | null;
};

export function InvestorFlow({ data, mode = 'preview', onSelect, onExplore, focusId: focusProp = null, selectedId = null, table, side, initialView = 'map', onViewChange }: Props) {
  const full = mode === 'full';
  const [view, setViewState] = useState<ViewMode>(initialView);
  const setView = (v: ViewMode) => { setViewState(v); onViewChange?.(v); };
  const [groupKey, setGroupKey] = useState<GroupKey>('network');
  const [showLinks, setShowLinks] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [hover, setHover] = useState<Hover>(null);
  const focusId = selectedId || focusProp;
  useEffect(() => { if (focusProp) setViewState('map'); }, [focusProp]);
  const [focusGroup, setFocusGroup] = useState<string | null>(null);
  const [canvasRef, { w, h }] = useSize<HTMLDivElement>();

  /* Filtros del dashboard: top N, dimensiones, solo activos y leyenda arriba */
  const [topN, setTopN] = useState(20);
  const dims = 2 as 1 | 2;
  const [onlyActive, setOnlyActive] = useState(false);
  const [legendTop, setLegendTop] = useState(false);
  const model = useModelData(data, full ? 20 : topN);
  const funds = useMemo(() => {
    if (full || !onlyActive) return model.funds;
    const newest = model.funds.map((f) => f.profile.last_activity || '').sort().at(-1) || '';
    const cut = newest ? new Date(new Date(`${newest.slice(0, 10)}T12:00:00`).getTime() - 45 * 864e5).toISOString().slice(0, 10) : '';
    return model.funds.filter((f) => (f.profile.last_activity || '') >= cut);
  }, [model.funds, full, onlyActive]);
  const links = useMemo(() => { const ids = new Set(funds.map((f) => f.fund_id)); return model.links.filter((l) => ids.has(l.source) && ids.has(l.target)); }, [funds, model.links]);
  const groups = useMemo(() => (!full && dims === 1
    ? [{ id: 'all', label: 'Todos los fondos', detail: `${funds.length} fondos`, color: 'var(--g0)', funds }]
    : buildGroups(funds, links, groupKey)), [funds, links, groupKey, dims, full]);
  const groupOf = useMemo(() => { const m = new Map<string, Group>(); groups.forEach((g) => g.funds.forEach((f) => m.set(f.fund_id, g))); return m; }, [groups]);
  const [lo, hi] = useMemo(() => { const s = funds.map((f) => f.score); return s.length ? [Math.min(...s), Math.max(...s)] : [0, 1]; }, [funds]);
  const t = (score: number) => (hi > lo ? (score - lo) / (hi - lo) : 1);
  const radius = (fund: Recommendation) => 3.6 + t(fund.score) * 4.4;
  const linkedTo = useMemo(() => {
    const m = new Map<string, Set<string>>();
    links.forEach((l) => { (m.get(l.source) || m.set(l.source, new Set()).get(l.source)!).add(l.target); (m.get(l.target) || m.set(l.target, new Set()).get(l.target)!).add(l.source); });
    return m;
  }, [links]);

  const hoverFund = hover ? funds.find((f) => f.fund_id === hover.id) : undefined;
  const isDim = (fund: Recommendation) => {
    if (focusGroup) return groupOf.get(fund.fund_id)?.id !== focusGroup;
    if (hover) return hover.id !== fund.fund_id && !linkedTo.get(hover.id)?.has(fund.fund_id);
    return false;
  };
  const founderGeo = data.project.geo.find((g) => FOUNDER_HOME[g]);
  const founderLabel = founderGeo ? FOUNDER_HOME[founderGeo].label : data.project.name;

  const nodeHandlers = (fund: Recommendation, p: Point) => ({
    role: 'button' as const, tabIndex: 0, 'aria-label': `${fund.name}, afinidad ${pct(fund.score)}`,
    onMouseEnter: () => setHover({ id: fund.fund_id, x: p.x, y: p.y }),
    onMouseLeave: () => setHover(null),
    onFocus: () => setHover({ id: fund.fund_id, x: p.x, y: p.y }),
    onBlur: () => setHover(null),
    onClick: () => { setHover(null); onSelect(fund.fund_id); },
    onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(fund.fund_id); } },
  });

  const fundNode = ({ fund, p, big = false }: { fund: Recommendation; p: Point; big?: boolean }) => {
    const color = groupOf.get(fund.fund_id)?.color || 'var(--g-loose)';
    const r = radius(fund) + (big ? 1.5 : 0);
    const top = fund.rank <= 3;
    return (
      <g key={fund.fund_id} className={`atlas-node ${isDim(fund) ? 'dim' : ''} ${hover?.id === fund.fund_id ? 'on' : ''}`} style={{ '--c': color } as CSSProperties} {...nodeHandlers(fund, p)}>
        {top && <circle cx={p.x} cy={p.y} r={r + 13} className="atlas-node-glow" />}
        <circle cx={p.x} cy={p.y} r={r + 5} className="atlas-node-ring" />
        <circle cx={p.x} cy={p.y} r={r} className="atlas-node-core" />
        <circle cx={p.x} cy={p.y} r={Math.max(1.4, r * .34)} className="atlas-node-eye" />
        <circle cx={p.x} cy={p.y} r={r + 10} fill="transparent" />
      </g>
    );
  };

  const founderNode = ({ p, label, sub, labelSide = 'right' }: { p: Point; label: string; sub?: string; labelSide?: 'right' | 'below' }) => (
    <g className="atlas-founder" aria-label="Tú">
      <circle cx={p.x} cy={p.y} r="46" className="atlas-founder-halo" />
      <circle cx={p.x} cy={p.y} r="28" className="atlas-founder-ring" />
      <circle cx={p.x} cy={p.y} r="15" className="atlas-founder-core" />
      <circle cx={p.x} cy={p.y} r="4.5" className="atlas-founder-eye" />
      {labelSide === 'right'
        ? <><text x={p.x + 36} y={p.y - 2} className="atlas-founder-name">{label}</text>{sub && <text x={p.x + 36} y={p.y + 14} className="atlas-founder-sub">{sub}</text>}</>
        : <><text x={p.x} y={p.y + 50} textAnchor="middle" className="atlas-founder-name">{label}</text>{sub && <text x={p.x} y={p.y + 65} textAnchor="middle" className="atlas-founder-sub">{sub}</text>}</>}
    </g>
  );

  const labelBox = ({ box, title, meta, strong = false }: { box: Box; title: string; meta: string; strong?: boolean }) => (
    <g className={`atlas-callout ${strong ? 'strong' : ''}`} pointerEvents="none">
      <rect x={box.x} y={box.y} width={box.w} height={box.h} rx="4" />
      <text x={box.x + 9} y={box.y + 15}>{title}</text>
      <text x={box.x + 9} y={box.y + 29} className="meta">{meta}</text>
    </g>
  );
  const labelWidth = (text: string, meta: string) => Math.max(text.length * 6.1, meta.length * 5.3) + 20;

  /* ───────── Mapa ───────── */
  const mapModel = useMemo(() => {
    if (!w || !h) return null;
    const byPlace = new Map<string, Recommendation[]>();
    funds.forEach((f) => { const code = placeOf(f).code || '?'; byPlace.set(code, [...(byPlace.get(code) || []), f]); });
    const hotCode = [...byPlace.entries()].sort((a, b) => b[1].length - a[1].length || a[1][0].rank - b[1][0].rank)[0]?.[0];
    const projection = geoAlbers().fitExtent([[28, 26], [w - 28, h - 84]], LOWER48);
    // En el dashboard acercamos la cámara al clúster con más fondos. La vista
    // completa conserva el encuadre mundial y sus controles de zoom.
    if (!full && hotCode && STATE_NAMES[hotCode]) {
      const hotFeature = LOWER48.features.find((f) => ABBR_BY_NAME[f.properties.name] === hotCode);
      if (hotFeature) {
        const basePath = geoPath(projection);
        const [hx, hy] = basePath.centroid(hotFeature);
        const [tx, ty] = projection.translate();
        const zoom = w < 700 ? 1.7 : 2.15;
        const target = { x: w * .58, y: h * .44 };
        projection.scale(projection.scale() * zoom).translate([
          target.x - zoom * (hx - tx),
          target.y - zoom * (hy - ty),
        ]);
      }
    }
    const path = geoPath(projection);
    const centroids = new Map<string, Point>();
    LOWER48.features.forEach((f) => { const abbr = ABBR_BY_NAME[f.properties.name]; const [x, y] = path.centroid(f); if (abbr) centroids.set(abbr, { x, y }); });
    // Ajustes finos de centroides que caen mal en estados irregulares
    const nudge = (abbr: string, dx: number, dy: number) => { const c = centroids.get(abbr); if (c) centroids.set(abbr, { x: c.x + dx, y: c.y + dy }); };
    nudge('FL', 18, 10); nudge('MI', 10, 16); nudge('LA', -8, 0);
    const positions = new Map<string, Point>();
    const clusters: { code: string; center: Point; ring: number; funds: Recommendation[] }[] = [];
    for (const [code, members] of byPlace) {
      let center = centroids.get(code);
      if (!center && FOREIGN_REGIONS[code]) { const p = projection(FOREIGN_REGIONS[code].lonLat); if (p) center = { x: p[0], y: p[1] }; }
      if (!center) center = { x: w * .5, y: 40 };
      const ring = members.length === 1 ? 0 : 18 + Math.sqrt(members.length) * 8;
      const goldenAngle = Math.PI * (3 - Math.sqrt(5));
      const phase = [...code].reduce((sum, char) => sum + char.charCodeAt(0), 0) * .17;
      members.forEach((f, i) => {
        if (members.length === 1) { positions.set(f.fund_id, center!); return; }
        const distance = 8 + Math.sqrt((i + .65) / members.length) * ring;
        const angle = phase + i * goldenAngle;
        positions.set(f.fund_id, {
          x: center!.x + Math.cos(angle) * distance,
          y: center!.y + Math.sin(angle) * distance * .72,
        });
      });
      clusters.push({ code, center, ring, funds: members });
    }
    const anchor = founderGeo ? projection(FOUNDER_HOME[founderGeo].anchor) : null;
    const founder = { x: Math.min(w - 150, Math.max(90, anchor ? anchor[0] : w * .62)), y: h - 50 };
    const activeStates = new Map<string, number>();
    funds.forEach((f) => { const c = placeOf(f).code; if (STATE_NAMES[c]) activeStates.set(c, (activeStates.get(c) || 0) + 1); });
    const hot = clusters.slice().sort((a, b) => b.funds.length - a.funds.length)[0];
    return { path, centroids, positions, clusters, founder, activeStates, hot };
  }, [w, h, funds, founderGeo, full]);

  const renderMap = () => {
    if (!mapModel) return null;
    const { path, centroids, positions, clusters, founder, activeStates } = mapModel;
    const bounds = { x: 8, y: 8, w: w - 16, h: h - 16 };
    const founderBox: Box = { x: founder.x - 50, y: founder.y - 50, w: 200, h: 100 };
    const star = funds.find((f) => f.fund_id === focusId) || funds[0];
    const hot = clusters.slice().sort((a, b) => b.funds.length - a.funds.length)[0];
    const items = clusters.slice().sort((a, b) => b.funds.length - a.funds.length || a.funds[0].rank - b.funds[0].rank).flatMap((c) => {
      if (c === hot && c.funds.length >= 2) {
        const place = placeOf(c.funds[0]);
        const title = `${place.region} · ${c.funds.length} fondos`;
        const meta = `Top: ${compact(c.funds[0].name, 24)}`;
        return [{ id: `c:${c.code}`, x: c.center.x + c.ring * .72, y: c.center.y - c.ring * .72, w: labelWidth(title, meta), h: 36, force: true, title, meta, strong: true }];
      }
      if (!full && c.funds.length >= 2) {
        const title = `${placeOf(c.funds[0]).region} · ${c.funds.length} fondos`; const meta = `Top: ${compact(c.funds[0].name, 24)}`;
        return [{ id: `c:${c.code}`, x: c.center.x + c.ring * .72, y: c.center.y - c.ring * .72, w: labelWidth(title, meta), h: 36, force: false, title, meta, strong: false }];
      }
      if (!full) return c.funds.map((f) => { const p = positions.get(f.fund_id)!; const title = compact(f.name, 24); const meta = `${placeOf(f).label} · ${pct(f.score)}`; return { id: f.fund_id, x: p.x, y: p.y, w: labelWidth(title, meta), h: 36, force: f === star, title, meta, strong: f === star }; });
      return c.funds.filter((f) => f === star).map((f) => { const p = positions.get(f.fund_id)!; const title = compact(f.name, 26); const meta = `${placeOf(f).label} · ${pct(f.score)}`; return { id: f.fund_id, x: p.x, y: p.y, w: labelWidth(title, meta), h: 36, force: true, title, meta, strong: true }; });
    }).sort((a, b) => Number(b.id === star?.fund_id) - Number(a.id === star?.fund_id));
    if (star && hot?.funds.includes(star) && hot.funds.length >= 2) { const p = positions.get(star.fund_id)!; const title = compact(star.name, 26); const meta = `${placeOf(star).label} · ${pct(star.score)}`; items.unshift({ id: star.fund_id, x: p.x, y: p.y, w: labelWidth(title, meta), h: 36, force: true, title, meta, strong: true }); }
    const nodeBoxes = funds.map((f) => { const p = positions.get(f.fund_id)!; return { x: p.x - 8, y: p.y - 8, w: 16, h: 16 }; });
    const spotBox: Box = { x: 0, y: h - 190, w: 340, h: 190 };
    const placed = showLabels ? placeLabels(items, bounds, [founderBox, spotBox, ...(full ? [] : [{ x: w - 236, y: 0, w: 236, h: 250 }, { x: w - 290, y: h - 220, w: 290, h: 220 }]), ...nodeBoxes]) : new Map();
    return <>
      <defs>
        <pattern id="atlas-dots" width="7" height="7" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".75" className="atlas-dot" /></pattern>
        <linearGradient id="atlas-land-gradient" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={w} y2={h}>
          <stop offset="0" stopColor="var(--a-land-1)" /><stop offset=".52" stopColor="var(--a-land-2)" /><stop offset="1" stopColor="var(--a-land-3)" />
        </linearGradient>
        <radialGradient id="atlas-active-gradient" gradientUnits="objectBoundingBox" cx="68%" cy="36%" r="85%">
          <stop offset="0" stopColor="var(--a-active-1)" /><stop offset=".55" stopColor="var(--a-active-2)" /><stop offset="1" stopColor="var(--a-active-3)" />
        </radialGradient>
        {funds.map((f) => { const p = positions.get(f.fund_id)!; return (
          <linearGradient key={f.fund_id} id={`arc-${f.fund_id.replace(/[^a-z0-9]/gi, '')}`} gradientUnits="userSpaceOnUse" x1={founder.x} y1={founder.y} x2={p.x} y2={p.y}>
            <stop offset="0" style={{ stopColor: 'var(--a-hub)' }} /><stop offset="1" style={{ stopColor: groupOf.get(f.fund_id)?.color || 'var(--g-loose)' }} />
          </linearGradient>); })}
      </defs>
      <g className="atlas-states">
        {LOWER48.features.map((f: Feature<Geometry, StateProps>) => {
          const abbr = ABBR_BY_NAME[f.properties.name]; const count = activeStates.get(abbr) || 0; const d = path(f) || '';
          return <g key={String(f.id)}><path d={d} className={count ? 'active' : ''} style={{ '--heat': Math.min(.34, .1 + count * .03) } as CSSProperties} /><path d={d} className="dots" /></g>;
        })}
        {LOWER48.features.map((f) => { const abbr = ABBR_BY_NAME[f.properties.name]; const c = centroids.get(abbr); return c && path.area(f) > 900 && !activeStates.has(abbr) ? <text key={abbr} x={c.x} y={c.y} textAnchor="middle" dominantBaseline="middle">{abbr}</text> : null; })}
      </g>
      <defs><radialGradient id="hot-glow-p"><stop offset="0" stopColor="var(--hot-1)" stopOpacity=".9" /><stop offset=".45" stopColor="var(--hot-2)" stopOpacity=".5" /><stop offset="1" stopColor="var(--hot-2)" stopOpacity="0" /></radialGradient></defs>
      {hot && hot.funds.length >= 2 && <g className="atlas-cluster"><circle cx={hot.center.x} cy={hot.center.y} r={hot.ring + 46} fill="url(#hot-glow-p)" /></g>}
      {!full && <g className="atlas-hubs" pointerEvents="none">
        {clusters.filter((c) => c !== hot && c.funds.length >= 2).map((c) => <circle key={c.code} cx={c.center.x} cy={c.center.y} r={c.ring + 26} fill="url(#hot-glow-p)" />)}
        {funds.filter((f) => f.rank <= 3).map((f) => { const p = positions.get(f.fund_id)!; return <circle key={f.fund_id} cx={p.x} cy={p.y} r="26" className="atlas-hub-glow" />; })}
      </g>}
      {star && (() => { const p = positions.get(star.fund_id)!; return <g className="atlas-star" pointerEvents="none"><circle cx={p.x} cy={p.y} r="34" fill="url(#hot-glow-p)" /><circle cx={p.x} cy={p.y} r="16" className="atlas-pulse" /></g>; })()}
      {showLinks && <g className="atlas-arcs">
        {funds.slice().reverse().map((f) => {
          const p = positions.get(f.fund_id)!; const dx = p.x - founder.x; const dy = p.y - founder.y; const dist = Math.hypot(dx, dy);
          const bend = Math.min(220, dist * (.24 + (f.rank % 5) * .025)); const side = dx >= 0 ? 1 : -1;
          const cx = (founder.x + p.x) / 2 + (dy / dist) * bend * side; const cy = (founder.y + p.y) / 2 - (dx / dist) * bend * side;
          return <path key={f.fund_id} d={`M${founder.x},${founder.y} Q${cx},${cy} ${p.x},${p.y}`} className={`arc ${isDim(f) ? 'dim' : ''} ${hover?.id === f.fund_id ? 'on' : ''}`} stroke={`url(#arc-${f.fund_id.replace(/[^a-z0-9]/gi, '')})`} style={{ '--w': 0.8 + t(f.score) * 1.6 } as CSSProperties} />;
        })}
        {links.map((l) => { const a = positions.get(l.source)!; const b = positions.get(l.target)!; if (Math.hypot(a.x - b.x, a.y - b.y) < 60) return null; return <path key={`${l.source}-${l.target}`} d={`M${a.x},${a.y} Q${(a.x + b.x) / 2},${Math.min(a.y, b.y) - 40} ${b.x},${b.y}`} className="peer" />; })}
      </g>}
      {founderNode({ p: founder, label: 'Tú', sub: founderLabel.toUpperCase() })}
      {funds.map((f) => fundNode({ fund: f, p: positions.get(f.fund_id)! }))}
      {items.map((it) => { const box = placed.get(it.id); return box ? <g key={it.id}>{labelBox({ box, title: it.title, meta: it.meta, strong: it.strong })}</g> : null; })}
    </>;
  };

  /* ───────── Chord ───────── */
  const renderChord = () => {
    if (!w || !h) return null;
    const narrow = w < 640;
    const labelSpace = showLabels && !narrow ? 172 : 36;
    const room = w;
    const R = Math.max(110, Math.min(h / 2 - labelSpace, room / 2 - labelSpace));
    const c = { x: room / 2, y: h / 2 };
    const ordered = groups.flatMap((g) => g.funds);
    const gap = groups.length > 1 ? 0.09 : 0;
    const step = (Math.PI * 2 - gap * groups.length) / Math.max(ordered.length, 1);
    const angles = new Map<string, number>();
    let a = -Math.PI / 2 + gap / 2;
    const arcs: { g: Group; a0: number; a1: number }[] = [];
    groups.forEach((g) => { const a0 = a; g.funds.forEach((f) => { angles.set(f.fund_id, a + step / 2); a += step; }); arcs.push({ g, a0, a1: a }); a += gap; });
    const at = (angle: number, r: number) => ({ x: c.x + Math.cos(angle) * r, y: c.y + Math.sin(angle) * r });
    const arcPath = (a0: number, a1: number, r: number) => { const p0 = at(a0, r); const p1 = at(a1, r); return `M${p0.x},${p0.y} A${r},${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${p1.x},${p1.y}`; };
    return <>
      <g className="chord-guides"><circle cx={c.x} cy={c.y} r={R} /><circle cx={c.x} cy={c.y} r={R * .62} /><circle cx={c.x} cy={c.y} r={R * .3} /></g>
      {arcs.map(({ g, a0, a1 }) => <path key={g.id} d={arcPath(a0 + .01, a1 - .01, R + 12)} className={`chord-band ${focusGroup && focusGroup !== g.id ? 'dim' : ''}`} style={{ '--c': g.color } as CSSProperties} />)}
      {showLinks && <g className="chord-links">
        {ordered.map((f) => { const p = at(angles.get(f.fund_id)!, R); return <line key={f.fund_id} x1={c.x} y1={c.y} x2={p.x} y2={p.y} className={`ray ${isDim(f) ? 'dim' : ''} ${hover?.id === f.fund_id ? 'on' : ''}`} style={{ '--w': 0.6 + t(f.score) * 1.4 } as CSSProperties} />; })}
        {links.map((l) => {
          const p = at(angles.get(l.source)!, R - 2); const q = at(angles.get(l.target)!, R - 2);
          const color = groupOf.get(l.source)?.color || 'var(--g-loose)';
          const on = hover && (hover.id === l.source || hover.id === l.target);
          const pill = on && (linkedTo.get(hover!.id)?.size || 0) <= 2;
          const off = (hover && !on) || (focusGroup && groupOf.get(l.source)?.id !== focusGroup);
          const mid = { x: (p.x + q.x) / 2 * .55 + c.x * .45, y: (p.y + q.y) / 2 * .55 + c.y * .45 };
          return <g key={`${l.source}-${l.target}`}>
            <path d={`M${p.x},${p.y} Q${c.x + (mid.x - c.x) * .5},${c.y + (mid.y - c.y) * .5} ${q.x},${q.y}`} className={`chord ${on ? 'on' : ''} ${off ? 'dim' : ''}`} style={{ '--c': color } as CSSProperties} />
            {pill && <g className="chord-pill" transform={`translate(${c.x + (mid.x - c.x) * .75},${c.y + (mid.y - c.y) * .75})`}><rect x={-l.shared[0].length * 2.9 - 8} y="-9" width={l.shared[0].length * 5.8 + 16} height="18" rx="9" /><text textAnchor="middle" dy="3.5">{cleanPerson(l.shared[0])}</text></g>}
          </g>;
        })}
      </g>}
      {founderNode({ p: c, label: 'Tú', labelSide: 'below' })}
      {ordered.map((f) => {
        const angle = angles.get(f.fund_id)!; const p = at(angle, R); const deg = angle * 180 / Math.PI; const flip = Math.cos(angle) < 0;
        const lp = at(angle, R + 24);
        return <g key={f.fund_id}>
          {fundNode({ fund: f, p })}
          {showLabels && !narrow && <text className={`chord-label ${isDim(f) ? 'dim' : ''} ${hover?.id === f.fund_id ? 'on' : ''}`} transform={`translate(${lp.x},${lp.y}) rotate(${flip ? deg + 180 : deg})`} textAnchor={flip ? 'end' : 'start'} dominantBaseline="middle">{compact(f.name, 23)}</text>}
        </g>;
      })}
    </>;
  };

  /* ───────── Jerárquica ───────── */
  const renderTree = () => {
    if (!w || !h) return null;
    const top = 58; const bottom = h - 26;
    const ordered = groups.flatMap((g) => g.funds);
    const gapCount = Math.max(groups.length - 1, 0);
    const unit = (bottom - top) / Math.max(ordered.length - 1 + gapCount * .8, 1);
    const leafX = Math.round(w * .6); const groupX = Math.round(w * .33); const root = { x: 96, y: (top + bottom) / 2 };
    const leafPos = new Map<string, Point>();
    const groupPos = new Map<string, Point>();
    let y = top;
    groups.forEach((g, gi) => {
      const ys: number[] = [];
      g.funds.forEach((f) => { leafPos.set(f.fund_id, { x: leafX, y }); ys.push(y); y += unit; });
      groupPos.set(g.id, { x: groupX, y: (ys[0] + ys[ys.length - 1]) / 2 });
      if (gi < groups.length - 1) y += unit * .8;
    });
    const link = linkHorizontal<{ source: Point; target: Point }, Point>().x((p) => p.x).y((p) => p.y);
    const dimLabel = GROUP_OPTIONS.find((o) => o.id === groupKey)!.label;
    return <>
      <g className="tree-heads"><text x={root.x - 30} y="30">EMPRESA</text><text x={groupX - 10} y="30">{dimLabel.toUpperCase()}</text><text x={leafX - 10} y="30">FONDOS · TOP {funds.length}</text><text x={w - 24} y="30" textAnchor="end">AFINIDAD</text></g>
      {showLinks && <g className="tree-links">
        {groups.map((g) => { const gp = groupPos.get(g.id)!; return <path key={g.id} d={link({ source: root, target: gp }) || ''} className={`trunk ${focusGroup && focusGroup !== g.id ? 'dim' : ''}`} style={{ '--c': g.color, '--w': 1 + g.funds.length * .45 } as CSSProperties} />; })}
        {ordered.map((f) => { const g = groupOf.get(f.fund_id)!; return <path key={f.fund_id} d={link({ source: groupPos.get(g.id)!, target: leafPos.get(f.fund_id)! }) || ''} className={`branch ${isDim(f) ? 'dim' : ''} ${hover?.id === f.fund_id ? 'on' : ''}`} style={{ '--c': g.color } as CSSProperties} />; })}
      </g>}
      {founderNode({ p: root, label: 'Tú', sub: data.project.name.toUpperCase(), labelSide: 'below' })}
      {groups.map((g) => { const p = groupPos.get(g.id)!; return <g key={g.id} className={`tree-group ${focusGroup && focusGroup !== g.id ? 'dim' : ''}`} style={{ '--c': g.color } as CSSProperties} onMouseEnter={() => setFocusGroup(g.id)} onMouseLeave={() => setFocusGroup(null)}>
        <circle cx={p.x} cy={p.y} r={9 + Math.sqrt(g.funds.length) * 3} className="halo" /><circle cx={p.x} cy={p.y} r="5.5" className="core" />
        {showLabels && <><text x={p.x + 20} y={p.y - 3}>{compact(g.label, 24)}</text><text x={p.x + 20} y={p.y + 12} className="meta">{g.funds.length} {g.funds.length === 1 ? 'fondo' : 'fondos'}</text></>}
      </g>; })}
      {ordered.map((f) => { const p = leafPos.get(f.fund_id)!; return <g key={f.fund_id}>
        {fundNode({ fund: f, p })}
        {showLabels && <g className={`tree-leaf ${isDim(f) ? 'dim' : ''} ${hover?.id === f.fund_id ? 'on' : ''}`} pointerEvents="none">
          <text x={p.x + 16} y={p.y} dominantBaseline="middle"><tspan className="rank">{String(f.rank).padStart(2, '0')}</tspan>  {compact(f.name, Math.max(18, Math.floor((w - leafX - 150) / 6.6)))}</text>
          <line x1={w - 104} x2={w - 60} y1={p.y} y2={p.y} className="track" /><line x1={w - 104} x2={w - 104 + 44 * Math.max(.06, t(f.score))} y1={p.y} y2={p.y} className="fill" style={{ '--c': groupOf.get(f.fund_id)?.color } as CSSProperties} />
          <text x={w - 24} y={p.y} textAnchor="end" dominantBaseline="middle" className="score">{pct(f.score)}</text>
        </g>}
      </g>; })}
    </>;
  };

  const tip = hoverFund && hover ? (() => {
    const g = groupOf.get(hoverFund.fund_id); const peers = linkedTo.get(hoverFund.fund_id)?.size || 0;
    const contact = hoverFund.people?.[0] ? cleanPerson(hoverFund.people[0].name) : null;
    const left = hover.x > w - 290; const top = Math.min(Math.max(hover.y - 40, 12), h - 170);
    return <div className="atlas-tip" style={{ left: left ? hover.x - 276 : hover.x + 22, top }}>
      <span className="atlas-tip-rank">#{hoverFund.rank} · {pct(hoverFund.score)} afinidad</span>
      <strong>{hoverFund.name}</strong>
      <small>{placeOf(hoverFund).label}{g ? ` · ${g.label}` : ''}</small>
      {contact && <p>Contacto público: <b>{contact}</b></p>}
      {peers > 0 && <p>Comparte socio con <b>{peers}</b> {peers === 1 ? 'fondo' : 'fondos'} de tu top</p>}
      <em>Clic para ver la ficha</em>
    </div>;
  })() : null;

  const dimLabel = GROUP_OPTIONS.find((o) => o.id === groupKey)!.label;
  const tabs = (
    <div className="atlas-tabs" role="tablist" aria-label="Tipo de visualización">
      {VIEWS.filter((v) => full || v.id !== 'table').map(({ id, label, icon: Icon }) => (
        <button key={id} role="tab" data-view={id} aria-selected={view === id} className={view === id ? 'on' : ''} onClick={() => { setView(id); setHover(null); }}>
          <Icon size={14} strokeWidth={1.8} />{label}
        </button>
      ))}
    </div>
  );
  const spot = (() => {
    const star = funds.find((f) => f.fund_id === focusId) || funds[0];
    const hot = mapModel?.hot;
    if (!star) return null;
    const hotGroup = hot ? buildGroups(hot.funds, links, 'network').find((g) => g.id !== 'net:loose') : undefined;
    return { star, hot, hotGroup };
  })();
  const sec = (ref?: string | null) => ref ? `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${ref.split('-')[0]}&type=D&dateb=&owner=include&count=40` : '';
  const spotlight = spot ? (
    <aside className="atlas-spot">
      {spot.hot && spot.hot.funds.length >= 2 && <div className="spot-row">
        <span className="spot-kind hot">Zona con más fondos</span>
        <strong>{placeOf(spot.hot.funds[0]).region} · {spot.hot.funds.length} fondos</strong>
        {spot.hotGroup && <small>{spot.hotGroup.funds.length} comparten a {spot.hotGroup.label}</small>}
      </div>}
      <div className="spot-row">
        <span className="spot-kind star">{focusId ? 'Ubicado en el mapa' : 'Candidato más prometedor'}</span>
        <button className="spot-name" onClick={() => onSelect(spot.star.fund_id)}>{spot.star.name}</button>
        <small>#{spot.star.rank} · {placeOf(spot.star).label} · {pct(spot.star.score)} afinidad</small>
        {spot.star.profile.source_ref && <a href={sec(spot.star.profile.source_ref)} target="_blank" rel="noreferrer">Fuente: Form D (SEC){spot.star.profile.source_date ? ` · ${new Date(`${spot.star.profile.source_date.slice(0, 10)}T12:00:00`).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''} ↗</a>}
      </div>
    </aside>
  ) : null;
  const canvas = view === 'table' ? <div className="atlas-table">{table}</div> : (
    <div className={`atlas-canvas ${!full && view === 'map' ? 'street' : ''}`} ref={canvasRef} data-view={view}>
      <svg width={w} height={h} viewBox={`0 0 ${w || 1} ${h || 1}`} role="img" aria-label={`${VIEWS.find((v) => v.id === view)!.label}: ${funds.length} fondos agrupados por ${dimLabel.toLowerCase()}`}>
        {view === 'map' ? null : view === 'chord' ? renderChord() : renderTree()}
      </svg>
      {full && view === 'map' && w > 0 && <WorldMap w={w} h={h} funds={funds} groupOf={groupOf} t={t}
        founder={{ lonLat: founderGeo ? FOUNDER_HOME[founderGeo].lonLat : [-74.07, 4.71], label: founderLabel }}
        focusId={focusId || null} hoverId={hover?.id || null} showLabels={showLabels} showLinks={showLinks}
        onHover={(id, p) => setHover(id && p ? { id, ...p } : null)} onSelect={(id) => { setHover(null); onSelect(id); }} />}
      {!full && view === 'map' && <DashMap data={data} funds={funds} focusId={focusProp} onOpen={onSelect} showLinks={showLinks} showLabels={showLabels} />}
      {tip}
    </div>
  );
  if (!full) {
    return (
      <section className="card flow-card atlas-card preview" aria-label="Vista previa de tu red de inversionistas">
        <div className="atlas-toolbar dash-filters">
          <Field label="Título"><span>Red · {data.project.name}</span></Field>
          <Field label="Tipo" select>
            <select value={view === 'table' ? 'map' : view} onChange={(e) => { setView(e.target.value as ViewMode); setHover(null); }} aria-label="Tipo de visualización">
              {VIEWS.filter((v) => v.id !== 'table').map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
            </select><ChevronDown size={14} />
          </Field>
          <Field label="Primera dimensión" select>
            <select value={topN} onChange={(e) => setTopN(Number(e.target.value))} aria-label="Primera dimensión">{[5, 10, 20].map((n) => <option key={n} value={n}>Fondos · top {n}</option>)}</select><ChevronDown size={14} />
          </Field>
          <div className="atlas-switches">
            <Switch on={onlyActive} onClick={() => setOnlyActive(!onlyActive)}>Activos</Switch>
            <Switch on={showLinks} onClick={() => setShowLinks(!showLinks)}>Links</Switch>
            <Switch on={showLabels} onClick={() => setShowLabels(!showLabels)}>Etiquetas</Switch>
            <Switch on={legendTop} onClick={() => setLegendTop(!legendTop)}>Leyenda arriba</Switch>
          </div>
          {onExplore && <button className="atlas-explore" onClick={onExplore}>Explorar red <ArrowUpRight size={15} /></button>}
        </div>
        {legendTop && <div className="dash-legend" aria-label="Leyenda">
          <span className="dl-range"><small>Afinidad</small><i className="legend-gradient" /><em>{pct(lo)} – {pct(hi)}</em></span>
          {groups.map((g) => <span key={g.id} className="dl-group" style={{ '--c': g.color } as CSSProperties} onMouseEnter={() => setFocusGroup(g.id)} onMouseLeave={() => setFocusGroup(null)}><i />{g.label}<b>{g.funds.length}</b></span>)}
          {view === 'map' && <span className="dl-group route"><i />Comparte socio</span>}
        </div>}
        {canvas}
      </section>
    );
  }

  return (
    <div className="atlas-page">
      <section className="card atlas-card full" aria-label="Red de inversionistas">
        <div className="atlas-toolbar">
          <Field label="Tipo">{tabs}</Field>
          <Field label="Primera dimensión"><span>Fondos · top {funds.length}</span></Field>
          <Field label="Segunda dimensión" select>
            <select value={groupKey} onChange={(e) => setGroupKey(e.target.value as GroupKey)} aria-label="Segunda dimensión">
              {GROUP_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
            <ChevronDown size={14} />
          </Field>
          <div className="atlas-switches" hidden={view === 'table'}>
            <Switch on={showLinks} onClick={() => setShowLinks(!showLinks)}>Links</Switch>
            <Switch on={showLabels} onClick={() => setShowLabels(!showLabels)}>Etiquetas</Switch>
          </div>
        </div>
        {canvas}
      </section>
      {side || <aside className="card atlas-side">
        <h2>Leyenda</h2>
        <div className="legend-block">
          <small>Afinidad con tu tesis (%)</small>
          <div className="legend-gradient" />
          <div className="legend-ticks">{[0, .25, .5, .75, 1].map((k) => <span key={k}>{((lo + (hi - lo) * k) * 100).toFixed(1)}</span>)}</div>
        </div>
        <div className="legend-block">
          <small>{dimLabel}</small>
          <ul className="legend-groups">
            {groups.map((g) => (
              <li key={g.id} style={{ '--c': g.color } as CSSProperties} onMouseEnter={() => setFocusGroup(g.id)} onMouseLeave={() => setFocusGroup(null)} className={focusGroup === g.id ? 'on' : ''}>
                <i /><span>{g.label}</span><b>{g.funds.length}</b>
              </li>
            ))}
          </ul>
        </div>
        <div className="legend-lines"><span><i className="solid" />Socio compartido</span><span><i className="dotted" />Tu afinidad</span></div>
        <p className="legend-hint">Haz clic en un fondo para ver su ficha y el plan de warm path.</p>
      </aside>}
      {view !== 'table' && table && <section className="card atlas-directory" aria-label="Directorio de inversionistas">
        <header className="atlas-directory-head">
          <div><span>Directorio</span><h2>Fondos priorizados</h2></div>
          <strong>{funds.length} inversionistas</strong>
        </header>
        {table}
      </section>}
    </div>
  );
}

function Field({ label, children, select = false }: { label: string; children: ReactNode; select?: boolean }) {
  return <label className={`atlas-field ${select ? 'select' : ''}`}><small>{label}</small>{children}</label>;
}
function Switch({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return <button className={`atlas-switch ${on ? 'on' : ''}`} onClick={onClick} aria-pressed={on}><i />{children}</button>;
}
