import { ArrowDownWideNarrow, Columns3, Download, FileDown, Route, Search, SlidersHorizontal, Star, X } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import type { Job, Lead } from '../researchApi';
import { API } from '../researchApi';
import { SOURCE_META, type SourceKey } from '../sources';
import { clip, fmtPct } from './format';
import { BUCKET_PLURAL, bestPath, CONF_RANK, familyOf, isDemoJob, nextAction, STATUS_LABEL, warmPlanOf, warmShort } from './model';
import { readNote } from './Detail';
import { BucketBadge, ConfBadge, Drawer, EmptyState, ScorePill } from './ui';

type Sort = 'priority' | 'confidence' | 'closeness';
export type ExplorerFilters = { q: string; buckets: Set<string>; confs: Set<string>; minScore: number; path: 'any' | 'yes' | 'no'; family: SourceKey | 'any'; saved: boolean };
export const defaultFilters = (): ExplorerFilters => ({ q: '', buckets: new Set(['top', 'radar']), confs: new Set(['alta', 'media', 'baja']), minScore: 0, path: 'any', family: 'any', saved: false });

export function CandidateCard({ lead, job, selected, compared, onSelect, onCompare }: { lead: Lead; job: Job; selected: boolean; compared: boolean; onSelect: () => void; onCompare: () => void }) {
  const p = bestPath(lead);
  const saved = lead.feedback?.decision === 'approve';
  const name = lead.person || lead.org;
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  return <li className={`cc ${selected ? 'sel' : ''} b-${lead.bucket}`}>
    <button className="cc-main" onClick={onSelect} aria-pressed={selected} aria-label={`${name}, score ${lead.score}`}>
      <span className="cc-av" aria-hidden="true">{initials}</span>
      <span className="cc-body">
        <strong>{name}{saved && <Star size={12} className="cc-star" aria-label="Saved" />}{readNote(job.id, lead.id) && <span className="cc-note" title="Has a note">nota</span>}</strong>
        <span className="cc-role">{lead.person ? `${lead.role || 'Role not confirmed'} · ${lead.org}` : clip(lead.title, 60)}</span>
        <span className="cc-row"><BucketBadge bucket={lead.bucket} />{p ? <span className="cc-path"><Route size={11} aria-hidden="true" />{p.hopCount} {p.hopCount === 1 ? 'hop' : 'hops'} · {fmtPct(p.strength)}</span> : <span className="cc-path none">{(() => { const w = warmPlanOf(lead); return w ? warmShort(w) : 'No warm path'; })()}</span>}</span>
      </span>
      <span className="cc-score"><b>{lead.score}</b><small>#{lead.rank}</small></span>
    </button>
    <label className="cc-cmp" title="Compare"><input type="checkbox" checked={compared} onChange={onCompare} aria-label={`Compare ${name}`} /></label>
  </li>;
}

export function applyFilters(job: Job, f: ExplorerFilters, sort: Sort) {
  const demo = isDemoJob(job);
  const q = f.q.trim().toLowerCase();
  return job.leads.filter((l) => f.buckets.has(l.bucket) && f.confs.has(l.confidence) && l.score >= f.minScore
    && (f.path === 'any' || (f.path === 'yes') === (l.paths.length > 0))
    && (f.family === 'any' || l.evidence.some((e) => familyOf(e, demo) === f.family))
    && (!f.saved || l.feedback?.decision === 'approve')
    && (!q || `${l.person || ''} ${l.role || ''} ${l.org} ${l.title}`.toLowerCase().includes(q)))
    .sort((a, b) => sort === 'priority' ? (['top', 'radar', 'discarded'].indexOf(a.bucket) - ['top', 'radar', 'discarded'].indexOf(b.bucket)) || b.score - a.score
      : sort === 'confidence' ? (CONF_RANK[b.confidence] - CONF_RANK[a.confidence]) || b.score - a.score
      : ((bestPath(b)?.strength || 0) - (bestPath(a)?.strength || 0)) || b.score - a.score);
}

