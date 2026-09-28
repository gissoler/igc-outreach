import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, MapPin, Minus, Network, Paperclip, Plus, RotateCcw, Search, Star } from 'lucide-react';
import { geoCentroid, geoNaturalEarth1, geoPath } from 'd3-geo';
import { select } from 'd3-selection';
import 'd3-transition';
import { zoom as d3zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from 'd3-zoom';
import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import type { FeatureCollection, Geometry } from 'geojson';
import usAtlas from 'us-atlas/states-10m.json';
import worldAtlas from 'world-atlas/countries-50m.json';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Dashboard, Recommendation } from './api';
import { COUNTRIES, FOREIGN_REGIONS, STATE_NAMES, cleanPerson, countryOf, pct, placeOf, type Continent } from './atlasModel';
import { useSize } from './atlasGeometry';
import { COUNTY_MESH, GoldPin, STATE_MESH } from './mapKit';
import { PIPELINE_STAGES, buildFundPlan, fmtDay, pipelineStage, planContext } from './warmPlan';
import { Avatar, investorImage, outcomeLabels } from './ui';

/* ───────── Geografía del mapa del encabezado: EE. UU. continental + vecinos ───────── */
type Named = { name: string };
const us = usAtlas as unknown as Topology<{ states: GeometryCollection<Named> }>;
const STATES = (feature(us, us.objects.states) as FeatureCollection<Geometry, Named>).features
  .filter((f) => !['02', '15', '60', '66', '69', '72', '78'].includes(String(f.id)));
const ABBR = Object.fromEntries(Object.entries(STATE_NAMES).map(([a, n]) => [n, a]));
const wa = worldAtlas as unknown as Topology<{ countries: GeometryCollection<Named> }>;
const WORLD = (feature(wa, wa.objects.countries) as FeatureCollection<Geometry, Named>).features.filter((f) => String(f.id) !== '010');
const COUNTRY_BY_ID = new Map(WORLD.map((f) => [String(f.id), f]));
const STATE_BY_ABBR = new Map(STATES.map((f) => [ABBR[f.properties.name], f]));
/** Caja [oeste, sur, este, norte] de cada zona navegable. */
type BoxLL = [number, number, number, number];
const ZONE_BOX: Record<string, BoxLL> = {
  US: [-125, 24, -66, 50], CA: [-128, 41, -55, 60], 'Norteamérica': [-130, 14, -55, 60], 'Sudamérica': [-82, -56, -34, 13],
  'Europa': [-11, 35, 40, 70], 'Asia': [26, -10, 150, 60], 'África': [-18, -35, 52, 37], 'Oceanía': [110, -48, 180, -8],
};
export type Zone = { kind: 'all' } | { kind: 'continent'; id: Continent } | { kind: 'country'; id: string };

const FAV_KEY = 'warmpath-favs';
const readFavs = (): string[] => { try { return JSON.parse(localStorage.getItem(FAV_KEY) || '[]'); } catch { return []; } };
const writeFavs = (ids: string[]) => { try { localStorage.setItem(FAV_KEY, JSON.stringify(ids)); } catch { /* sin almacenamiento */ } };

const stageLabel = (id: string) => PIPELINE_STAGES.find((s) => s.id === id)?.label || outcomeLabels[id] || id;
const STAGE_RANK = Object.fromEntries(PIPELINE_STAGES.map((s, i) => [s.id, i]));

type Show = 'all' | 'warm' | 'favs' | 'nocontact';
type SortKey = 'rank' | 'name' | 'stage' | 'contact' | 'round' | 'activity' | 'place' | 'plan' | 'fav';
type Row = {
  fund: Recommendation; stage: string; done: number; total: number; contact: string; contacts: number;
  city: string; place: string; code: string; country: string; continent: Continent | ''; warm: boolean; fav: boolean;
};

const cityKey = (f: Recommendation) => { const p = placeOf(f); return p.city || p.region; };

