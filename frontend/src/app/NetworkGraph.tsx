/* ─────────────────────────────────────────────────────────────────────────────
   Relationship map: You → direct contacts → second degree → candidates.
   Card nodes in deterministic columns (same evaluation, same picture), smooth
   connectors, and a profile popover. Visual reference: "Contact relationship map"
   (Eugen Eşanu, Dribbble) in the Plan CRM system. d3-zoom for pan and zoom.
   ───────────────────────────────────────────────────────────────────────────── */
import { ChevronRight, Maximize2, Minus, Plus, Search, X } from 'lucide-react';
import { select } from 'd3-selection';
import 'd3-transition';
import { zoom as d3zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from 'd3-zoom';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { NetworkGraphData } from '../accountApi';
import type { Job } from '../researchApi';
import { clip, fmtPct, initials } from './format';
import { buildGraph, GKIND_LABEL, RELATION_LABEL, STATUS_LABEL, type GEdge, type GNode, type Graph } from './model';

type Pos = { x: number; y: number; col: number };
const W = 232, H = 60, PITCH = 76, COLGAP = 132;
const BUCKET_ORDER: Record<string, number> = { top: 0, radar: 1, discarded: 2 };
const reduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const TINT: Record<string, string> = { team: 'mint', contact: 'sky', intermediary: 'sun', candidate: 'lav', investor: 'lav' };

type Layout = { pos: Map<string, Pos>; cols: { x: number; label: string; count: number }[]; width: number; height: number };
function layout(nodes: GNode[], edges: GEdge[]): Layout {
  const pos = new Map<string, Pos>();
  const leads = nodes.filter((n) => n.leadId).sort((a, b) => (BUCKET_ORDER[a.bucket || 'top'] - BUCKET_ORDER[b.bucket || 'top']) || (b.score || 0) - (a.score || 0));
  const others = nodes.filter((n) => !n.leadId && n.id !== 'you');
  const adj = new Map<string, string[]>();
  for (const e of edges) { adj.set(e.from, [...(adj.get(e.from) || []), e.to]); adj.set(e.to, [...(adj.get(e.to) || []), e.from]); }
  const isLead = new Set(leads.map((n) => n.id));
  // Distance from you, never walking through a candidate.
  const dist = new Map<string, number>([['you', 0]]);
  const q = ['you'];
  while (q.length) { const c = q.shift()!; for (const n of adj.get(c) || []) if (!dist.has(n) && !isLead.has(n)) { dist.set(n, dist.get(c)! + 1); q.push(n); } }
  const col1 = others.filter((n) => (dist.get(n.id) ?? 1) <= 1);
  const col2 = others.filter((n) => (dist.get(n.id) ?? 1) >= 2);
  const leadCol = col2.length ? 3 : col1.length ? 2 : 1;
  const xOf = (c: number) => c * (W + COLGAP);
  leads.forEach((n, i) => pos.set(n.id, { x: xOf(leadCol), y: i * PITCH, col: leadCol }));
  // Connectors sit at the average height of the candidates they reach, then overlaps are pushed down.
  const reachY = (id: string, seen = new Set<string>()): number[] => {
    seen.add(id);
    return (adj.get(id) || []).flatMap((n) => (isLead.has(n) ? [pos.get(n)!.y] : !seen.has(n) && n !== 'you' && seen.size < 6 ? reachY(n, seen) : []));
  };
  const place = (list: GNode[], col: number) => {
    const want = list.map((n) => { const ys = reachY(n.id); return { n, y: ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : Infinity }; });
    const linked = want.filter((w) => Number.isFinite(w.y)).sort((a, b) => a.y - b.y);
    let last = -Infinity;
    for (const w of linked) { const y = Math.max(w.y, last + PITCH); pos.set(w.n.id, { x: xOf(col), y, col }); last = y; }
    const loose = want.filter((w) => !Number.isFinite(w.y)).sort((a, b) => a.n.label.localeCompare(b.n.label));
    let y = Math.max(last + PITCH * 1.5, linked.length ? 0 : 0);
    for (const w of loose) { pos.set(w.n.id, { x: xOf(col), y, col }); y += PITCH; }
  };
  place(col2, 2);
  // Direct contacts: aim for the second-degree people they introduce, else the candidates.
  const want1 = col1.map((n) => { const ys = (adj.get(n.id) || []).map((m) => pos.get(m)?.y).filter((v): v is number => v != null); return { n, y: ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : Infinity }; });
  let last = -Infinity;
  const linkedY: number[] = [];
  for (const w of want1.filter((v) => Number.isFinite(v.y)).sort((a, b) => a.y - b.y)) { const y = Math.max(w.y, last + PITCH); pos.set(w.n.id, { x: xOf(1), y, col: 1 }); last = y; linkedY.push(y); }
  let y1 = Math.max(0, last + PITCH * 1.5);
  for (const w of want1.filter((v) => !Number.isFinite(v.y)).sort((a, b) => a.n.label.localeCompare(b.n.label))) { pos.set(w.n.id, { x: xOf(1), y: y1, col: 1 }); y1 += PITCH; }
  const youY = linkedY.length ? linkedY[0] : 0;
  pos.set('you', { x: 0, y: Math.max(0, youY), col: 0 });
  const count = (c: number) => [...pos.values()].filter((p) => p.col === c).length;
  const cols = [{ x: 0, label: 'You', count: 1 }];
  if (col1.length) cols.push({ x: xOf(1), label: 'Direct contacts', count: count(1) });
  if (col2.length) cols.push({ x: xOf(2), label: 'Second degree', count: count(2) });
  if (leads.length) cols.push({ x: xOf(leadCol), label: 'Candidates', count: leads.length });
  const ys = [...pos.values()].map((p) => p.y);
  return { pos, cols, width: xOf(leadCol) + W, height: Math.max(...ys, 0) + H };
}

function connector(a: Pos, b: Pos) {
  const [s, t] = a.x <= b.x ? [a, b] : [b, a];
  if (s.col === t.col) { const x = s.x + W; const bend = 46 + Math.min(80, Math.abs(t.y - s.y) * 0.15); return { d: `M${x},${s.y + H / 2} C${x + bend},${s.y + H / 2} ${x + bend},${t.y + H / 2} ${x},${t.y + H / 2}`, p1: { x, y: s.y + H / 2 }, p2: { x, y: t.y + H / 2 } }; }
  const x1 = s.x + W, y1 = s.y + H / 2, x2 = t.x, y2 = t.y + H / 2, m = (x2 - x1) * 0.5;
  return { d: `M${x1},${y1} C${x1 + m},${y1} ${x2 - m},${y2} ${x2},${y2}`, p1: { x: x1, y: y1 }, p2: { x: x2, y: y2 } };
}

export type GraphSelection = { kind: 'edge'; edge: GEdge } | { kind: 'node'; node: GNode };
export function NetworkGraph({ job, account, selectedLeadId, onSelectLead, onInspect, height = 620, demo = false, mode = 'evaluation', inset = 0 }: {
  job: Job; account: NetworkGraphData | null; selectedLeadId: string | null; onSelectLead: (id: string | null) => void; onInspect: (sel: GraphSelection) => void; height?: number; demo?: boolean; mode?: 'evaluation' | 'network'; inset?: number;
}) {
  const [scope, setScope] = useState(30);
  const [includeDiscarded, setIncludeDiscarded] = useState(false);
  const [only, setOnly] = useState<'all' | 'paths'>('all');
  const [query, setQuery] = useState('');
  const [pop, setPop] = useState<GNode | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; text: string; sub: string } | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const world = useRef<HTMLDivElement>(null);
  const zoomRef = useRef<ZoomBehavior<HTMLDivElement, unknown> | null>(null);
  const [t, setT] = useState<ZoomTransform>(zoomIdentity);
  const [size, setSize] = useState({ w: 900, h: height });

  const full: Graph = useMemo(() => buildGraph(job, account, { limit: scope, includeDiscarded, ensure: selectedLeadId }), [job, account, scope, includeDiscarded, selectedLeadId]);
  const selectedLead = job.leads.find((l) => l.id === selectedLeadId) || null;
  const path = useMemo(() => { const r = selectedLead ? full.pathEdges.get(selectedLead.id) : null; return { ids: r?.all || new Set<string>(), best: r?.best || new Set<string>() }; }, [full, selectedLead]);

  const visible = useMemo(() => {
    let edges = full.edges.filter((e) => e.rel !== 'affiliation' && (e.rel !== 'cold_channel' || path.ids.has(e.id)));
    let nodes = full.nodes.filter((n) => n.kind !== 'organization' || n.leadId);
    if (mode === 'evaluation' || only === 'paths') {
      // Keep only people that lead somewhere: connectors on a path to a candidate.
      const onAny = new Set<string>();
      for (const r of full.pathEdges.values()) for (const id of (only === 'paths' && selectedLead ? path.ids : r.all)) { const [a, b] = id.split('>'); onAny.add(a); onAny.add(b); }
      nodes = nodes.filter((n) => n.id === 'you' || n.leadId || onAny.has(n.id));
      if (only === 'paths' && selectedLead) { nodes = nodes.filter((n) => !n.leadId || n.leadId === selectedLead.id); edges = edges.filter((e) => path.ids.has(e.id)); }
    }
    const ids = new Set(nodes.map((n) => n.id));
    edges = edges.filter((e) => ids.has(e.from) && ids.has(e.to));
    return { nodes, edges };
  }, [full, mode, only, selectedLead, path]);
  const L = useMemo(() => layout(visible.nodes, visible.edges), [visible]);
  const onPath = useMemo(() => new Set(visible.edges.filter((e) => path.ids.has(e.id)).flatMap((e) => [e.from, e.to])), [visible, path]);
  const dim = !!selectedLead && only === 'all';

  useEffect(() => {
    const el = stage.current; if (!el) return;
    const ro = new ResizeObserver(([entry]) => setSize({ w: Math.max(320, entry.contentRect.width), h: Math.max(320, entry.contentRect.height) }));
    ro.observe(el); return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const el = stage.current; if (!el) return;
    const z = d3zoom<HTMLDivElement, unknown>().scaleExtent([0.25, 2.5])
      .filter((ev: Event) => (ev.type === 'wheel' ? (ev as WheelEvent).ctrlKey || (ev as WheelEvent).metaKey : !(ev as MouseEvent).button) && !(ev.target as HTMLElement).closest?.('.rm-card, .rm-pop, button, input, select'))
      .on('zoom', (ev) => setT(ev.transform));
    select(el).call(z).on('dblclick.zoom', null);
    zoomRef.current = z;
    /* Feedback 28/09 ("the screen shifts and won't let me go back"): a plain wheel used to pan the
       map and block page scrolling. Now the wheel scrolls the page; drag pans; ⌘/Ctrl + wheel zooms. */
    return () => { select(el).on('.zoom', null); };
  }, []);
  const apply = (tr: ZoomTransform) => { if (!stage.current || !zoomRef.current) return; const s = select(stage.current); if (reduced()) s.call(zoomRef.current.transform, tr); else s.transition().duration(380).call(zoomRef.current.transform, tr); };
  const fit = (ids?: string[]) => {
    const pts = (ids?.length ? ids : [...L.pos.keys()]).map((id) => L.pos.get(id)).filter(Boolean) as Pos[];
    if (!pts.length) return;
    const x0 = Math.min(...pts.map((p) => p.x)) - 40, x1 = Math.max(...pts.map((p) => p.x)) + W + 40;
    const y0 = Math.min(...pts.map((p) => p.y)) - 70, y1 = Math.max(...pts.map((p) => p.y)) + H + 40;
    const k = ids ? Math.min(1, Math.max(0.35, Math.min(Math.max(320, size.w - inset) / (x1 - x0), size.h / (y1 - y0)))) : Math.min(1, Math.max(0.6, size.w / (x1 - x0)));
    const top = ids ? size.h / 2 - k * (y0 + y1) / 2 : 24 - k * y0;
    const vw = Math.max(320, size.w - (ids ? inset : 0));
    apply(zoomIdentity.translate(vw / 2 - k * (x0 + x1) / 2, Math.min(top, ids ? top : 24 - k * y0)).scale(k));
  };
  const zoomBy = (f: number) => { if (stage.current && zoomRef.current) select(stage.current).transition().duration(200).call(zoomRef.current.scaleBy, f); };
  const sig = `${visible.nodes.length}|${size.w}|${size.h}|${only}|${selectedLeadId}|${inset}`;
  useEffect(() => {
    if (selectedLeadId) { const ids = ['you', `lead:${selectedLeadId}`, ...onPath]; fit(ids); } else fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  const matches = query.trim().length >= 2 ? visible.nodes.filter((n) => `${n.label} ${n.sub}`.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 7) : [];
  const focus = (n: GNode) => { const p = L.pos.get(n.id); if (p) apply(zoomIdentity.translate(size.w / 2 - (p.x + W / 2), size.h / 2 - (p.y + H / 2)).scale(1)); };
  const pick = (n: GNode) => { setPop(null); if (n.leadId) onSelectLead(n.leadId); else setPop(n); };
  const selId = selectedLeadId ? `lead:${selectedLeadId}` : null;
  const reach = (n: GNode) => { const ids = new Set<string>(); for (const [lid, r] of full.pathEdges) for (const id of r.all) if (id.split('>').includes(n.id)) ids.add(lid); return job.leads.filter((l) => ids.has(l.id)); };
  const degree = (id: string) => visible.edges.filter((e) => e.from === id || e.to === id).length;
  const popPos = pop ? L.pos.get(pop.id) : null;
  const people = visible.nodes.filter((n) => !n.leadId && n.id !== 'you').length;
  const leadsN = visible.nodes.filter((n) => n.leadId).length;

  return <section className="rm" aria-label="Relationship map">
    <div className="rm-bar" role="toolbar" aria-label="Map controls">
      <div className="rm-search">
        <Search size={15} aria-hidden="true" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search people" aria-label="Search the map" onKeyDown={(e) => { if (e.key === 'Enter' && matches[0]) { focus(matches[0]); pick(matches[0]); setQuery(''); } if (e.key === 'Escape') setQuery(''); }} />
        {query && <button className="rm-x" aria-label="Clear" onClick={() => setQuery('')}><X size={13} /></button>}
        {matches.length > 0 && <ul className="rm-results" role="listbox">{matches.map((n) => <li key={n.id}><button role="option" aria-selected="false" onClick={() => { focus(n); pick(n); setQuery(''); }}><b>{n.label}</b><small>{GKIND_LABEL[n.kind]} · {clip(n.sub, 44)}</small></button></li>)}</ul>}
      </div>
      <div className="pl-seg" role="group" aria-label="Show">
        <button className={only === 'all' ? 'on' : ''} aria-pressed={only === 'all'} onClick={() => setOnly('all')}>{mode === 'network' ? 'Everyone' : 'All paths'}</button>
        <button className={only === 'paths' ? 'on' : ''} aria-pressed={only === 'paths'} onClick={() => setOnly('paths')} disabled={mode === 'evaluation' && !selectedLead} title={mode === 'evaluation' && !selectedLead ? 'Select a candidate first' : undefined}>{mode === 'network' ? 'Linked to candidates' : 'Selected only'}</button>
      </div>
      {job.leads.length > 0 && <label className="pl-select"><select value={`${scope}|${includeDiscarded ? 1 : 0}`} onChange={(e) => { const [s, d] = e.target.value.split('|'); setScope(Number(s)); setIncludeDiscarded(d === '1'); }} aria-label="Candidates shown">
        <option value="15|0">Top 15</option><option value="30|0">Top 30</option><option value="60|0">Top 60</option><option value="1000|0">All active</option><option value="1000|1">All incl. discarded</option>
      </select></label>}
      <span className="rm-zoom"><button onClick={() => zoomBy(1 / 1.25)} aria-label="Zoom out"><Minus size={15} /></button><span>{Math.round(t.k * 100)}%</span><button onClick={() => zoomBy(1.25)} aria-label="Zoom in"><Plus size={15} /></button><button onClick={() => fit()} aria-label="Fit to screen"><Maximize2 size={14} /></button></span>
      <span className="rm-hint">Drag to move · ⌘/Ctrl + scroll to zoom</span>
    </div>
    <div className="rm-stage" ref={stage} style={{ height }} onClick={(e) => { if (e.target === e.currentTarget) setPop(null); }}>
      <div className="rm-world" ref={world} style={{ transform: `translate(${t.x}px,${t.y}px) scale(${t.k})` }}>
        {L.cols.map((c) => <span key={c.label} className="rm-col" style={{ left: c.x, top: -52 }}>{c.label} <em>{c.count}</em></span>)}
        <svg className="rm-svg" width={L.width + 200} height={L.height + 40} style={{ overflow: 'visible' }} aria-hidden="true">
          {visible.edges.map((e) => {
            const a = L.pos.get(e.from), b = L.pos.get(e.to); if (!a || !b) return null;
            const c = connector(a, b);
            const on = path.ids.has(e.id), best = path.best.has(e.id);
            return <g key={e.id} className={`rm-edge ${e.type} ${on ? 'on' : ''} ${best ? 'best' : ''} ${dim && !on ? 'dim' : ''}`}>
              <path d={c.d} className="rm-hit" onClick={() => onInspect({ kind: 'edge', edge: e })} onMouseMove={(ev) => setTip({ x: ev.clientX, y: ev.clientY, text: `${RELATION_LABEL[e.rel]}`, sub: `${STATUS_LABEL[e.type].split(' ·')[0]}${e.strength != null ? ` · strength ${fmtPct(e.strength)}` : ''}` })} onMouseLeave={() => setTip(null)} />
              <path d={c.d} className="rm-line" />
              <circle cx={c.p1.x} cy={c.p1.y} r={4} className="rm-port" /><circle cx={c.p2.x} cy={c.p2.y} r={4} className="rm-port" />
            </g>;
          })}
        </svg>
        {visible.nodes.map((n) => {
          const p = L.pos.get(n.id); if (!p) return null;
          const sel = n.id === selId, on = onPath.has(n.id) || sel || n.id === 'you';
          const you = n.id === 'you';
          return <button key={n.id} className={`rm-card ${you ? 'you' : ''} ${n.leadId ? `lead b-${n.bucket}` : `k-${n.kind}`} ${sel ? 'sel' : ''} ${pop?.id === n.id ? 'sel' : ''} ${dim && !on ? 'dim' : ''}`} style={{ left: p.x, top: p.y, width: W, height: H }}
            onClick={() => pick(n)} aria-label={`${n.leadId ? 'Candidate' : GKIND_LABEL[n.kind]}: ${n.label}. ${n.sub}${n.score != null ? `. Score ${n.score}` : ''}`}>
            <span className={`rm-av ${you ? 'ink' : TINT[n.kind] || 'sky'}`}>{you ? 'You' : initials(n.label)}</span>
            <span className="rm-txt"><b>{you ? n.label : n.label}</b><small>{you ? 'Starting point' : n.leadId ? n.sub : GKIND_LABEL[n.kind] === 'Intermediario' ? 'Connector' : clip(n.sub, 40)}</small></span>
            {n.leadId && <span className="rm-score"><i className={`dot ${n.bucket}`} />{n.score}</span>}
            {!n.leadId && !you && degree(n.id) > 1 && <span className="rm-deg">{degree(n.id)}</span>}
          </button>;
        })}
        {pop && popPos && <div className="rm-pop" style={{ left: popPos.x + W + 14, top: popPos.y - 6 }} role="dialog" aria-label={pop.label}>
          <button className="rm-pop-x" onClick={() => setPop(null)} aria-label="Close"><X size={15} /></button>
          <span className={`rm-av lg ${TINT[pop.kind] || 'sky'}`}>{initials(pop.label)}</span>
          <b className="rm-pop-name">{pop.label}</b>
          <p className="rm-pop-sub">{clip(pop.sub, 90)}</p>
          <dl><dt>Type</dt><dd><span className="pl-chip gray">{GKIND_LABEL[pop.kind]}</span></dd><dt>Connections</dt><dd>{degree(pop.id)}</dd></dl>
          {reach(pop).length > 0 && <div className="rm-pop-leads"><span>Can introduce you to</span>{reach(pop).slice(0, 4).map((l) => <button key={l.id} onClick={() => { setPop(null); onSelectLead(l.id); }}>{l.person || l.org} <ChevronRight size={13} /></button>)}</div>}
          <button className="rm-pop-foot" onClick={() => { onInspect({ kind: 'node', node: pop }); setPop(null); }}>View relationships</button>
        </div>}
      </div>
      {tip && <div className="rm-tip" style={{ left: Math.min(tip.x + 12, window.innerWidth - 260), top: tip.y + 12 }}><b>{tip.text}</b><span>{tip.sub}</span></div>}
      {visible.edges.length === 0 && <div className="rm-empty"><b>No relationships yet</b><span>{mode === 'network' ? 'Import contacts in Setup → Network.' : 'None of your contacts connect to these candidates yet.'}</span></div>}
    </div>
    <footer className="rm-legend">
      <span><i className="ln verified" />Verified</span><span><i className="ln documented" />Documented</span><span><i className="ln hypothesis" />Hypothesis</span><span><i className="ln best" />Best path</span>
      <span className="rm-legend-r">{people} people · {leadsN} candidates · {visible.edges.length} links{full.truncated > 0 ? ` · ${full.truncated} not shown` : ''}{demo ? ' · demo' : ''}</span>
    </footer>
  </section>;
}