function exportCsv(job: Job, leads: Lead[]) {
  const esc = (v: unknown) => { const s = String(v ?? ''); return `"${(/^[=+\-@\t\r]/.test(s) ? "'" : '') + s.replaceAll('"', '""')}"`; };
  const cols = ['rank', 'list', 'score', 'confidence', 'person', 'role', 'organization', 'warm_path', 'path_strength', 'path_certainty', 'introducer', 'next_action', 'main_risk', 'evidence', 'verified', 'note', 'demo'];
  const rows = leads.map((l) => { const p = bestPath(l); const a = nextAction(l); return [l.rank, l.bucket, l.score, l.confidence, l.person, l.role, l.org, p ? p.nodes.join(' → ') : '', p ? p.strength : '', p ? STATUS_LABEL[p.status] : '', p?.introducer || '', a.label, l.risks.find((r) => !r.startsWith('DEMO')) || '', l.evidence.length, l.evidence.filter((e) => e.verified).length, readNote(job.id, l.id), l.demo ? 'yes' : 'no']; });
  const blob = new Blob(['﻿' + [cols, ...rows].map((r) => r.map(esc).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `evaluation-${job.id.slice(0, 8)}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function CandidateExplorer({ job, selectedId, onSelect, filters, setFilters }: { job: Job; selectedId: string | null; onSelect: (id: string) => void; filters: ExplorerFilters; setFilters: (f: ExplorerFilters) => void }) {
  const demo = isDemoJob(job);
  const [sort, setSort] = useState<Sort>('priority');
  const [more, setMore] = useState(false);
  const [compare, setCompare] = useState<string[]>([]);
  const [cmpOpen, setCmpOpen] = useState(false);
  const [count, setCount] = useState(20);
  const list = useMemo(() => applyFilters(job, filters, sort), [job, filters, sort]);
  const families = useMemo(() => [...new Set(job.leads.flatMap((l) => l.evidence.map((e) => familyOf(e, demo))))], [job, demo]);
  const set = (patch: Partial<ExplorerFilters>) => setFilters({ ...filters, ...patch });
  const toggle = (key: 'buckets' | 'confs', v: string) => { const s = new Set(filters[key]); if (s.has(v)) s.delete(v); else s.add(v); set({ [key]: s }); };
  const counts = { top: 0, radar: 0, discarded: 0 } as Record<string, number>;
  for (const l of job.leads) counts[l.bucket] = (counts[l.bucket] || 0) + 1;
  const active = (filters.q ? 1 : 0) + (filters.minScore ? 1 : 0) + (filters.path !== 'any' ? 1 : 0) + (filters.family !== 'any' ? 1 : 0) + (filters.saved ? 1 : 0) + (filters.confs.size < 3 ? 1 : 0);
  const cmpLeads = compare.map((id) => job.leads.find((l) => l.id === id)).filter(Boolean) as Lead[];
  return <section className="ce" aria-label="Candidate list">
    <div className="ce-search"><Search size={15} aria-hidden="true" /><input value={filters.q} onChange={(e) => set({ q: e.target.value })} placeholder="Search name, role or org" aria-label="Search candidates" />{filters.q && <button className="x-icon-btn sm" onClick={() => set({ q: '' })} aria-label="Clear"><X size={12} /></button>}</div>
    <div className="ce-buckets" role="group" aria-label="Filter by status">{(['top', 'radar', 'discarded'] as const).map((b) => <button key={b} aria-pressed={filters.buckets.has(b)} className={`b-${b} ${filters.buckets.has(b) ? 'on' : ''}`} onClick={() => toggle('buckets', b)}>{BUCKET_PLURAL[b]} <b>{counts[b] || 0}</b></button>)}</div>
    <div className="ce-bar">
      <label className="ce-sort"><ArrowDownWideNarrow size={14} aria-hidden="true" /><span className="x-sr">Sort by</span><select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort by"><option value="priority">Priority</option><option value="confidence">Confidence</option><option value="closeness">Closeness</option></select></label>
      <button className={`x-btn sm ${more ? 'on' : ''}`} onClick={() => setMore(!more)} aria-expanded={more}><SlidersHorizontal size={14} /> Filters{active ? ` · ${active}` : ''}</button>
      <button className="x-btn sm" onClick={() => exportCsv(job, list)} title="Export this view"><Download size={14} /> CSV</button>
    </div>
    {more && <div className="ce-more">
      <fieldset><legend>Confidence</legend>{['alta', 'media', 'baja'].map((c) => <label key={c}><input type="checkbox" checked={filters.confs.has(c)} onChange={() => toggle('confs', c)} />{c}</label>)}</fieldset>
      <fieldset><legend>Min score · {filters.minScore}</legend><input type="range" min={0} max={100} step={5} value={filters.minScore} onChange={(e) => set({ minScore: Number(e.target.value) })} aria-label="Min score" /></fieldset>
      <fieldset><legend>Warm path</legend><select value={filters.path} onChange={(e) => set({ path: e.target.value as ExplorerFilters['path'] })} aria-label="Warm path"><option value="any">All</option><option value="yes">With warm path</option><option value="no">To build (no network path)</option></select></fieldset>
      <fieldset><legend>Source</legend><select value={filters.family} onChange={(e) => set({ family: e.target.value as SourceKey | 'any' })} aria-label="Source"><option value="any">All</option>{families.map((k) => <option key={k} value={k}>{SOURCE_META[k].label}</option>)}</select></fieldset>
      <fieldset><legend>Saved</legend><label><input type="checkbox" checked={filters.saved} onChange={(e) => set({ saved: e.target.checked })} />Saved only</label></fieldset>
      <button className="x-link-btn" onClick={() => setFilters(defaultFilters())}>Reset</button>
      {!demo && <a className="x-link-btn" href={`${API}/jobs/${job.id}/export.csv`}><FileDown size={13} /> Full CSV</a>}
    </div>}
    <p className="ce-count" aria-live="polite">{list.length} of {job.leads.length} candidates</p>
    {compare.length > 0 && <div className="ce-cmpbar"><span>{compare.length} to compare</span><button className="x-btn sm primary" disabled={compare.length < 2} onClick={() => setCmpOpen(true)}><Columns3 size={14} /> Compare</button><button className="x-link-btn" onClick={() => setCompare([])}>Clear</button></div>}
    {list.length ? <ul className="ce-list">{list.slice(0, count).map((l) => <CandidateCard key={l.id} lead={l} job={job} selected={l.id === selectedId} compared={compare.includes(l.id)} onSelect={() => onSelect(l.id)} onCompare={() => setCompare((c) => (c.includes(l.id) ? c.filter((x) => x !== l.id) : [...c, l.id].slice(-3)))} />)}</ul>
      : <EmptyState title="No candidates match" action={<button className="x-btn sm" onClick={() => setFilters(defaultFilters())}>Reset filters</button>}>{filters.buckets.has('discarded') ? 'Try a lower min score.' : 'Discarded are hidden by default.'}</EmptyState>}
    {list.length > count && <button className="x-btn sm ce-more-btn" onClick={() => setCount((c) => c + 20)}>Show 20 more ({list.length - count} left)</button>}
    <Drawer open={cmpOpen} onClose={() => setCmpOpen(false)} title="Compare candidates" subtitle="Side by side" width={900} tone={demo ? 'demo' : undefined}>
      <div className="cmp" style={{ gridTemplateColumns: `180px repeat(${cmpLeads.length}, minmax(0,1fr))` }}>
        {[['Candidate', (l: Lead) => <b>{l.person || l.org}</b>], ['Role · org', (l: Lead) => `${l.role || '—'} · ${l.org}`], ['List', (l: Lead) => <BucketBadge bucket={l.bucket} />], ['Score', (l: Lead) => <ScorePill score={l.score} />],
          ...['fit', 'type', 'timing', 'path', 'contact'].map((k) => [`· ${k === 'fit' ? 'Fit' : k === 'type' ? 'Type' : k === 'timing' ? 'Timing' : k === 'path' ? 'Relationship' : 'Channel'}`, (l: Lead) => { const f = l.breakdown.find((x) => x.factor === k); return f ? `${f.points} / ${f.max}` : '—'; }] as const),
          ['Confidence', (l: Lead) => <ConfBadge value={l.confidence} />], ['Jev', (l: Lead) => (l.jev ? `${l.jev.action} · ${fmtPct(l.jev.actionConfidence)}` : '—')],
          ['Best path', (l: Lead) => { const p = bestPath(l); const w = warmPlanOf(l); return p ? `${p.nodes.join(' → ')} · ${fmtPct(p.strength)}` : w ? `${w.label}: ${w.steps.map((x) => x.what).join(' → ')}` : 'No warm path'; }], ['Weakest link', (l: Lead) => { const p = bestPath(l); return p ? fmtPct(p.weakest.strength) : '—'; }],
          ['Evidence', (l: Lead) => `${l.evidence.filter((e) => e.verified).length} verified / ${l.evidence.length}`], ['Next action', (l: Lead) => nextAction(l).label]].map(([label, fn]) => <div className="cmp-row" key={label as string} style={{ display: 'contents' }}><span className="cmp-h">{label as string}</span>{cmpLeads.map((l) => <span key={l.id} className="cmp-c">{(fn as (l: Lead) => ReactNode)(l)}</span>)}</div>)}
      </div>
    </Drawer>
  </section>;
}
