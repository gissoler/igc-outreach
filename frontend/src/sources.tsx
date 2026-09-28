import { BookOpen, Database, FlaskConical, Globe, Link2, Route, Search, Users } from 'lucide-react';
import { useState } from 'react';
import type { Evidence, Lead } from './researchApi';

/* Origen de cada dato: agrupa los proveedores reales (Apify, OpenAlex, Grants.gov…) en familias legibles. */
export type SourceKey = 'linkedin' | 'public_db' | 'science' | 'search' | 'web' | 'network' | 'demo';
export const SOURCE_META: Record<SourceKey, { label: string; hint: string; color: string; icon: typeof Globe }> = {
  linkedin: { label: 'LinkedIn', hint: 'Profiles and public activity', color: '#0a66c2', icon: Link2 },
  public_db: { label: 'Public databases', hint: 'Grants.gov · NIH · ClinicalTrials · SEC', color: '#6d5dfc', icon: Database },
  science: { label: 'Publications', hint: 'OpenAlex · PubMed', color: '#23a07a', icon: BookOpen },
  search: { label: 'Web search', hint: 'Exa · Serper · funding rounds', color: '#0f9fb5', icon: Search },
  web: { label: 'Official websites', hint: 'Company and foundation sites', color: '#d08a1e', icon: Globe },
  network: { label: 'Your network', hint: 'Imported contacts and calendar', color: '#d0487a', icon: Users },
  demo: { label: 'Demo', hint: 'Fictional data', color: '#9aa0ad', icon: FlaskConical },
};
export const SOURCE_ORDER: SourceKey[] = ['linkedin', 'public_db', 'science', 'search', 'web', 'network', 'demo'];

export function classifySource(source = '', url = ''): SourceKey {
  const s = `${source} ${url}`.toLowerCase();
  if (/fixture|demostraci|example\.org/.test(s)) return 'demo';
  if (/linkedin|apify/.test(s)) return 'linkedin';
  if (/calendar|calendario|contacts|contactos|\bcsv\b|gmail|outlook/.test(s)) return 'network';
  if (/\bexa\b|serper/.test(s)) return 'search';
  if (/openalex|pubmed|ncbi|doi\.org|orcid/.test(s)) return 'science';
  if (/grants\.gov|reporter|nih\.gov|clinicaltrials|sec\.gov|edgar|cdmrp|\.gov\b/.test(s)) return 'public_db';
  return 'web';
}
export const evidenceKind = (e: Evidence) => classifySource(e.source, e.url);
/** Proveedor concreto que se muestra junto a la familia (p. ej. "vía Apify"). */
export const providerName = (e: Evidence) => /apify/i.test(e.source) ? 'Public profile (legacy source)' : e.source;

type Hop = Lead['paths'][number]['hops'][number];
export function hopKind(hop: Hop, lead: Lead): SourceKey {
  const ev = lead.evidence.filter((e) => hop.evidenceIds.includes(e.id));
  const kinds = ev.map(evidenceKind);
  const pick = SOURCE_ORDER.find((k) => kinds.includes(k) && k !== 'web') || kinds[0];
  return pick || classifySource(hop.relation, hop.url || '');
}
export const leadKinds = (lead: Lead) => SOURCE_ORDER.filter((k) => lead.evidence.some((e) => evidenceKind(e) === k));

export function SourceChip({ kind, detail }: { kind: SourceKey; detail?: string }) {
  const m = SOURCE_META[kind];
  const Icon = m.icon;
  return <span className="src-chip" style={{ ['--src' as string]: m.color }} title={detail ? `${m.label} · ${detail}` : m.hint}><Icon size={12} strokeWidth={2} />{m.label}{detail && <em>{detail}</em>}</span>;
}
export function SourceDots({ lead }: { lead: Lead }) {
  const kinds = leadKinds(lead);
  return <span className="src-dots" aria-label={`Sources: ${kinds.map((k) => SOURCE_META[k].label).join(', ')}`}>{kinds.map((k) => <i key={k} style={{ background: SOURCE_META[k].color }} title={SOURCE_META[k].label} />)}{lead.paths.length > 0 && <b title="Has warm path"><Route size={12} /> warm path</b>}</span>;
}