export function InvestorBoard({ data, done, selectedId, onSelect, onExplore }: {
  data: Dashboard; done: Record<string, string>; selectedId: string | null;
  onSelect: (id: string | null) => void; onExplore: () => void;
}) {
  const ctx = useMemo(() => planContext(data), [data]);
  const [favs, setFavs] = useState<string[]>(readFavs);
  const [show, setShow] = useState<Show>('all');
  const [city, setCity] = useState<string>('');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'rank', dir: 1 });
  const [zone, setZone] = useState<Zone>({ kind: 'all' });
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);

  const rows: Row[] = useMemo(() => data.recommendations.map((fund) => {
    const plan = buildFundPlan(fund, ctx, done);
    const people = (fund.people || []).map((p) => cleanPerson(p.name));
    const p = placeOf(fund);
    return {
      fund, stage: pipelineStage(fund, plan), done: plan.filter((s) => s.status === 'done').length, total: plan.length,
      contact: people[0] || '', contacts: people.length, city: cityKey(fund), place: p.label, code: p.code,
      country: countryOf(fund), continent: COUNTRIES[countryOf(fund)]?.continent || '',
      warm: Boolean(fund.best_path) || ctx.groupOf.has(fund.fund_id), fav: favs.includes(fund.fund_id),
    };
  }), [data, ctx, done, favs]);

  const inZone = (r: Row) => zone.kind === 'all' || (zone.kind === 'country' ? r.country === zone.id : r.continent === zone.id);
  const zoneRows = useMemo(() => rows.filter(inZone), [rows, zone]); // eslint-disable-line react-hooks/exhaustive-deps
  const zones = useMemo(() => {
    const count = (fn: (r: Row) => boolean) => rows.filter(fn).length;
    const continents = [...new Set(rows.map((r) => r.continent).filter(Boolean))] as Continent[];
    const countries = [...new Set(rows.map((r) => r.country).filter(Boolean))];
    return {
      continents: continents.map((c) => ({ id: c, n: count((r) => r.continent === c) })),
      countries: countries.map((c) => ({ id: c, name: COUNTRIES[c]?.name || c, n: count((r) => r.country === c) })).sort((a, b) => b.n - a.n),
    };
  }, [rows]);
  const pickZone = (z: Zone) => { setZone(z); setCity(''); setPage(0); };

  /* Lista de ciudades (columna izquierda y filtro "Ubicación") */
  const cities = useMemo(() => {
    const m = new Map<string, { name: string; code: string; n: number }>();
    zoneRows.forEach((r) => { const c = m.get(r.city) || { name: r.city, code: r.code, n: 0 }; c.n += 1; m.set(r.city, c); });
    return [...m.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
  }, [zoneRows]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = zoneRows.filter((r) => (!city || r.city === city)
      && (show === 'all' || (show === 'warm' && r.warm) || (show === 'favs' && r.fav) || (show === 'nocontact' && !r.contacts))
      && (!q || `${r.fund.name} ${r.place} ${r.contact} ${r.fund.profile.thesis || ''}`.toLowerCase().includes(q)));
    const val = (r: Row): string | number => {
      switch (sort.key) {
        case 'name': return r.fund.name.toLowerCase();
        case 'stage': return -(STAGE_RANK[r.stage] ?? 0);
        case 'contact': return r.contact ? r.contact.toLowerCase() : '~';
        case 'round': return -(Date.parse(r.fund.profile.source_date || '') || 0);
        case 'activity': return -(Date.parse(r.fund.profile.last_activity || '') || 0);
        case 'place': return r.place.toLowerCase();
        case 'plan': return -r.done;
        case 'fav': return r.fav ? 0 : 1;
        default: return r.fund.rank;
      }
    };
    return [...list].sort((a, b) => { const x = val(a); const y = val(b); return (x < y ? -1 : x > y ? 1 : a.fund.rank - b.fund.rank) * sort.dir; });
  }, [zoneRows, city, show, query, sort]);
  useEffect(() => { setPage(0); }, [city, show, query, sort, pageSize]);
  const pages = Math.max(1, Math.ceil(visible.length / pageSize));
  const current = Math.min(page, pages - 1);
  const pageRows = visible.slice(current * pageSize, current * pageSize + pageSize);

  /* KPIs */
  const kpi = useMemo(() => {
    const people = new Set(data.recommendations.flatMap((f) => (f.people || []).map((p) => p.key)));
    const talking = rows.filter((r) => (STAGE_RANK[r.stage] ?? 0) >= 2).length;
    return {
      total: rows.length, people: people.size,
      network: rows.filter((r) => ctx.groupOf.has(r.fund.fund_id)).length, direct: rows.filter((r) => r.fund.best_path).length,
      noContact: rows.filter((r) => !r.contacts).length, noTicket: rows.filter((r) => !r.fund.profile.ticket_min && !r.fund.profile.ticket_max).length,
      talking, warming: rows.filter((r) => r.stage === 'calentando').length,
      stepsDone: rows.reduce((a, r) => a + r.done, 0), steps: rows.reduce((a, r) => a + r.total, 0),
    };
  }, [rows, data, ctx]);

  const toggleFav = (id: string) => { const next = favs.includes(id) ? favs.filter((x) => x !== id) : [...favs, id]; setFavs(next); writeFavs(next); };
  const sortBy = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: 1 }));
  const Th = ({ k, children }: { k: SortKey; children: ReactNode }) => (
    <button className={`ib-th ${sort.key === k ? 'on' : ''}`} onClick={() => sortBy(k)} aria-label={`Ordenar por ${String(children)}`}>
      {children}{sort.key === k && sort.dir === -1 ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
    </button>
  );
  const activeCode = city ? cities.find((c) => c.name === city)?.code || '' : '';
  const selectedCode = selectedId ? rows.find((r) => r.fund.fund_id === selectedId)?.code || '' : '';

  return (
    <section className="ib" aria-label="Inversionistas">
      <div className="ib-hero">
        <div className="ib-toolbar">
          <label className="ib-search"><Search size={17} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar" aria-label="Buscar fondo, contacto o ciudad" /></label>
          <label className="ib-field"><span>Mostrar</span>
            <span className="ib-select"><select value={show} onChange={(e) => setShow(e.target.value as Show)}>
              <option value="all">Todos los fondos</option><option value="warm">Con warm path</option>
              <option value="favs">Favoritos</option><option value="nocontact">Sin contacto</option>
            </select><ChevronDown size={14} /></span>
          </label>
          <label className="ib-field"><span>Ordenar por</span>
            <span className="ib-select"><select value={sort.key} onChange={(e) => setSort({ key: e.target.value as SortKey, dir: 1 })}>
              <option value="rank">Afinidad</option><option value="activity">Última actividad</option><option value="round">Última ronda</option>
              <option value="stage">Etapa</option><option value="name">Nombre</option><option value="plan">Avance del plan</option>
            </select><ChevronDown size={14} /></span>
          </label>
          <label className="ib-field"><span>Ubicación</span>
            <span className="ib-select with-pin"><MapPin size={14} /><select value={city} onChange={(e) => setCity(e.target.value)}>
              <option value="">Todas las ciudades</option>
              {cities.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
            </select><ChevronDown size={14} /></span>
          </label>
          <button className="ib-explore" onClick={onExplore}><Network size={15} /> Explorar red</button>
        </div>

        <div className="ib-body">
          <nav className="ib-cities" aria-label="Filtrar por ciudad">
            <div className="ib-cities-head"><span>{zone.kind === 'all' ? 'Todas las zonas' : zone.kind === 'country' ? COUNTRIES[zone.id]?.name : zone.id}</span><b>{zoneRows.length}</b></div>
            <button className={!city ? 'on' : ''} onClick={() => setCity('')}><span>Todas</span><b>{zoneRows.length}</b></button>
            {cities.slice(0, 8).map((c) => <button key={c.name} className={city === c.name ? 'on' : ''} onClick={() => setCity(city === c.name ? '' : c.name)}><span>{c.name}</span><b>{c.n}</b></button>)}
          </nav>

          <HeroMap rows={rows} zone={zone} zones={zones} onZone={pickZone} activeCode={activeCode || selectedCode} activeCity={city} selectedId={selectedId}
            onCity={(name) => setCity(city === name ? '' : name)} onSelect={(id) => onSelect(id)} />

          <div className="ib-kpis">
            <div className="ib-boxes">
              <div className="ib-box"><small>En conversación</small><b>{kpi.talking}</b><i>{kpi.warming}</i></div>
              <div className="ib-box"><small>Plan warm path</small><b>{kpi.stepsDone}</b><i>{kpi.steps}</i></div>
            </div>
            <div className="ib-stats">
              <div className="ib-stat total"><small>Total</small><b>{kpi.total}</b><i>{kpi.people}</i><em>fondos</em><em>contactos</em></div>
              <div className="ib-stat"><small><u className="blue" />Warm path</small><b>{kpi.network}</b><i>{kpi.direct}</i></div>
              <div className="ib-stat"><small><u className="gold" />Sin contacto</small><b>{kpi.noContact}</b><i>{kpi.noTicket}</i></div>
            </div>
          </div>
        </div>
      </div>

      <div className="ib-table" role="table" aria-label="Fondos">
        <div className="ib-row ib-head" role="row">
          <Th k="rank">#</Th><Th k="name">Inversionista</Th><Th k="stage">Etapa</Th><Th k="contact">Contacto</Th>
          <Th k="round">Última ronda</Th><Th k="activity">Última actividad</Th><Th k="place">Ubicación</Th>
          <Th k="plan">Plan</Th><Th k="fav">Fav.</Th><span className="ib-th">Estado</span>
        </div>
        {pageRows.map((r) => {
          const f = r.fund;
          const status = (STAGE_RANK[r.stage] ?? 0) >= 2 ? 'hot' : r.done > 0 || r.warm ? 'on' : r.contacts ? 'idle' : 'off';
          return (
            <div key={f.fund_id} role="row" tabIndex={0} className={`ib-row ${selectedId === f.fund_id ? 'selected' : ''}`}
              onClick={() => onSelect(f.fund_id)} onKeyDown={(e) => { if (e.key === 'Enter') onSelect(f.fund_id); }}>
              <span className="ib-rank">{f.rank}</span>
              <span className="ib-name"><Avatar className="ib-avatar" name={f.name} src={investorImage(f)} /><strong title={f.name}>{f.name}</strong></span>
              <span className="ib-stage">{stageLabel(r.stage)}</span>
              <span className="ib-contact" title={r.contact}>{r.contact || <em>Sin contacto</em>}{r.contacts > 1 && <small> +{r.contacts - 1}</small>}</span>
              <span className="ib-date">{fmtDay(f.profile.source_date) || '—'}</span>
              <span className="ib-date">{fmtDay(f.profile.last_activity) || '—'} <CalendarDays size={13} /> <small>{pct(f.score)}</small></span>
              <span className="ib-place"><MapPin size={13} /> {r.place}</span>
              <span className="ib-plan" title={`${r.done} de ${r.total} pasos del plan`}>{r.done > 0 && <><Paperclip size={14} /> {r.done}</>}</span>
              <button className={`ib-star ${r.fav ? 'on' : ''}`} onClick={(e) => { e.stopPropagation(); toggleFav(f.fund_id); }} aria-pressed={r.fav} aria-label={r.fav ? 'Quitar de favoritos' : 'Marcar como favorito'}><Star size={16} /></button>
              <span className={`ib-dot ${status}`} title={stageLabel(r.stage)} />
            </div>
          );
        })}
        {!visible.length && <p className="ib-empty">No hay fondos con estos filtros.</p>}
      </div>
      {visible.length > 0 && <footer className="ib-pager" aria-label="Paginación">
        <label>Filas por página
          <span className="ib-pager-size"><select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>{[10, 20, 50].map((n) => <option key={n} value={n}>{n}</option>)}</select><ChevronDown size={13} /></span>
        </label>
        <span className="ib-pager-range">{current * pageSize + 1}–{Math.min(visible.length, (current + 1) * pageSize)} de {visible.length}</span>
        <nav>
          <button onClick={() => setPage(current - 1)} disabled={current === 0} aria-label="Página anterior"><ChevronLeft size={16} /></button>
          {Array.from({ length: pages }, (_, i) => i).filter((i) => pages <= 7 || i === 0 || i === pages - 1 || Math.abs(i - current) <= 1).map((i, idx, arr) => <span key={i} className="ib-pager-slot">
            {idx > 0 && i - arr[idx - 1] > 1 && <em>…</em>}
            <button className={i === current ? 'on' : ''} onClick={() => setPage(i)} aria-current={i === current ? 'page' : undefined}>{i + 1}</button>
          </span>)}
          <button onClick={() => setPage(current + 1)} disabled={current >= pages - 1} aria-label="Página siguiente"><ChevronRight size={16} /></button>
        </nav>
      </footer>}
    </section>
  );
}

/* ───────── Mapa del encabezado: mundo navegable (zoom, arrastre y zonas) con pines por ciudad ───────── */
type Pin = { city: string; code: string; rows: Row[]; ll: [number, number] };

function HeroMap({ rows, zone, zones, onZone, activeCode, activeCity, selectedId, onCity, onSelect }: {
  rows: Row[]; zone: Zone; zones: { continents: { id: Continent; n: number }[]; countries: { id: string; name: string; n: number }[] };
  onZone: (z: Zone) => void; activeCode: string; activeCity: string; selectedId: string | null;
  onCity: (city: string) => void; onSelect: (id: string) => void;
}) {
  const [ref, { w, h }] = useSize<HTMLDivElement>();
  const svgRef = useRef<SVGSVGElement>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const [tf, setTf] = useState<ZoomTransform>(zoomIdentity);

  const projection = useMemo(() => geoNaturalEarth1().fitExtent([[0, 0], [Math.max(w, 1), Math.max(h, 1)]], { type: 'FeatureCollection', features: WORLD } as FeatureCollection), [w, h]);
  const path = useMemo(() => geoPath(projection), [projection]);
  const countries = useMemo(() => WORLD.map((f, i) => ({ key: `${f.id ?? 'x'}-${i}`, id: String(f.id), d: path(f) || '' })), [path]);
  const states = useMemo(() => STATES.map((f) => ({ abbr: ABBR[f.properties.name], d: path(f) || '' })), [path]);
  const streets = useMemo(() => ({ counties: path(COUNTY_MESH) || '', states: path(STATE_MESH) || '' }), [path]);
  const withFundsCountry = new Set(rows.map((r) => COUNTRIES[r.country]?.id).filter(Boolean));
  const withFundsState = new Set(rows.map((r) => r.code));

  /* Un pin por ciudad: centroide del estado o región; las ciudades de un mismo estado se separan en pantalla. */
  const pins: Pin[] = useMemo(() => {
    const by = new Map<string, Pin>();
    rows.forEach((r) => {
      const k = `${r.code}|${r.city}`;
      if (!by.has(k)) {
        const st = STATE_BY_ABBR.get(r.code);
        const cf = COUNTRIES[r.country] ? COUNTRY_BY_ID.get(COUNTRIES[r.country].id) : undefined;
        const ll = st ? geoCentroid(st) as [number, number] : FOREIGN_REGIONS[r.code]?.lonLat || (cf ? geoCentroid(cf) as [number, number] : null);
        if (!ll) return;
        by.set(k, { city: r.city, code: r.code, rows: [], ll });
      }
      by.get(k)!.rows.push(r);
    });
    return [...by.values()];
  }, [rows]);

  /* Zoom */
  useEffect(() => {
    const svg = svgRef.current; if (!svg || !w || !h) return;
    const z = d3zoom<SVGSVGElement, unknown>().scaleExtent([1, 40]).translateExtent([[-w * .1, -h * .1], [w * 1.1, h * 1.1]])
      .on('zoom', (e) => setTf(e.transform));
    zoomRef.current = z; select(svg).call(z).on('dblclick.zoom', null);
    return () => { select(svg).on('.zoom', null); };
  }, [w, h]);
  const boxFor = (z: Zone): BoxLL => {
    if (z.kind === 'country' && z.id === 'US') return ZONE_BOX.US;
    const pts = pins.filter((p) => z.kind === 'all' || p.rows.some((r) => (z.kind === 'country' ? r.country === z.id : r.continent === z.id))).map((p) => p.ll);
    if (!pts.length) return [-170, -58, 180, 80];
    const xs = pts.map((p) => p[0]); const ys = pts.map((p) => p[1]);
    const padX = Math.max(8, (Math.max(...xs) - Math.min(...xs)) * .18); const padY = Math.max(6, (Math.max(...ys) - Math.min(...ys)) * .25);
    return [Math.min(...xs) - padX, Math.min(...ys) - padY, Math.max(...xs) + padX, Math.max(...ys) + padY];
  };
  const fly = (box: BoxLL, animate = true) => {
    const svg = svgRef.current; const z = zoomRef.current; if (!svg || !z || !w) return;
    const a = projection([box[0], box[3]]); const b = projection([box[2], box[1]]); if (!a || !b) return;
    const k = Math.min(12, Math.max(1, .9 / Math.max((b[0] - a[0]) / w, (b[1] - a[1]) / h)));
    const k2 = Math.min(k, .82 / Math.max((b[0] - a[0]) / w, (b[1] - a[1]) / (h * .8)));
    const t = zoomIdentity.translate(w / 2 - k2 * (a[0] + b[0]) / 2, h * .44 - k2 * (a[1] + b[1]) / 2).scale(Math.max(1, k2));
    (animate ? select(svg).transition().duration(800) : select(svg)).call(z.transform as never, t);
  };
  useEffect(() => { if (w && h) fly(boxFor(zone), tf.k !== 1); }, [w, h, zone]); // eslint-disable-line react-hooks/exhaustive-deps
  /* Al elegir una ciudad en la columna izquierda (o en "Ubicación"), el mapa viaja hasta ella; "Todas" vuelve a la zona. */
  const firstCity = useRef(true);
  useEffect(() => {
    if (firstCity.current) { firstCity.current = false; return; }
    if (!w || !h) return;
    const pin = activeCity ? pins.find((p) => p.city === activeCity) : undefined;
    if (pin) fly([pin.ll[0] - 3.2, pin.ll[1] - 1.8, pin.ll[0] + 3.2, pin.ll[1] + 1.8]);
    else fly(boxFor(zone));
  }, [activeCity]); // eslint-disable-line react-hooks/exhaustive-deps
  const zoomBy = (f: number) => { const svg = svgRef.current; const z = zoomRef.current; if (svg && z) select(svg).transition().duration(300).call(z.scaleBy as never, f); };

  const k = tf.k;
  const proj = (ll: [number, number]) => { const p = projection(ll) || [0, 0]; return tf.apply(p as [number, number]); };
  const perState = new Map<string, number>();
  const placed = pins.map((p) => {
    const [x, y] = proj(p.ll); const i = perState.get(p.code) || 0; perState.set(p.code, i + 1);
    const spread = Math.min(26, 6 + k * 1.4); const a = i * 2.3; const d = i === 0 ? 0 : spread + i * 3;
    return { ...p, x: x + Math.cos(a) * d, y: y + Math.sin(a) * d };
  }).sort((a, b) => a.y - b.y);
  const isZone = (z: Zone) => JSON.stringify(z) === JSON.stringify(zone);

  return (
    <div className="ib-map" ref={ref}>
      <svg ref={svgRef} width={w} height={h} className="ib-map-svg" role="img" aria-label="Mapa navegable de fondos por ciudad">
        <g transform={tf.toString()}>
          {countries.map((c) => <path key={c.key} d={c.d} className={`st-land ${withFundsCountry.has(c.id) ? '' : 'far'}`} />)}
          {states.filter((s) => s.abbr === activeCode || withFundsState.has(s.abbr)).map((s) => <path key={s.abbr || s.d.slice(0, 12)} d={s.d} className={`ib-state ${s.abbr === activeCode ? 'active' : 'has'}`} />)}
          <g style={{ opacity: Math.min(1, Math.max(0, (k - 2) / 2)) }}>
            <path d={streets.counties} className="st-road casing ns" /><path d={streets.counties} className="st-road ns" />
          </g>
          <g style={{ opacity: Math.min(1, Math.max(.35, (k - 1) / 1.5)) }}>
            <path d={streets.states} className="st-avenue casing ns" /><path d={streets.states} className="st-avenue ns" />
          </g>
        </g>
        {placed.map((p) => {
          const single = p.rows.length === 1;
          const on = p.city === activeCity || p.rows.some((r) => r.fund.fund_id === selectedId);
          const out = zone.kind !== 'all' && !p.rows.some((r) => (zone.kind === 'country' ? r.country === zone.id : r.continent === zone.id));
          return <g key={`${p.code}|${p.city}`} className={`ib-pin ${on ? 'on' : ''} ${out ? 'out' : ''}`} transform={`translate(${p.x},${p.y})`} role="button" tabIndex={0}
            onClick={() => (single ? onSelect(p.rows[0].fund.fund_id) : onCity(p.city))}
            onKeyDown={(e) => { if (e.key === 'Enter') { if (single) onSelect(p.rows[0].fund.fund_id); else onCity(p.city); } }}>
            <title>{`${p.city}: ${p.rows.map((r) => r.fund.name).join(', ')}`}</title>
            <g className={`gp ${on ? 'on' : ''}`}><GoldPin count={p.rows.length} big={on} /></g>
            <text x="13" y="-14" className="ib-pin-label">{p.city}</text>
          </g>;
        })}
      </svg>
      <nav className="ib-zones" aria-label="Zona del mapa">
        <button className={isZone({ kind: 'all' }) ? 'on' : ''} onClick={() => onZone({ kind: 'all' })}>Todas <b>{rows.length}</b></button>
        {zones.continents.map((c) => <button key={c.id} className={isZone({ kind: 'continent', id: c.id }) ? 'on' : ''} onClick={() => onZone({ kind: 'continent', id: c.id })}>{c.id} <b>{c.n}</b></button>)}
        {zones.countries.map((c) => <button key={c.id} className={isZone({ kind: 'country', id: c.id }) ? 'on' : ''} onClick={() => onZone({ kind: 'country', id: c.id })}>{c.name} <b>{c.n}</b></button>)}
      </nav>
      <div className="ib-zoom">
        <button onClick={() => zoomBy(1.8)} aria-label="Acercar"><Plus size={15} /></button>
        <button onClick={() => zoomBy(1 / 1.8)} aria-label="Alejar"><Minus size={15} /></button>
        <button onClick={() => fly(boxFor(zone))} aria-label="Volver a encuadrar"><RotateCcw size={14} /></button>
      </div>
    </div>
  );
}
