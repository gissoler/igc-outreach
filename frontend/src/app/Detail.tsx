import { ArrowLeft, ArrowRight, Bookmark, BookmarkCheck, Check, ChevronRight, Copy, ExternalLink, FileSearch, Globe, Lightbulb, Lock, Mail, MessageSquareText, MoreHorizontal, Plus, RefreshCw, Route, ThumbsDown, TriangleAlert, UserRound, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { BrowseAction, BrowseShot, Evidence, Job, Lead } from '../researchApi';
import { browsePage, closeBrowse, fundingLabels, officialPage, statusLabels } from '../researchApi';
import { SOURCE_META } from '../sources';
import { CopyBtn, reasonFor, shortDraft } from './Contacts';
import { clip, clipWords, cleanText, fmtAge, fmtDate, fmtPct, initials, readableQuote } from './format';
import {
  BUCKET_LABEL, contributions, decisionTrace, familyOf, GKIND_LABEL, introReason, isDemoJob, nextAction, oneLiner, pathsOf,
  RELATION_LABEL, STATUS_HELP, type GEdge, type GNode, type Graph, type NormHop, type NormPath, type TraceNode,
  warmPlanOf,
} from './model';
import { BucketBadge, ConfBadge, Drawer, Info, LinkBadge, Meter, ScorePill } from './ui';
import { ResultTracePanel } from './Audit';

/* ───────── Evidence ───────── */
export function SourceTag({ e, demo }: { e: Evidence; demo: boolean }) {
  const k = familyOf(e, demo); const m = SOURCE_META[k]; const Icon = m.icon;
  return <span className="x-src" style={{ ['--src' as string]: m.color }}><Icon size={12} aria-hidden="true" />{m.label}<em>{clip(e.source, 40)}</em></span>;
}
export function EvidenceItem({ e, demo, usedIn }: { e: Evidence; demo: boolean; usedIn?: string }) {
  const old = Date.now() - Date.parse(e.retrievedAt) > 365 * 86_400_000;
  return <article className="x-ev" id={`ev-${e.id}`}>
    <header><SourceTag e={e} demo={demo} /><span className={`x-verif ${e.verified ? 'yes' : 'no'}`}>{e.verified ? <><Check size={12} /> Verified</> : <><TriangleAlert size={12} /> Unverified</>}</span></header>
    <blockquote>{readableQuote(e.quote)}</blockquote>
    <footer><span>{e.field}</span><span className={old ? 'x-stale' : ''}>{fmtDate(e.retrievedAt)} · {fmtAge(e.retrievedAt)}{old ? ' · old' : ''}</span>{usedIn && <span>Used in: {usedIn}</span>}
      {demo ? <span className="x-muted">Fictional URL</span> : <a href={e.url} target="_blank" rel="noreferrer">Source <ExternalLink size={12} /></a>}</footer>
  </article>;
}
export function EvidenceDrawer({ open, onClose, title, evidence, demo, subtitle }: { open: boolean; onClose: () => void; title: string; evidence: Evidence[]; demo: boolean; subtitle?: string }) {
  const [only, setOnly] = useState<'all' | 'verified' | 'unverified'>('all');
  const list = evidence.filter((e) => only === 'all' || (only === 'verified' ? e.verified : !e.verified));
  return <Drawer open={open} onClose={onClose} title={title} subtitle={subtitle || `${evidence.length} pieces · ${evidence.filter((e) => e.verified).length} verified`} tone={demo ? 'demo' : undefined}>
    <div className="x-seg sm" role="radiogroup" aria-label="Filter evidence">{(['all', 'verified', 'unverified'] as const).map((v) => <button key={v} role="radio" aria-checked={only === v} className={only === v ? 'on' : ''} onClick={() => setOnly(v)}>{v === 'all' ? 'All' : v === 'verified' ? 'Verified' : 'Unverified'}</button>)}</div>
    {list.length ? <div className="x-ev-list">{list.map((e) => <EvidenceItem key={e.id} e={e} demo={demo} />)}</div> : <p className="x-muted">Nothing here.</p>}
  </Drawer>;
}

/* ───────── Decision trace ───────── */
function TraceBranch({ n, depth, open }: { n: TraceNode; depth: number; open: boolean }) {
  const body = <span className="t-row"><i className={`t-dot ${n.tone || 'neutral'}`} aria-hidden="true" /><span className="t-label">{n.label}</span>{n.value && <b className="t-val">{n.value}</b>}{n.note && <small className="t-note">{n.note}</small>}</span>;
  if (!n.children?.length) return <li className={`t-leaf d${depth}`}>{body}</li>;
  return <li className={`t-branch d${depth}`}><details open={open || depth === 0}><summary>{body}</summary><ul>{n.children.map((c) => <TraceBranch key={c.id} n={c} depth={depth + 1} open={open} />)}</ul></details></li>;
}
export function DecisionTrace({ lead, job, expanded = false }: { lead: Lead; job: Job; expanded?: boolean }) {
  const tree = useMemo(() => decisionTrace(lead, job), [lead, job]);
  const [all, setAll] = useState(expanded);
  useEffect(() => setAll(expanded), [expanded]);
  return <div className="t-card">
    <div className="t-head"><span><b>Decision trace</b><small>Evidence → rules → Decision Agent → result.</small></span><button className="x-btn sm" onClick={() => setAll(!all)} aria-pressed={all}>{all ? 'Collapse' : 'Expand all'}</button></div>
    <ul className="t-tree" key={String(all)}><TraceBranch n={tree} depth={0} open={all} /></ul>
  </div>;
}

/* ───────── Why this ranking (three levels) ───────── */
export function ExecutiveExplain({ lead, job, level, onLevel }: { lead: Lead; job: Job; level: 1 | 2 | 3; onLevel: (l: 1 | 2 | 3) => void }) {
  const c = contributions(lead);
  const raw = c.items.reduce((n, f) => n + f.points, 0);
  return <section className="x-explain" aria-label="Why this ranking">
    <div className="x-explain-tabs" role="tablist" aria-label="Level">{([[1, 'Summary'], [2, 'Factors'], [3, 'Full trace']] as const).map(([v, l]) => <button key={v} role="tab" aria-selected={level === v} className={level === v ? 'on' : ''} onClick={() => onLevel(v)}><b>{v}</b>{l}</button>)}</div>
    {level === 1 && <p className="x-oneliner">{oneLiner(lead, job)}</p>}
    {level === 2 && <div className="x-factors">
      <p className="x-formula"><span>Score</span> = Σ (value × weight) × coverage = <b>{raw.toFixed(1)}</b> × <b>{c.penalty}</b> = <b className="x-hl">{lead.score}</b><Info wide label="How to read factors">Each factor is 0–1 times its weight. The sum is halved when there is no verified evidence. It ranks candidates; it is not a probability of investment.</Info></p>
      <ul>{c.items.map((f) => <li key={f.key}><span className="x-f-label">{f.label}</span><span className="x-f-bar" aria-hidden="true"><i style={{ width: `${f.max ? (f.points / 40) * 100 : 0}%` }} /><s style={{ width: `${(f.missed / 40) * 100}%` }} /></span><span className="x-f-num"><b>{f.points}</b> / {f.max}</span></li>)}</ul>
    </div>}
    {level === 3 && <DecisionTrace lead={lead} job={job} expanded />}
  </section>;
}

/* ───────── Warm path, hop by hop (full view) ───────── */
function HopCard({ hop, onEvidence, onOpen, weakest }: { hop: NormHop; onEvidence: () => void; onOpen: () => void; weakest: boolean }) {
  return <li className={`wp-hop ${hop.status} ${weakest ? 'weakest' : ''}`}>
    <div className="wp-hop-rail" aria-hidden="true"><i /></div>
    <div className="wp-hop-body">
      <div className="wp-hop-top"><span className="wp-step">Hop {hop.index + 1}</span><b>{hop.from} <ArrowRight size={13} aria-label="to" /> {hop.to}</b>{weakest && <span className="wp-weak">Weakest link</span>}</div>
      <div className="wp-hop-meta"><LinkBadge status={hop.status} compact /><span className="wp-kind">{RELATION_LABEL[hop.kind]}</span><span className="wp-str">{fmtPct(hop.strength)}<Meter value={hop.strength} tone={hop.status === 'verified' ? 'green' : hop.status === 'documented' ? 'amber' : 'ink'} /></span></div>
      <p className="wp-rel">{hop.relation}</p>
      <p className="wp-why"><Lightbulb size={13} aria-hidden="true" /> {introReason(hop.kind)}</p>
      <div className="wp-hop-foot"><span>{hop.evidence.length ? `${hop.evidence.length} evidence · ${hop.verifiedCount} verified · ${fmtAge(hop.latest)}` : 'No linked evidence'}</span><button className="x-link-btn" onClick={onEvidence} disabled={!hop.evidence.length}><FileSearch size={13} /> Evidence</button><button className="x-link-btn" onClick={onOpen}>Link detail <ChevronRight size={13} /></button></div>
    </div>
  </li>;
}
export function WarmPathPanel({ lead, job, onEvidence, onHop }: { lead: Lead; job: Job; onEvidence: (title: string, ev: Evidence[]) => void; onHop: (hop: NormHop, path: NormPath) => void }) {
  const paths = pathsOf(lead);
  const [idx, setIdx] = useState(0);
  useEffect(() => setIdx(0), [lead.id]);
  const p = paths[idx];
  const target = lead.person || lead.org;
  if (!p) return <section className="wp-panel none" aria-label="Warm path">
    <header><h3><Route size={16} /> Warm path to {target}</h3><LinkBadge status="hypothesis" compact /></header>
    <p><b>No one in your network connects yet, so the warm path is built.</b> {warmPlanOf(lead)?.why}</p>
    <PlanSteps lead={lead} />
  </section>;
  return <section className="wp-panel" aria-label="Warm path">
    <header><h3><Route size={16} /> Warm path to {target}</h3>{paths.length > 1 && <div className="x-seg sm" role="tablist" aria-label="Paths">{paths.map((q, i) => <button key={q.id} role="tab" aria-selected={i === idx} className={i === idx ? 'on' : ''} onClick={() => setIdx(i)}>{i === 0 ? 'Best' : `Alt ${i}`} · {Math.round(q.strength * 100)}%</button>)}</div>}</header>
    <div className="wp-metrics">
      <span><small>Hops</small><b>{p.hopCount}</b></span>
      <span><small>Strength<Info label="How strength is computed">Product of each hop: {p.hops.map((h) => h.strength.toFixed(2)).join(' × ')} = {p.product.toFixed(3)}.</Info></small><b>{fmtPct(p.strength)}</b></span>
      <span><small>Certainty<Info label="Path certainty">A path is as certain as its least certain hop. {STATUS_HELP[p.status]}</Info></small><LinkBadge status={p.status} compact /></span>
      <span><small>Weakest link</small><b>{fmtPct(p.weakest.strength)}</b><em>{clip(`${p.weakest.from} → ${p.weakest.to}`, 40)}</em></span>
    </div>
    <div className="wp-ask"><UserRound size={16} aria-hidden="true" /><div><small>Ask for the intro</small><b>{p.introducer ? p.introducer : 'Nobody: it is direct'}</b></div></div>
    <ol className="wp-hops">{p.hops.map((h) => <HopCard key={h.index} hop={h} weakest={p.hopCount > 1 && h === p.weakest} onEvidence={() => onEvidence(`Hop ${h.index + 1}: ${h.from} → ${h.to}`, h.evidence)} onOpen={() => onHop(h, p)} />)}</ol>
    {isDemoJob(job) && <p className="x-demo-note">Fictional demo path.</p>}
  </section>;
}
function CopyButton({ text, label = 'Copy message', className = 'x-btn sm' }: { text: string; label?: string; className?: string }) {
  const [ok, setOk] = useState<'idle' | 'ok' | 'err'>('idle');
  return <button className={className} onClick={() => { void navigator.clipboard.writeText(text).then(() => setOk('ok'), () => setOk('err')); }}><Copy size={13} /> {ok === 'ok' ? 'Copied' : ok === 'err' ? "Couldn't copy" : label}</button>;
}

/* ───────── Candidate panel (Plan "Lead Detail") ───────── */
const noteKey = (job: string, lead: string) => `igc-note:${job}:${lead}`;
export const readNote = (job: string, lead: string) => { try { return localStorage.getItem(noteKey(job, lead)) || ''; } catch { return ''; } };
const writeNote = (job: string, lead: string, v: string) => { try { if (v) localStorage.setItem(noteKey(job, lead), v); else localStorage.removeItem(noteKey(job, lead)); } catch { /* no storage */ } };

/* ───────── Contact: who to write to, shown on the card ───────── */
function contactOf(lead: Lead, demo: boolean) {
  const c = lead.contact;
  const channel = !c ? null : c.type === 'email' ? 'Email' : c.type === 'linkedin' ? 'LinkedIn' : 'Website';
  // Nunca mailto: un clic no debe abrir la app de correo. El correo se muestra y se copia.
  const href = c && !demo && c.type !== 'email' ? c.value : null;
  const value = c ? (demo ? `${channel} (fictional)` : c.type === 'email' ? c.value : channel!) : null;
  return { name: lead.person, role: lead.role, channel, href, value, type: c?.type || null };
}
const HELPDESK = /grantsgovsupport|support@|helpdesk|help@|webmaster|noreply|no-reply/i;
/** Convocatoria sin contacto de programa publicado: se aplica en el portal, sin correo. */
function ApplyCard({ lead, demo }: { lead: Lead; demo: boolean }) {
  const a = lead.grantPlan?.apply;
  const href = demo ? null : a?.officialUrl || a?.portal?.url || officialUrlOfLead(lead);
  return <div className="ld-contact">
    <span className="ld-contact-av empty" aria-hidden="true"><FileSearch size={16} /></span>
    <div className="ld-contact-who"><small>How to apply</small><b>{a?.portal?.name || 'Official program page'}</b><span>{a?.contactAdvice || 'Apply through the official portal.'}</span></div>
    <div className="ld-contact-a">{href ? <a className="x-btn sm" href={href} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Open call</a> : <span className="pl-chip gray">No link</span>}</div>
  </div>;
}
function ContactCard({ lead, demo, isGrant }: { lead: Lead; demo: boolean; isGrant: boolean }) {
  if (isGrant && lead.kind === 'opportunity' && (!lead.contact || lead.contact.type !== 'email' || (!lead.person && HELPDESK.test(lead.contact.value)) || !lead.grantPlan?.contactQuestion)) return <ApplyCard lead={lead} demo={demo} />;
  const k = contactOf(lead, demo);
  const Icon = k.type === 'email' ? Mail : k.type === 'linkedin' ? ExternalLink : Globe;
  const who = k.name || (isGrant ? 'Program officer' : lead.org);
  const sub = k.name ? [k.role, lead.org].filter(Boolean).join(' · ') : isGrant ? (k.value ? `Published contact · ${lead.org}` : 'Name not published in the notice') : 'No named person yet';
  return <div className="ld-contact">
    <span className={`ld-contact-av ${k.name ? '' : 'empty'}`} aria-hidden="true">{k.name ? initials(k.name) : <UserRound size={16} />}</span>
    <div className="ld-contact-who"><small>Contact</small><b>{who}</b><span>{sub}</span></div>
    <div className="ld-contact-a">
      {k.href ? <a className="x-btn sm" href={k.href} target="_blank" rel="noreferrer"><Icon size={13} /> {k.type === 'email' ? clip(k.value || '', 28) : k.channel}</a>
        : <span className="pl-chip gray" title={k.type === 'email' ? k.value || '' : undefined}>{k.type === 'email' && k.value ? clip(k.value, 30) : k.value || 'No public channel'}</span>}
      {k.type === 'email' && k.value && !demo && <CopyButton text={k.value} label="" className="ld-ic" />}
    </div>
  </div>;
}

/* ───────── Official page inside the app ─────────
   Two ways to browse without leaving the app:
   · Live: the site allows framing, so it is embedded directly.
   · Browser: the site forbids framing (most .gov and foundations). The page runs in a
     headless browser on the server; clicks, scroll and typing here are sent to it.
   The URL is always the one the pipeline stored for this item. */
const NAV_KEYS = new Set(['Enter', 'Backspace', 'Delete', 'Tab', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End']);

function RemoteBrowser({ lead, job, onShot }: { lead: Lead; job: Job; onShot: (s: BrowseShot) => void }) {
  const [shot, setShot] = useState<BrowseShot | null>(null);
  const [err, setErr] = useState('');
  const [pending, setPending] = useState(0);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const typed = useRef(''); const typeTimer = useRef<number | undefined>(undefined);
  const scrolled = useRef(0); const scrollTimer = useRef<number | undefined>(undefined);
  const boxRef = useRef<HTMLDivElement>(null);
  const send = (body: BrowseAction) => {
    setPending((n) => n + 1);
    const run = chain.current.then(() => browsePage(job.id, lead.id, body)).then((r) => { setShot(r); onShot(r); setErr(''); }, (e) => setErr(e instanceof Error ? e.message : "Couldn't reach the browser."));
    chain.current = run.finally(() => setPending((n) => n - 1));
  };
  useEffect(() => {
    setShot(null); setErr(''); chain.current = Promise.resolve();
    send({ action: 'open' });
    return () => { window.clearTimeout(typeTimer.current); window.clearTimeout(scrollTimer.current); closeBrowse(job.id, lead.id); };
  }, [lead.id, job.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { // wheel must be non-passive to keep the side panel from scrolling underneath
    const el = boxRef.current; if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault(); scrolled.current += e.deltaY;
      window.clearTimeout(scrollTimer.current);
      scrollTimer.current = window.setTimeout(() => { const dy = scrolled.current; scrolled.current = 0; if (dy) send({ action: 'scroll', dy }); }, 80);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }); // eslint-disable-line react-hooks/exhaustive-deps
  const flushTyped = () => { window.clearTimeout(typeTimer.current); const text = typed.current; typed.current = ''; if (text) send({ action: 'type', text }); };
  const onClick = (e: React.MouseEvent<HTMLImageElement>) => {
    if (!shot) return;
    const r = e.currentTarget.getBoundingClientRect();
    flushTyped();
    send({ action: 'click', x: Math.round((e.clientX - r.left) * (shot.width / r.width)), y: Math.round((e.clientY - r.top) * (shot.height / r.height)) });
    boxRef.current?.focus();
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key.length === 1) { e.preventDefault(); e.stopPropagation(); typed.current += e.key; window.clearTimeout(typeTimer.current); typeTimer.current = window.setTimeout(flushTyped, 140); return; }
    if (NAV_KEYS.has(e.key)) { e.preventDefault(); e.stopPropagation(); flushTyped(); send({ action: 'key', key: e.key }); }
  };
  const busy = pending > 0;
  return <div className="ld-rb">
    <div className="ld-page-bar">
      <button className="ld-ic" aria-label="Back" title="Back" onClick={() => send({ action: 'back' })} disabled={!shot}><ArrowLeft size={14} /></button>
      <button className="ld-ic" aria-label="Reload" title="Reload" onClick={() => send({ action: 'reload' })} disabled={!shot}><RefreshCw size={14} className={busy ? 'ld-spin' : ''} /></button>
      <span className="ld-page-url"><Lock size={11} /> {shot ? clip(shot.url.replace(/^https?:\/\//, ''), 80) : 'Opening the official page…'}</span>
      {shot?.url && <a className="x-btn sm" href={shot.url} target="_blank" rel="noreferrer">New tab <ExternalLink size={12} /></a>}
    </div>
    {err && <p className="x-note" role="alert">{err}</p>}
    <div className="ld-rb-box" ref={boxRef} tabIndex={0} onKeyDown={onKeyDown} aria-label="Remote browser: click the page, then scroll or type">
      {shot ? <img src={`data:image/jpeg;base64,${shot.image}`} width={shot.width} height={shot.height} alt={shot.title || 'Official page'} draggable={false} onClick={onClick} />
        : !err && <div className="ld-page-frame loading"><span>Opening the official page…</span></div>}
      {busy && shot && <span className="ld-rb-busy" role="status">Loading…</span>}
    </div>
    <p className="ld-hint">This is the real page. Click links and fields, scroll with the wheel, and type after clicking a field.</p>
  </div>;
}

const httpUrl = (u?: string | null) => { try { const x = new URL(String(u)); return x.protocol === 'http:' || x.protocol === 'https:' ? x.href : null; } catch { return null; } };
/** Misma regla que el servidor: la evidencia verificada primero, luego cualquier evidencia, luego el contacto web. */
const officialUrlOfLead = (lead: Lead) => {
  const ev = lead.evidence || [];
  const pick = ev.find((e) => e.verified && httpUrl(e.url)) || ev.find((e) => httpUrl(e.url));
  return httpUrl(pick?.url) || (lead.contact && lead.contact.type !== 'email' ? httpUrl(lead.contact.value) : null);
};

function OfficialPageView({ lead, job, demo }: { lead: Lead; job: Job; demo: boolean }) {
  const url = demo ? null : officialUrlOfLead(lead);
  // The server says whether the site can be framed and whether its Chromium is running; the view picks the mode by itself.
  const [mode, setMode] = useState<'checking' | 'embed' | 'browser' | 'blocked'>('checking');
  const [why, setWhy] = useState('');
  const [seen, setSeen] = useState<string | null>(null);
  useEffect(() => {
    setSeen(null); setWhy('');
    if (!url) return;
    let alive = true;
    setMode('checking');
    officialPage(job.id, lead.id).then((info) => {
      if (!alive) return;
      if (info.embeddable) { setMode('embed'); return; }
      setWhy(info.reason || '');
      setMode(info.browser?.available === false ? 'blocked' : 'browser');
      if (info.browser?.available === false) setWhy(`${info.reason || 'This site does not allow being shown inside other apps.'} The in-app browser is off on this server (${info.browser.reason || 'browser not installed'}).`);
    }).catch(() => { if (alive) setMode('embed'); });
    return () => { alive = false; };
  }, [lead.id, job.id, url]);
  const host = url ? safeHost(seen || url) : '';
  const onPage = lead.evidence.filter((e) => host && e.url && safeHost(e.url) === host).slice(0, 4);
  if (demo) return <section className="ld-sec"><p className="ld-empty">Demo data uses fictional URLs, so there is no page to show.</p></section>;
  if (!url) return <section className="ld-sec"><p className="ld-empty">No official page was found for this item.</p></section>;
  return <section className="ld-sec ld-page">
    {mode === 'checking' && <div className="ld-page-frame loading"><span>Checking how this site can be shown…</span></div>}
    {mode === 'embed' && <>
      <div className="ld-page-bar"><span className="ld-page-url"><Lock size={11} /> {clip(url.replace(/^https?:\/\//, ''), 80)}</span>
        <button className="x-btn sm" onClick={() => setMode('browser')} title="Some sites refuse to be shown inside other pages">Blank? Use remote browser</button>
        <a className="x-btn sm" href={url} target="_blank" rel="noreferrer">New tab <ExternalLink size={12} /></a></div>
      <iframe className="ld-page-frame" src={url} title={`Official page: ${lead.title}`} sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer" />
    </>}
    {mode === 'browser' && <>
      {why && <p className="ld-hint">{why} Showing it through the in-app browser instead.</p>}
      <RemoteBrowser key={lead.id} lead={lead} job={job} onShot={(s) => setSeen(s.url)} />
    </>}
    {mode === 'blocked' && <div className="ld-page-blocked">
      <p>{why}</p>
      <a className="x-btn primary sm" href={url} target="_blank" rel="noreferrer">Open {clip(safeHost(url), 40)} <ExternalLink size={12} /></a>
    </div>}
    {onPage.length > 0 && <div className="ld-page-ev">
      <header className="ld-h"><h3>What we read on this site</h3><span className="pl-badge sun">{onPage.length}</span></header>
      <ul className="ld-ev">{onPage.map((e) => <li key={e.id}><div><span className={`pl-chip ${e.verified ? 'mint' : 'lav'}`}>{e.verified ? 'Found' : 'Our read'}</span><small>{e.field}</small></div><q>{clipWords(readableQuote(e.quote), 200)}</q></li>)}</ul>
    </div>}
  </section>;
}
const safeHost = (u: string) => { try { return new URL(u).host.replace(/^www\./, ''); } catch { return ''; } };

/* ───────── Lo esencial del candidato (14-10): por qué se eligió, qué hacer, a quién escribir ───────── */
const DAY = 86_400_000;
const longDay = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
type PlanStep = { label: string; days?: number; skip?: boolean };
/** Pasos con fecha límite sugerida, hacia atrás desde el cierre (dos días de margen al final). */
export function datedSteps(steps: PlanStep[], deadline: string | null): { label: string; by: string | null; days: number | null }[] {
  const list = steps.filter((x) => !x.skip);
  if (!deadline) return list.map((x) => ({ label: x.label, by: null, days: x.days ?? null }));
  let end = Date.parse(`${deadline}T12:00:00Z`) - 2 * DAY;
  const out = [...list].reverse().map((x) => { const by = new Date(end).toISOString().slice(0, 10); end -= (x.days || 0) * DAY; return { label: x.label, by, days: x.days ?? null }; });
  return out.reverse();
}
export function Essentials({ lead, demo, isGrant, mailText }: { lead: Lead; demo: boolean; isGrant: boolean; mailText: string }) {
  const v = lead.verification;
  const q = (field: string) => lead.evidence.find((e) => e.field === field && e.verified)?.quote || '';
  const deadlineQ = v?.deadlineQuote || q('deadline');
  const eligQ = v?.eligibility?.quote || q('eligibility');
  const identityQ = q('opportunity') || q('profile') || lead.evidence.find((e) => e.verified)?.quote || '';
  const verified = v?.tier === 'main';
  const firstBlocker = (v?.blockers || [])[0];
  const steps = datedSteps((lead.grantPlan?.apply?.steps || []) as PlanStep[], lead.deadline);
  const portal = lead.grantPlan?.apply?.portal?.name;
  const contacts = lead.contacts || [];
  const source = demo ? null : officialUrlOfLead(lead);
  return <>
    <section className="ld-sec ld-ess">
      <header className="ld-h"><h3>Why it was picked</h3>{verified ? <span className="pl-chip mint">Verified on the page</span> : <span className="pl-chip sun" title={firstBlocker || ''}>To verify</span>}</header>
      <ul className="ld-why">
        {isGrant && lead.deadline && <li><b>Deadline {longDay(lead.deadline)}</b>{lead.daysToDeadline != null ? ` · ${lead.daysToDeadline} days left` : ''}{deadlineQ && <q>{clipWords(readableQuote(deadlineQ), 160)}</q>}</li>}
        {isGrant && !lead.deadline && <li><b>No deadline confirmed on the page.</b>{lead.status === 'forecasted' ? ' It is a forecast: applications are not open yet.' : ''}</li>}
        {eligQ ? <li><b>Who can apply</b><q>{clipWords(readableQuote(eligQ), 180)}</q></li> : isGrant ? <li><b>Eligibility not stated on the page</b> — check it before you start.</li> : null}
        {!isGrant && identityQ && <li><b>What they do</b><q>{clipWords(readableQuote(identityQ), 180)}</q></li>}
        {!verified && firstBlocker && <li className="miss">Still open: {cleanText(firstBlocker)}</li>}
      </ul>
    </section>
    <section className="ld-sec ld-ess">
      <header className="ld-h"><h3>What to do</h3>{source && <a className="ld-link" href={source} target="_blank" rel="noreferrer">{isGrant ? 'Official call' : 'Source'} <ExternalLink size={12} /></a>}</header>
      {isGrant ? <>
        {lead.grantPlan?.nextAction && <p className="ld-next">{cleanText(lead.grantPlan.nextAction)}</p>}
        {steps.length > 0 && <ol className="ld-steps">{steps.map((st, i) => <li key={i}><span>{cleanText(st.label)}</span>{st.by ? <small>by {longDay(st.by)}{st.days ? ` · ~${st.days} days` : ''}</small> : st.days ? <small>~{st.days} days</small> : null}</li>)}</ol>}
        {lead.deadline && <p className="ld-sub">Submit {portal ? `on ${portal} ` : ''}before {longDay(lead.deadline)}.</p>}
      </> : <>
        <pre className="ld-msg">{mailText}</pre>
        <div className="ld-mail-a"><CopyBtn text={mailText} label="Copy message" /><span className="ld-hint">Nothing is sent from the app.</span></div>
      </>}
    </section>
    <section className="ld-sec ld-ess">
      <header className="ld-h"><h3>Contacts {contacts.length > 0 && <span className="pl-badge dark">{contacts.length}</span>}</h3></header>
      {contacts.length ? <ul className="ld-people">{contacts.map((c, i) => <li key={`${c.name}-${i}`}>
        <span className="ld-contact-av" aria-hidden="true">{initials(c.name || '?')}</span>
        <div><b>{c.name}</b><small>{[c.role, c.organization].filter(Boolean).join(' · ') || 'Role not listed'}</small><small className="ld-prov">{c.provenance || c.source || ''}</small></div>
        <div className="ld-people-a">
          {c.linkedin && !demo && <a className="x-btn sm" href={c.linkedin} target="_blank" rel="noreferrer">LinkedIn <ExternalLink size={11} /></a>}
          {c.email && <><a className="x-btn sm" href={`mailto:${c.email}`}>{clip(c.email, 26)}</a><CopyButton text={c.email} label="" className="ld-ic" /></>}
        </div>
      </li>)}</ul> : <ContactCard lead={lead} demo={demo} isGrant={isGrant} />}
    </section>
  </>;
}

export function CandidatePanel({ lead, job, onFeedback, onEvidence, onHop, onClose }: {
  lead: Lead; job: Job; onFeedback: ((id: string, d: 'approve' | 'reject', reason: string, note: string) => Promise<unknown>) | null;
  onEvidence: (title: string, ev: Evidence[]) => void; onHop: (hop: NormHop, path: NormPath) => void; onClose?: () => void;
}) {
  const demo = isDemoJob(job);
  const isGrant = lead.fundingType === 'grant' || lead.kind === 'opportunity';
  const [note, setNote] = useState(() => readNote(job.id, lead.id));
  const [noteOpen, setNoteOpen] = useState(false);
  const [reason, setReason] = useState('not_relevant');
  const [discarding, setDiscarding] = useState(false);
  const [more, setMore] = useState(false);
  const [why, setWhy] = useState(false);
  const [level, setLevel] = useState<1 | 2 | 3>(1);
  const [tab, setTab] = useState<'overview' | 'page' | 'path' | 'evidence' | 'trace'>('overview');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  useEffect(() => { setNote(readNote(job.id, lead.id)); setDiscarding(false); setMsg(''); setNoteOpen(false); setMore(false); setTab('overview'); }, [lead.id, job.id]);
  useEffect(() => { if (!more) return; const f = (e: MouseEvent) => { if (!moreRef.current?.contains(e.target as Node)) setMore(false); }; document.addEventListener('mousedown', f); return () => document.removeEventListener('mousedown', f); }, [more]);
  const action = nextAction(lead);
  const paths = pathsOf(lead);
  const p = paths[0] || null;
  const verified = lead.evidence.filter((e) => e.verified);
    const saved = lead.feedback?.decision === 'approve';
  const mail = useMemo(() => shortDraft(lead, job), [lead, job]);
  const emailText = `Subject: ${mail.subject}\n\n${mail.text}`;
  const unverified = lead.evidence.filter((e) => !e.verified);
  const gapLabels: Record<string, string> = { funds_space: 'funding thesis', active: 'recent activity', stage_fit: 'stage fit', geo_fit: 'geography fit', ticket_fit: 'ticket size', decider: 'named decision-maker', contact: 'public contact', warm_path: 'verified warm path' };
  const researchGaps = (lead.sufficiency?.gaps || []).slice(0, 4).map((gap) => `Missing: ${gapLabels[gap] || gap}`);
  const readItems = [...lead.why.slice(0, 3), ...researchGaps, ...lead.missing.slice(0, researchGaps.length ? 0 : 1).map((m) => `To confirm: ${m.charAt(0).toLowerCase()}${m.slice(1)}`)];
  const name = isGrant ? lead.title : (lead.person || lead.org);
  const save = async (d: 'approve' | 'reject') => {
    if (!onFeedback) { setMsg(demo ? "The demo doesn't save feedback." : 'No active evaluation.'); return; }
    setBusy(true); setMsg('');
    try { await onFeedback(lead.id, d, reason, note); setMsg(d === 'approve' ? 'Saved. Future evaluations will remember it.' : 'Discarded. Future evaluations will skip it.'); setDiscarding(false); }
    catch (e) { setMsg(e instanceof Error ? e.message : "Couldn't save."); } finally { setBusy(false); }
  };
  const risks = lead.risks.filter((r) => !r.startsWith('DEMO')).map((r) => (r === 'competitor_conflict' ? 'Possible competitor' : r));
  // El botón de abrir lleva SIEMPRE a la fuente (la página oficial o la evidencia verificada), nunca al correo.
  const sourceHref = demo ? null : officialUrlOfLead(lead);
  return <article className={`ld${tab === 'page' ? ' page-mode' : ''}`} aria-label={`${name} detail`}>
    <header className="ld-top">
      {onClose && <button className="ld-x" onClick={onClose} aria-label="Close"><X size={18} /></button>}
      <h2>{isGrant ? 'Grant opportunity' : 'Candidate'}</h2>
      <button className="x-btn primary sm" disabled={busy} onClick={() => void save('approve')}>{saved ? <BookmarkCheck size={14} /> : <Bookmark size={14} />}{saved ? 'Saved' : 'Save'}</button>
    </header>
    <section className="ld-sec">
      <div className="ld-who">
        <span className="ld-av" aria-hidden="true">{initials(name)}</span>
        <div className="ld-name"><b>{name}</b><small>{isGrant ? `${lead.org}${lead.grantPlan?.programNumber ? ` · ${lead.grantPlan.programNumber}` : lead.opportunityType ? ` · ${lead.opportunityType.replace('_', ' ')}` : ''}` : lead.person ? `${lead.role || 'Role not confirmed'} · ${lead.org}` : clip(lead.title, 70)}</small></div>
        <div className="ld-icons">
          <CopyButton text={emailText} label="" className="ld-ic" />
          {sourceHref ? <a className="ld-ic" href={sourceHref} target="_blank" rel="noreferrer" aria-label="Open source" title="Open source"><ExternalLink size={15} /></a> : <span className="ld-ic off" title="No source link"><ExternalLink size={15} /></span>}
          <div className="ld-more" ref={moreRef}><button className="ld-ic" aria-label="More" aria-expanded={more} onClick={() => setMore(!more)}><MoreHorizontal size={16} /></button>
            {more && <div className="ld-menu" role="menu"><button role="menuitem" onClick={() => { setMore(false); setWhy(true); }}><Lightbulb size={14} /> Why this ranking</button><button role="menuitem" onClick={() => { setMore(false); onEvidence(`Evidence · ${name}`, lead.evidence); }}><FileSearch size={14} /> All evidence</button><button role="menuitem" className="danger" onClick={() => { setMore(false); setDiscarding(true); }}><ThumbsDown size={14} /> Not a fit…</button></div>}
          </div>
        </div>
      </div>
      <dl className="ld-grid c3">
        <div><dt>Status</dt><dd>{BUCKET_LABEL[lead.bucket]} · #{lead.rank}</dd></div>
        <div><dt>{isGrant ? 'Application state' : 'Warm path'}</dt><dd>{isGrant ? (lead.grantPlan?.label || 'Review eligibility') : p ? `${fmtPct(p.strength)} · ${p.hopCount} hop${p.hopCount === 1 ? '' : 's'}` : 'None'}</dd></div>
        <div><dt>Contact</dt><dd title={contactOf(lead, demo).value || ''}>{contactOf(lead, demo).name ? `${contactOf(lead, demo).name}${contactOf(lead, demo).channel ? ` · ${contactOf(lead, demo).channel}` : ''}` : contactOf(lead, demo).channel || 'Not published'}</dd></div>
      </dl>
      {discarding && <div className="ld-discard"><label className="x-field"><span>Why isn't it a fit?</span><select value={reason} onChange={(e) => setReason(e.target.value)}><option value="not_relevant">Not relevant</option><option value="wrong_person">Wrong person</option><option value="not_now">Bad timing</option><option value="competitor_conflict">Competitor</option><option value="ineligible">Not eligible</option><option value="bad_contact">Wrong channel</option><option value="other">Other</option></select></label><div className="x-row"><button className="x-btn danger sm" disabled={busy} onClick={() => void save('reject')}>Discard</button><button className="x-btn sm" onClick={() => setDiscarding(false)}>Cancel</button></div></div>}
      {msg && <p className="x-note" role="status">{msg}</p>}
    </section>

    <nav className="ld-tabs" role="tablist" aria-label="Candidate sections">
      {([['overview', 'Overview'], ['page', 'Official page'], ['path', isGrant ? 'Application plan' : 'Warm path'], ['evidence', 'Evidence'], ['trace', 'How we got it']] as const).map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}{k === 'path' && p && !isGrant ? <span className="pl-badge sun">{p.hopCount}</span> : null}{k === 'evidence' && lead.evidence.length ? <span className="pl-badge sun">{lead.evidence.length}</span> : null}</button>)}
    </nav>

    {tab === 'overview' && <>
      <Essentials lead={lead} demo={demo} isGrant={isGrant} mailText={emailText} />

      {risks.length > 0 && <section className="ld-sec">
        <header className="ld-h"><h3>Risks <span className="pl-badge rose">{risks.length}</span></h3></header>
        <ul className="ld-risks">{risks.slice(0, 3).map((r) => <li key={r}><TriangleAlert size={13} /> {clip(r, 90)}</li>)}</ul>
      </section>}

      <section className="ld-sec">
        <header className="ld-h"><h3>Notes {note && <span className="pl-badge sun">1</span>}</h3><button className="ld-link" onClick={() => setNoteOpen(!noteOpen)}><Plus size={14} /> {note ? 'Edit note' : 'Add note'}</button></header>
        {noteOpen ? <textarea className="ld-note-in" rows={3} maxLength={1000} value={note} autoFocus onChange={(e) => { setNote(e.target.value); writeNote(job.id, lead.id, e.target.value); }} placeholder="e.g. Diego confirmed he knows her." />
          : note ? <div className="ld-note"><MessageSquareText size={14} /><p>{note}</p></div> : <p className="ld-empty">No notes yet.</p>}
      </section>
    </>}

    {tab === 'page' && <OfficialPageView lead={lead} job={job} demo={demo} />}

    {tab === 'trace' && <ResultTracePanel lead={lead} job={job} />}

    {tab === 'path' && <section className="ld-sec">
      <header className="ld-h"><h3>{isGrant ? 'Application plan' : 'Warm path'}</h3>{p && !isGrant && <button className="ld-link" onClick={() => setWhy(true)}><Route size={14} /> Full path</button>}</header>
      {isGrant && lead.grantPlan ? <><p className="ld-next"><b>{lead.grantPlan.label}</b></p><p className="ld-sub">{lead.grantPlan.nextAction}</p><PlanSteps lead={lead} /></> : p ? <ol className="ld-tl">
        <li><i className="ld-tl-ico ink">You</i><div><p><b>You</b></p><small>Starting point</small></div></li>
        {p.hops.map((h) => <li key={h.index}><i className="ld-tl-ico">{initials(h.to)}</i><div><p><button onClick={() => onHop(h, p)}><b>{h.to}</b></button></p><small>{RELATION_LABEL[h.kind]} · {fmtPct(h.strength)}</small><div className="ld-chips"><span className={`pl-chip ${h.status === 'verified' ? 'mint' : h.status === 'documented' ? 'sun' : 'lav'}`}>{h.status === 'verified' ? 'Verified' : h.status === 'documented' ? 'Documented' : 'Hypothesis'}</span>{p.hopCount > 1 && h === p.weakest && <span className="pl-chip gray">Weakest link</span>}</div></div></li>)}
      </ol> : <PlanSteps lead={lead} />}
      {p && warmPlanOf(lead)?.cadenceDays ? <p className="ld-keep">Then keep it warm: an update every {warmPlanOf(lead)!.cadenceDays} days until the round.</p> : null}
    </section>}

    {tab === 'evidence' && <>
      <section className="ld-sec">
        <header className="ld-h"><h3><span className="pl-chip mint">Found</span> <span className="ld-count">{verified.length}</span></h3>{lead.evidence.length > 0 && <button className="ld-link" onClick={() => onEvidence(`Evidence · ${name}`, lead.evidence)}>Open all</button>}</header>
        {verified.length ? <ul className="ld-ev">{verified.slice(0, 4).map((e) => <li key={e.id}><div><SourceTag e={e} demo={demo} />{e.url && !demo && <a className="ld-ext" href={e.url} target="_blank" rel="noreferrer" aria-label="Open source"><ExternalLink size={13} /></a>}</div><q>{clipWords(readableQuote(e.quote), 200)}</q></li>)}</ul> : <p className="ld-empty">No verified source yet.</p>}
      </section>
      {unverified.length > 0 && <section className="ld-sec">
        <header className="ld-h"><h3><span className="pl-chip sun">Unverified</span> <span className="ld-count">{unverified.length}</span></h3></header>
        <ul className="ld-ev">{unverified.slice(0, 2).map((e) => <li key={e.id}><div><SourceTag e={e} demo={demo} /></div><q>{clipWords(readableQuote(e.quote), 160)}</q></li>)}</ul>
      </section>}
    </>}

    {why && <Drawer open onClose={() => setWhy(false)} title="Why this ranking" subtitle={name} width={640} tone={demo ? 'demo' : undefined}>
      <div className="ld-why">
        <div className="ld-why-row"><ScorePill score={lead.score} big /><ConfBadge value={lead.confidence} /><BucketBadge bucket={lead.bucket} /></div>
        <p className="x-muted">{action.detail}</p>
        <ExecutiveExplain lead={lead} job={job} level={level} onLevel={setLevel} />
        <WarmPathPanel lead={lead} job={job} onEvidence={onEvidence} onHop={onHop} />
        <h3 className="x-h3">Opportunity</h3>
        <dl className="x-dl"><dt>Type</dt><dd>{fundingLabels[lead.fundingType] || lead.fundingType}</dd><dt>Status</dt><dd>{statusLabels[lead.status] || lead.status}</dd><dt>Deadline</dt><dd>{lead.deadline ? `${fmtDate(lead.deadline)}${lead.daysToDeadline != null ? ` · ${lead.daysToDeadline} days` : ''}` : 'Not published'}</dd><dt>Channel</dt><dd>{lead.contact ? (demo ? `${lead.contact.type} (fictional)` : clip(lead.contact.value, 42)) : 'Not published'}</dd></dl>
        {lead.missing.length > 0 && <><h3 className="x-h3">Missing data</h3><ul className="x-bullets">{lead.missing.map((m) => <li key={m}>{m}</li>)}</ul></>}
        {risks.length > 3 && <><h3 className="x-h3">All risks</h3><ul className="x-bullets neg">{risks.map((r) => <li key={r}>{r}</li>)}</ul></>}

      </div>
    </Drawer>}
  </article>;
}

/* ───────── Relationship / node drawer ───────── */
export function RelationshipDrawer({ edge, node, graph, job, onClose, onEvidence, onSelectLead }: { edge: GEdge | null; node: GNode | null; graph: Graph | null; job: Job; onClose: () => void; onEvidence: (t: string, ev: Evidence[]) => void; onSelectLead: (id: string) => void }) {
  const demo = isDemoJob(job);
  const nodeOf = (id: string) => graph?.nodes.find((n) => n.id === id) || null;
  if (edge) {
    const a = nodeOf(edge.from), b = nodeOf(edge.to);
    const age = edge.date ? Date.now() - Date.parse(edge.date) : null;
    const risks: string[] = [];
    if (edge.type === 'hypothesis') risks.push("Unverified: don't present it as an existing relationship.");
    if (edge.type === 'documented') risks.push('Evidence proves a fact, not a willingness to introduce.');
    if (age && age > 365 * 86_400_000) risks.push('Older than a year: confirm it still holds.');
    if (edge.rel === 'coauthorship') risks.push("Co-authorship isn't friendship or investment authority.");
    const action = edge.type === 'verified' ? (edge.rel === 'authenticated' ? `Write to ${b?.label} directly or ask for the intro.` : 'Use as the main path.') : edge.type === 'documented' ? `Confirm with ${a?.id === 'you' ? b?.label : a?.label} that the relationship is active.` : "Verify it or drop it; don't use it in a message.";
    const leads = edge.leadIds.map((id) => job.leads.find((l) => l.id === id)).filter(Boolean) as Lead[];
    return <Drawer open onClose={onClose} title="Relationship" subtitle={`${a?.label || edge.from} → ${b?.label || edge.to}`} tone={demo ? 'demo' : undefined}>
      <div className="r-pair">{[a, b].map((n, i) => n && <div key={i}><span className={`r-ico k-${n.kind}`}>{initials(n.label)}</span><b>{n.label}</b><small>{GKIND_LABEL[n.kind]}</small></div>)}</div>
      <dl className="x-dl">
        <dt>Type</dt><dd>{RELATION_LABEL[edge.rel]}</dd>
        <dt>Certainty</dt><dd><LinkBadge status={edge.type} compact /></dd>
        <dt>Strength</dt><dd>{edge.strength != null ? fmtPct(edge.strength) : '—'}</dd>
        <dt>Source</dt><dd>{edge.source}{edge.url && !demo && <> · <a href={edge.url} target="_blank" rel="noreferrer">original <ExternalLink size={11} /></a></>}</dd>
        <dt>Date</dt><dd>{edge.date ? `${fmtDate(edge.date)} · ${fmtAge(edge.date)}` : '—'}</dd>
        <dt>Detail</dt><dd>{edge.label}</dd>
      </dl>
      <div className="x-callout"><b>Suggested action</b><span>{action}</span></div>
      {risks.length > 0 && <><h3 className="x-h3">Risks</h3><ul className="x-bullets neg">{risks.map((r) => <li key={r}>{r}</li>)}</ul></>}
      <h3 className="x-h3">Evidence ({edge.evidence.length})</h3>
      {edge.evidence.length ? edge.evidence.slice(0, 3).map((e) => <EvidenceItem key={e.id} e={e} demo={demo} />) : <p className="x-muted">From your account graph ({edge.source}).</p>}
      {edge.evidence.length > 3 && <button className="x-btn sm" onClick={() => onEvidence('Relationship evidence', edge.evidence)}>View all</button>}
      {leads.length > 0 && <><h3 className="x-h3">Leads to</h3><ul className="x-linklist">{leads.map((l) => <li key={l.id}><button onClick={() => { onSelectLead(l.id); onClose(); }}>{l.person || l.org}<ChevronRight size={13} /></button></li>)}</ul></>}
    </Drawer>;
  }
  if (node) {
    const rel = graph?.edges.filter((e) => (e.from === node.id || e.to === node.id) && e.rel !== 'affiliation') || [];
    return <Drawer open onClose={onClose} title={node.label} subtitle={`${GKIND_LABEL[node.kind]} · ${clip(node.sub, 60)}`} tone={demo ? 'demo' : undefined}>
      <h3 className="x-h3">Relationships ({rel.length})</h3>
      <ul className="x-rel-list">{rel.map((e) => { const other = nodeOf(e.from === node.id ? e.to : e.from); return <li key={e.id}><LinkBadge status={e.type} compact /><span><b>{other?.label}</b><small>{RELATION_LABEL[e.rel]}{e.strength != null ? ` · ${fmtPct(e.strength)}` : ''}</small></span>{other?.leadId && <button className="x-link-btn" onClick={() => { onSelectLead(other.leadId!); onClose(); }}>Open</button>}</li>; })}</ul>
    </Drawer>;
  }
  return null;
}

export function Section({ title, aside, children, id }: { title: ReactNode; aside?: ReactNode; children: ReactNode; id?: string }) {
  return <section className="x-section" id={id}><header><h2>{title}</h2>{aside}</header>{children}</section>;
}

/** Warm path to build: advice first, then updates before the round (or program officer for grants). */
export function PlanSteps({ lead }: { lead: Lead }) {
  const w = warmPlanOf(lead);
  if (!w) return <p className="ld-empty">Discarded.</p>;
  return <div className="wp-plan">
    <div className="ld-chips"><span className="pl-chip sky">{w.label}</span>{w.source === 'ai' && <span className="pl-chip lav">AI angle</span>}{w.updates ? <span className="pl-chip gray">{w.updates} updates before the ask</span> : null}</div>
    {w.hook && <p className="wp-hook">{clipWords(cleanText(w.hook), 260)}{w.evidence && <> <a href={w.evidence.url} target="_blank" rel="noreferrer" title={readableQuote(w.evidence.quote)}>source</a></>}</p>}
    <ol className="ld-tl">
      <li><i className="ld-tl-ico ink">You</i><div><p><b>You</b></p><small>No network path yet</small></div></li>
      {w.steps.map((st, i) => <li key={i}><i className="ld-tl-ico">{i + 1}</i><div><p>{cleanText(st.what)}</p>{st.when && <small>{st.when}</small>}</div></li>)}
    </ol>
  </div>;
}