const pctOf = (v: number, t: number) => (t ? Math.round((v / t) * 100) : 0);
const initials = (s: string) => s.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

/* ───────── Resumen: de qué fuentes viene todo y cuántos warm paths hay ───────── */
const BUCKETS: { id: string; label: string }[] = [{ id: 'top', label: 'Priority' }, { id: 'radar', label: 'Radar' }, { id: 'discarded', label: 'Discarded' }];

export function SourcesOverview({ leads, onPick }: { leads: Lead[]; onPick?: (lead: Lead) => void }) {
  const counts = new Map<SourceKey, number>();
  const flows = new Map<string, number>();
  for (const l of leads) for (const e of l.evidence) {
    const k = evidenceKind(e);
    counts.set(k, (counts.get(k) || 0) + 1);
    flows.set(`${k}|${l.bucket}`, (flows.get(`${k}|${l.bucket}`) || 0) + 1);
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  const kinds = SOURCE_ORDER.filter((k) => counts.get(k));
  const warm = leads.filter((l) => l.paths.length && l.bucket !== 'discarded').sort((a, b) => (b.paths[0]?.strength || 0) - (a.paths[0]?.strength || 0));
  const active = leads.filter((l) => l.bucket !== 'discarded').length;
  const hopCounts = new Map<SourceKey, number>();
  for (const l of warm) for (const h of l.paths[0].hops) { const k = hopKind(h, l); hopCounts.set(k, (hopCounts.get(k) || 0) + 1); }

  /* Donut */
  const R = 54, C = 2 * Math.PI * R;
  let offset = 0;
  const arcs = kinds.map((k) => { const v = counts.get(k)!; const len = (v / total) * C; const a = { k, len, off: offset }; offset += len; return a; });

  return <section className="src-overview" aria-label="Where results come from">
    <article className="src-card">
      <header><h3>Where does the data come from?</h3><small>{total} evidence · {leads.length} candidatos</small></header>
      <div className="src-donut-wrap">
        <svg viewBox="0 0 140 140" className="src-donut" role="img" aria-label="Evidence by source type">
          <circle cx="70" cy="70" r={R} fill="none" stroke="var(--frame)" strokeWidth="16" />
          {arcs.map((a) => <circle key={a.k} cx="70" cy="70" r={R} fill="none" stroke={SOURCE_META[a.k].color} strokeWidth="16" strokeDasharray={`${Math.max(a.len - 2, 0.5)} ${C}`} strokeDashoffset={-a.off} transform="rotate(-90 70 70)" strokeLinecap="butt" />)}
          <text x="70" y="68" textAnchor="middle" className="src-donut-num">{total}</text>
          <text x="70" y="86" textAnchor="middle" className="src-donut-lbl">evidence</text>
        </svg>
        <ul className="src-legend">{kinds.map((k) => { const v = counts.get(k)!; const Icon = SOURCE_META[k].icon; return <li key={k}><i style={{ background: SOURCE_META[k].color }} /><span><b><Icon size={12} /> {SOURCE_META[k].label}</b><small>{SOURCE_META[k].hint}</small></span><em>{v}</em><strong>{pctOf(v, total)}%</strong></li>; })}</ul>
      </div>
    </article>

    <article className="src-card">
      <header><h3>From source to result</h3><small>Thickness = evidence count</small></header>
      <SourceFlow kinds={kinds} counts={counts} flows={flows} />
    </article>

    <article className="src-card src-warm">
      <header><h3>Warm paths</h3><small>Documented relationships to candidates</small></header>
      <div className="src-warm-kpi"><strong>{warm.length}</strong><span>of {active} active candidates<br />have a warm path</span></div>
      <div className="src-bar" aria-hidden="true"><i style={{ width: `${pctOf(warm.length, active)}%` }} /></div>
      {hopCounts.size > 0 && <p className="src-sub">Links by source</p>}
      <div className="src-hop-bars">{SOURCE_ORDER.filter((k) => hopCounts.get(k)).map((k) => { const max = Math.max(...hopCounts.values()); return <div key={k}><span>{SOURCE_META[k].label}</span><i><b style={{ width: `${(hopCounts.get(k)! / max) * 100}%`, background: SOURCE_META[k].color }} /></i><em>{hopCounts.get(k)}</em></div>; })}</div>
      <ul className="src-warm-list">{warm.slice(0, 3).map((l) => <li key={l.id}><button onClick={() => onPick?.(l)}><MiniPath lead={l} /><small>{Math.round(l.paths[0].strength * 100)}%</small></button></li>)}</ul>
      {!warm.length && <p className="src-empty">No documented paths yet. Map your LinkedIn activity again.</p>}
    </article>
  </section>;
}

function SourceFlow({ kinds, counts, flows }: { kinds: SourceKey[]; counts: Map<SourceKey, number>; flows: Map<string, number> }) {
  const W = 320, H = 190, gap = 10, x0 = 88, x1 = W - 88, nodeW = 8, minH = 14;
  const buckets = BUCKETS.filter((b) => kinds.some((k) => flows.get(`${k}|${b.id}`)));
  /* Alturas proporcionales con un mínimo legible; los enlaces se reparten dentro de cada nodo. */
  const sizes = (vals: number[]) => {
    const avail = H - gap * Math.max(vals.length - 1, 0);
    const tot = vals.reduce((a, b) => a + b, 0) || 1;
    const small = vals.filter((v) => (v / tot) * avail < minH);
    const bigTot = vals.filter((v) => (v / tot) * avail >= minH).reduce((a, b) => a + b, 0) || 1;
    const rest = avail - small.length * minH;
    return vals.map((v) => ((v / tot) * avail < minH ? minH : (v / bigTot) * rest));
  };
  const lh = sizes(kinds.map((k) => counts.get(k)!));
  let y = 0;
  const left = kinds.map((k, i) => { const n = { k, v: counts.get(k)!, y, h: lh[i], cur: y }; y += lh[i] + gap; return n; });
  const rv = buckets.map((b) => kinds.reduce((s, k) => s + (flows.get(`${k}|${b.id}`) || 0), 0));
  const rh = sizes(rv);
  y = 0;
  const right = buckets.map((b, i) => { const n = { ...b, v: rv[i], y, h: rh[i], cur: y }; y += rh[i] + gap; return n; });
  const links = left.flatMap((l) => right.map((r) => { const v = flows.get(`${l.k}|${r.id}`) || 0; if (!v) return null; const a = l.cur, hl = (v / l.v) * l.h; l.cur += hl; const b = r.cur, hr = (v / r.v) * r.h; r.cur += hr; return { k: l.k, a, hl, b, hr, v, id: `${l.k}-${r.id}` }; })).filter(Boolean) as { k: SourceKey; a: number; hl: number; b: number; hr: number; v: number; id: string }[];
  const mx = (x0 + nodeW + x1) / 2;
  if (!kinds.length) return <p className="src-empty">No evidence yet.</p>;
  return <svg viewBox={`0 0 ${W} ${H}`} className="src-flow" role="img" aria-label="Evidence flow from each source to each result list">
    {links.map((l) => <path key={l.id} d={`M${x0 + nodeW},${l.a} C${mx},${l.a} ${mx},${l.b} ${x1},${l.b} L${x1},${l.b + l.hr} C${mx},${l.b + l.hr} ${mx},${l.a + l.hl} ${x0 + nodeW},${l.a + l.hl} Z`} fill={SOURCE_META[l.k].color} opacity=".28"><title>{`${SOURCE_META[l.k].label} → ${BUCKETS.find((b) => l.id.endsWith(b.id))?.label}: ${l.v}`}</title></path>)}
    {left.map((n) => <g key={n.k}><rect x={x0} y={n.y} width={nodeW} height={n.h} rx="3" fill={SOURCE_META[n.k].color} /><text x={x0 - 6} y={n.y + n.h / 2 + 4} textAnchor="end" className="src-flow-lbl">{SOURCE_META[n.k].label}</text></g>)}
    {right.map((n) => <g key={n.id}><rect x={x1} y={n.y} width={nodeW} height={n.h} rx="3" fill="var(--blue)" /><text x={x1 + nodeW + 6} y={n.y + n.h / 2 + 4} className="src-flow-lbl">{n.label} <tspan className="src-flow-num">{n.v}</tspan></text></g>)}
  </svg>;
}

function MiniPath({ lead }: { lead: Lead }) {
  const p = lead.paths[0];
  return <span className="src-mini">{p.nodes.map((n, i) => <span key={i} className="src-mini-step">{i > 0 && <i style={{ background: SOURCE_META[hopKind(p.hops[i - 1], lead)].color }} />}<b title={n}>{initials(n)}</b></span>)}<em>{lead.person || lead.org}</em></span>;
}

/* ───────── Detalle: el warm path dibujado, con la fuente de cada eslabón ───────── */
export function WarmPathGraph({ lead, you }: { lead: Lead; you: string }) {
  const [idx, setIdx] = useState(0);
  const target = lead.person || lead.org;
  const targetKinds = leadKinds(lead);
  const p = lead.paths[idx];
  if (!p) {
    const channel = lead.contact ? classifySource(lead.contact.provenance, lead.contact.value) : null;
    return <div className="wp-card">
      <header><h3>Path to {target}</h3><span className="rs-badge unknown">No documented warm path</span></header>
      <div className="wp-chain">
        <PathNode name={you || 'You'} role="You" you />
        <div className="wp-edge cold"><span className="wp-line" /><small>{lead.contact ? `Direct contact · ${lead.contact.type === 'email' ? 'public email' : 'public channel'}` : 'No channel or relationship'}</small>{channel && <SourceChip kind={channel} />}</div>
        <PathNode name={target} role={lead.role || lead.org} kinds={targetKinds} />
      </div>
      <p className="wp-note">No documented relationship. Connect more sources to find intros.</p>
    </div>;
  }
  const weakest = Math.min(...p.hops.map((h) => h.strength));
  return <div className="wp-card">
    <header><h3>Warm path to {target}</h3>
      {lead.paths.length > 1 && <div className="wp-tabs" role="tablist">{lead.paths.map((_, i) => <button key={i} role="tab" aria-selected={i === idx} onClick={() => setIdx(i)}>Path {i + 1}</button>)}</div>}
    </header>
    <div className="wp-chain">
      {p.nodes.map((n, i) => {
        const hop = i > 0 ? p.hops[i - 1] : null;
        const kind = hop ? hopKind(hop, lead) : null;
        return <div className="wp-seg" key={i}>
          {hop && kind && <div className={`wp-edge ${hop.strength === weakest && p.hops.length > 1 ? 'weak' : ''}`} style={{ ['--src' as string]: SOURCE_META[kind].color }}>
            <SourceChip kind={kind} />
            <span className="wp-line"><i style={{ width: `${Math.round(hop.strength * 100)}%` }} /></span>
            <small>{hop.url ? <a href={hop.url} target="_blank" rel="noreferrer">{hop.relation} ↗</a> : hop.relation}</small>
          </div>}
          <PathNode name={n} role={i === 0 ? 'You' : i === p.nodes.length - 1 ? (lead.role || lead.org) : 'Connector'} you={i === 0} connector={i > 0 && i < p.nodes.length - 1} kinds={i === p.nodes.length - 1 ? targetKinds : undefined} />
        </div>;
      })}
    </div>
    <footer className="wp-foot">
      <span><small>Path strength</small><b>{Math.round(p.strength * 100)}%</b><i className="wp-meter"><b style={{ width: `${Math.round(p.strength * 100)}%` }} /></i></span>
      <span><small>Weakest link</small><b>{Math.round(weakest * 100)}%</b></span>
      <span><small>Status</small><b>{p.hypothesis ? 'Hypothesis' : 'Verified relationship'}</b></span>
    </footer>
  </div>;
}

function PathNode({ name, role, you, connector, kinds }: { name: string; role: string; you?: boolean; connector?: boolean; kinds?: SourceKey[] }) {
  return <div className={`wp-node ${you ? 'you' : connector ? 'connector' : 'target'}`}>
    <span className="wp-avatar">{initials(name)}</span>
    <b title={name}>{name}</b>
    <small title={role}>{role}</small>
    {kinds && kinds.length > 0 && <span className="wp-node-src">{kinds.map((k) => <i key={k} style={{ background: SOURCE_META[k].color }} title={`Found in ${SOURCE_META[k].label}`} />)}</span>}
  </div>;
}
