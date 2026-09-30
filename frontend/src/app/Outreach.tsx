/* Outreach: a CRM-style pipeline of everyone you approach (to contact → sent → replied → meeting → won/closed),
   drafting per person, the period investor update, and meeting prep with each person's own public words.
   The app drafts and logs; it never sends anything. */
import { CalendarDays, ExternalLink, FileText, GripVertical, MessageSquare, Plus, Send, Upload, UserPlus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type DragEvent, type ReactNode } from 'react';
import { advisorApi, analysisApi, type AdvisorState, type Brief, type Claim, type Connector, type DossierResult, type OutreachEvent, type OutreachState, type ShortItem, type Status } from '../analysisApi';
import type { Job } from '../researchApi';
import { Composer, UpdateEditor, type Target } from './Advisor';
import { AnalysisView } from './Analysis';
import { CandidateInsight, findDossier, findLead } from './Insight';
import { PageHeader } from './Shell';
import { Drawer, EmptyState, ErrorState, SkeletonState } from './ui';

export type OutreachTab = 'pipeline' | 'analisis' | 'reunion';
const errMsg = (e: unknown) => (e instanceof Error ? e.message : 'Unexpected error');
const initials = (s: string) => s.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || '?';
const norm = (s: string | null | undefined) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const TINTS = ['lav', 'mint', 'sun', 'gray'];

type ColKey = 'todo' | 'sent' | 'replied' | 'meeting' | 'won' | 'closed';
const COLS: { key: ColKey; label: string; tone: string; outcome?: string }[] = [
  { key: 'todo', label: 'To contact', tone: 'gray' },
  { key: 'sent', label: 'Sent', tone: 'lav', outcome: 'enviado' },
  { key: 'replied', label: 'Replied', tone: 'sun', outcome: 'pide_info' },
  { key: 'meeting', label: 'Meeting', tone: 'mint', outcome: 'reunion' },
  { key: 'won', label: 'Term sheet', tone: 'dark', outcome: 'term_sheet' },
  { key: 'closed', label: 'Closed', tone: 'rose', outcome: 'negativa' },
];
const COL_OF: Record<string, ColKey> = { enviado: 'sent', sin_respuesta: 'closed', negativa: 'closed', pide_info: 'replied', reunion: 'meeting', segunda_reunion: 'meeting', term_sheet: 'won' };

type Todo = { id: string; kind: 'lead'; item: ShortItem } | { id: string; kind: 'connector'; item: Connector };
type Open = { kind: 'event'; e: OutreachEvent } | { kind: 'todo'; t: Todo } | { kind: 'log' } | { kind: 'update' } | null;

export function OutreachView({ job, defaultProfile, tab, onTab, onOpenLead }: { job: Job | null; defaultProfile: string; tab: OutreachTab; onTab: (t: OutreachTab) => void; onOpenLead?: (id: string) => void }) {
  const [st, setSt] = useState<OutreachState | null>(null);
  const [adv, setAdv] = useState<AdvisorState | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState<Open>(null);
  const [notice, setNotice] = useState('');
  const [meetWith, setMeetWith] = useState('');
  const [dossiers, setDossiers] = useState<DossierResult[]>([]);
  const jobId = job?.id || null;
  const load = useCallback(() => {
    analysisApi.outreach().then(setSt).catch((e) => setErr(errMsg(e)));
    analysisApi.status().then(setStatus).catch(() => undefined);
    if (jobId) advisorApi.state(jobId, 120).then(setAdv).catch(() => undefined);
    // The AI analysis of each contact feeds the scorecard shown when a pipeline item is opened.
    if (jobId) advisorApi.deepLatest(jobId).then((r) => setDossiers(r.run?.dossiers || [])).catch(() => undefined);
  }, [jobId]);
  const insight = (q: { leadKey?: string | null; person?: string | null; org?: string | null }) => { const lead = findLead(job?.leads, q); return <CandidateInsight lead={lead} dossier={findDossier(dossiers, lead, q.person)} />; };
  useEffect(load, [load]);

  const move = async (e: OutreachEvent, outcome: string) => {
    setSt((s) => s && { ...s, events: s.events.map((x) => (x.id === e.id ? { ...x, outcome } : x)) });
    try { await analysisApi.updateOutreach(e.id, { outcome }); load(); } catch (x) { setErr(errMsg(x)); load(); }
  };
  const logFor = async (t: Todo, channel: string) => {
    const it = t.item;
    const fundName = t.kind === 'lead' ? (t.item.org || t.item.name) : (t.item.org || t.item.name);
    try { await analysisApi.addOutreach({ fundName, person: t.kind === 'lead' ? t.item.person || null : t.item.name, channel, arguments: [], sentAt: new Date().toISOString().slice(0, 10), shared: false }); setNotice(`${it.name} moved to Sent.`); load(); } catch (x) { setErr(errMsg(x)); }
  };
  const upload = async (file: File) => { try { const r = await analysisApi.importOutreach(await file.text(), false); setNotice(`${r.imported} rows imported${r.errors.length ? `, ${r.errors.length} with errors` : ''}.`); load(); } catch (e) { setErr(errMsg(e)); } };

  const events = st?.events || [];
  const todos = useMemo<Todo[]>(() => {
    if (!adv) return [];
    const logged = new Set(events.flatMap((e) => [norm(e.person), norm(e.fundName)]).filter(Boolean));
    const leads: Todo[] = adv.list.filter((r) => !logged.has(norm(r.person)) && !logged.has(norm(r.org))).map((r) => ({ id: `l:${r.leadKey}`, kind: 'lead', item: r }));
    const cons: Todo[] = adv.connectors.filter((c) => c.targets.length && !logged.has(norm(c.name))).slice(0, 6).map((c) => ({ id: `c:${c.key}`, kind: 'connector', item: c }));
    return [...leads, ...cons];
  }, [adv, events]);
  const cols = useMemo(() => {
    const m = new Map<ColKey, OutreachEvent[]>(COLS.map((c) => [c.key, []]));
    for (const e of events) m.get(COL_OF[e.outcome] || 'sent')!.push(e);
    return m;
  }, [events]);
  const replied = events.filter((e) => !['enviado', 'sin_respuesta'].includes(e.outcome)).length;
  const meetings = events.filter((e) => ['reunion', 'segunda_reunion', 'term_sheet'].includes(e.outcome)).length;
  const due = adv?.list.filter((r) => r.state.nextDue && r.state.nextDue <= new Date().toISOString().slice(0, 10)).length || 0;

  const actions = <>
    <button className="x-btn sm" onClick={() => setOpen({ kind: 'update' })}><FileText size={13} /> Investor update</button>
    <label className="x-btn sm"><Upload size={13} /> Import CSV<input type="file" accept=".csv" hidden onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} /></label>
    <button className="x-btn primary sm" onClick={() => setOpen({ kind: 'log' })}><Plus size={13} /> Log outreach</button>
  </>;

  return <div className="pl-page or">
    <PageHeader crumb="Workspace" title="Outreach" badge={<span className="pl-count">{events.length} logged</span>} actions={actions} />
    <div className="pl-tabs" role="tablist">
      <button role="tab" aria-selected={tab === 'pipeline'} className={tab === 'pipeline' ? 'on' : ''} onClick={() => onTab('pipeline')}>Pipeline</button>
      <button role="tab" aria-selected={tab === 'analisis'} className={tab === 'analisis' ? 'on' : ''} onClick={() => onTab('analisis')}>Analysis</button>
      <button role="tab" aria-selected={tab === 'reunion'} className={tab === 'reunion' ? 'on' : ''} onClick={() => onTab('reunion')}>Meeting prep</button>
    </div>
    {err && <ErrorState message={err} onRetry={() => { setErr(''); load(); }} />}
    {notice && <p className="x-note" onClick={() => setNotice('')}>{notice}</p>}
    {tab === 'pipeline' && (!st ? <SkeletonState variant="cards" rows={4} label="Loading pipeline…" /> : <>
      <section className="pl-card or-kpis"><div className="pl-stats">
        <div><span>To contact</span><b>{todos.length}</b></div>
        <div><span>Logged</span><b>{events.length}</b></div>
        <div><span>Reply rate</span><b>{events.length ? Math.round((100 * replied) / events.length) : 0}<small>%</small></b></div>
        <div><span>Meetings</span><b>{meetings}</b></div>
        <div><span>Updates due</span><b>{due}</b></div>
      </div></section>
      <Board cols={cols} todos={todos} options={st.options} onMove={move} onOpenEvent={(e) => setOpen({ kind: 'event', e })} onOpenTodo={(t) => setOpen({ kind: 'todo', t })} />
      <Learnings st={st} />
    </>)}
    {tab === 'analisis' && <AnalysisView embedded job={job} onOpenOutreach={() => onTab('pipeline')} onOpenLead={(id) => onOpenLead?.(id)} />}
    {tab === 'reunion' && <Meeting status={status} defaultProfile={defaultProfile} initial={meetWith} />}

    {open?.kind === 'log' && st && <LogDrawer st={st} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); load(); }} />}
    {open?.kind === 'update' && <Drawer open onClose={() => setOpen(null)} title="Investor update" subtitle="The only facts the advisor may use. Start a line with [private] to keep it out." width={640}>
      {jobId && adv ? <UpdateEditor embedded updates={adv.updates} jobId={jobId} onSaved={load} /> : <EmptyState title="Run an evaluation first" />}
    </Drawer>}
    {open?.kind === 'todo' && jobId && adv && <Drawer open onClose={() => setOpen(null)} width={640} title={open.t.item.name} subtitle={open.t.kind === 'lead' ? `${open.t.item.label} · ${open.t.item.org}` : `Connector · reaches ${open.t.item.targets.length}`}
      footer={<div className="an-row"><button className="x-btn sm" onClick={() => { void logFor(open.t, open.t.kind === 'connector' ? 'intro_advisor' : 'cold_email'); setOpen(null); }}><Send size={13} /> Mark as sent</button></div>}>
      {open.t.kind === 'lead' && insight({ leadKey: open.t.item.leadKey, person: open.t.item.person, org: open.t.item.org })}
      {open.t.kind === 'lead' && <p className="or-move">{open.t.item.move.text}</p>}
      <Composer embedded key={open.t.id} jobId={jobId} target={(open.t.kind === 'lead' ? { kind: 'lead', item: open.t.item } : { kind: 'connector', item: open.t.item }) as Target} updates={adv.updates} cadence={120} onClose={() => setOpen(null)} onSent={() => { void logFor(open.t, open.t.kind === 'connector' ? 'intro_advisor' : 'update'); }} />
    </Drawer>}
    {open?.kind === 'event' && st && <EventDrawer e={open.e} st={st} insight={insight({ person: open.e.person, org: open.e.fundName })} onClose={() => setOpen(null)} onMove={(o) => { void move(open.e, o); setOpen({ kind: 'event', e: { ...open.e, outcome: o } }); }} onPrep={() => { setMeetWith(open.e.person || ''); setOpen(null); onTab('reunion'); }} />}
  </div>;
}

function Board({ cols, todos, options, onMove, onOpenEvent, onOpenTodo }: { cols: Map<ColKey, OutreachEvent[]>; todos: Todo[]; options: OutreachState['options']; onMove: (e: OutreachEvent, o: string) => void; onOpenEvent: (e: OutreachEvent) => void; onOpenTodo: (t: Todo) => void }) {
  const [over, setOver] = useState<ColKey | null>(null);
  const [drag, setDrag] = useState<OutreachEvent | null>(null);
  const drop = (c: (typeof COLS)[number]) => (ev: DragEvent) => { ev.preventDefault(); setOver(null); if (drag && c.outcome && COL_OF[drag.outcome] !== c.key) onMove(drag, c.outcome); setDrag(null); };
  return <div className="or-board">{COLS.map((c) => {
    const list = c.key === 'todo' ? todos : cols.get(c.key) || [];
    return <section key={c.key} className={`or-col ${over === c.key ? 'over' : ''}`} onDragOver={(e) => { if (c.outcome && drag) { e.preventDefault(); setOver(c.key); } }} onDragLeave={() => setOver(null)} onDrop={drop(c)}>
      <header><i className={`dot ${c.tone}`} /><b>{c.label}</b><span className="pl-count">{list.length}</span></header>
      <div className="or-list">
        {c.key === 'todo' ? todos.map((t, i) => <button key={t.id} className="or-card" onClick={() => onOpenTodo(t)}>
          <span className="pl-who"><i className={`pl-av ${TINTS[i % 4]}`}>{initials(t.item.name)}</i><span><b>{t.item.name}</b><small>{t.kind === 'lead' ? t.item.org : `Reaches ${t.item.targets.length} decision-maker${t.item.targets.length === 1 ? '' : 's'}`}</small></span></span>
          <span className="or-meta">{t.kind === 'lead' ? <><span className="pl-chip lav">{t.item.label}</span>{t.item.pathHops ? <span className="pl-chip mint">Path {t.item.warm}%</span> : <span className="pl-chip sky">Build · updates</span>}</> : <span className="pl-chip sun"><UserPlus size={11} /> Connector</span>}</span>
          <span className="or-cta">Draft message</span>
        </button>)
          : (list as OutreachEvent[]).map((e, i) => <div key={e.id} className="or-card" draggable onDragStart={() => setDrag(e)} onDragEnd={() => { setDrag(null); setOver(null); }} onClick={() => onOpenEvent(e)} role="button" tabIndex={0} onKeyDown={(k) => k.key === 'Enter' && onOpenEvent(e)}>
            <GripVertical size={13} className="or-grip" />
            <span className="pl-who"><i className={`pl-av ${TINTS[i % 4]}`}>{initials(e.person || e.fundName)}</i><span><b>{e.person || e.fundName}</b><small>{e.person ? e.fundName : options.channels[e.channel]}</small></span></span>
            <span className="or-meta"><span className="pl-chip gray">{options.channels[e.channel] || e.channel}</span>{c.key === 'closed' && <span className="pl-chip rose">{options.outcomes.find((o) => o.key === e.outcome)?.label}</span>}</span>
            <span className="or-date"><CalendarDays size={11} /> {e.sentAt}</span>
          </div>)}
        {!list.length && <p className="or-empty">{c.key === 'todo' ? 'Nobody pending' : 'Drop here'}</p>}
      </div>
    </section>;
  })}</div>;
}

function Bars({ rows }: { rows: OutreachState['byChannel']['rows'] }) {
  if (!rows.length) return <p className="pl-empty">No closed outreach yet.</p>;
  return <ul className="or-bars">{rows.map((r) => <li key={r.key}><span>{r.label}</span><i><em className="r" style={{ width: `${Math.round((r.replyRate.mean || 0) * 100)}%` }} /><em className="m" style={{ width: `${Math.round((r.meetingRate.mean || 0) * 100)}%` }} /></i><b>{r.meetingRate.label}</b></li>)}</ul>;
}
function Learnings({ st }: { st: OutreachState }) {
  return <div className="pl-row three">
    <section className="pl-card"><header><h3>By channel</h3><span className="or-legend"><i className="dot lav" />Replies <i className="dot mint" />Meetings</span></header><Bars rows={st.byChannel.rows} /></section>
    <section className="pl-card"><header><h3>By argument</h3></header><Bars rows={st.byArgument.rows} /></section>
    <section className="pl-card"><header><h3>What we're learning</h3></header>
      <p className="or-learn">{st.nextVariant ? <>Try next: <b>{st.options.channels[st.nextVariant.key] || st.options.arguments[st.nextVariant.key] || st.nextVariant.key}</b></> : 'Log more outreach to compare channels and arguments.'}</p>
      <p className="pl-mut or-small">{st.byChannel.note}</p>
    </section>
  </div>;
}

function LogDrawer({ st, onClose, onSaved }: { st: OutreachState; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ fundName: '', person: '', channel: 'cold_email', arguments: [] as string[], variant: '', sentAt: new Date().toISOString().slice(0, 10), shared: false });
  const [err, setErr] = useState('');
  const save = async () => { try { await analysisApi.addOutreach({ ...form, variant: form.variant || null }); onSaved(); } catch (e) { setErr(errMsg(e)); } };
  return <Drawer open onClose={onClose} title="Log outreach" subtitle="The app never sends. Log what you sent." width={520}
    footer={<div className="an-row"><button className="x-btn" onClick={onClose}>Cancel</button><button className="x-btn primary" disabled={!form.fundName.trim()} onClick={() => void save()}>Save</button></div>}>
    <div className="or-form">
      <label className="x-field">Fund or organization<input data-autofocus value={form.fundName} onChange={(e) => setForm({ ...form, fundName: e.target.value })} /></label>
      <label className="x-field">Person<input value={form.person} onChange={(e) => setForm({ ...form, person: e.target.value })} /></label>
      <label className="x-field">Channel<select value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })}>{Object.entries(st.options.channels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <label className="x-field">Sent on<input type="date" value={form.sentAt} onChange={(e) => setForm({ ...form, sentAt: e.target.value })} /></label>
      <div className="x-field"><span>Arguments used</span><div className="or-toggles">{Object.entries(st.options.arguments).map(([k, v]) => <button type="button" key={k} className={`pl-chip ${form.arguments.includes(k) ? 'dark' : 'gray'}`} onClick={() => setForm({ ...form, arguments: form.arguments.includes(k) ? form.arguments.filter((a) => a !== k) : [...form.arguments, k] })}>{v}</button>)}</div></div>
      <label className="x-field">Message variant (optional)<input value={form.variant} onChange={(e) => setForm({ ...form, variant: e.target.value })} placeholder="e.g. v2-clinical-data" /></label>
      <label className="x-check"><input type="checkbox" checked={form.shared} onChange={(e) => setForm({ ...form, shared: e.target.checked })} />Share the outcome anonymously with the founder network</label>
      {err && <ErrorState message={err} />}
    </div>
  </Drawer>;
}

function EventDrawer({ e, st, insight, onClose, onMove, onPrep }: { e: OutreachEvent; st: OutreachState; insight: ReactNode; onClose: () => void; onMove: (o: string) => void; onPrep: () => void }) {
  return <Drawer open onClose={onClose} title={e.person || e.fundName} subtitle={e.person ? e.fundName : undefined} width={560}
    footer={<div className="an-row">{e.person && <button className="x-btn primary sm" onClick={onPrep}><MessageSquare size={13} /> Prep meeting</button>}</div>}>
    {insight}
    <div className="an2-dr-grid">
      <div><span>Channel</span><b>{st.options.channels[e.channel] || e.channel}</b></div>
      <div><span>Sent</span><b>{e.sentAt}</b></div>
    </div>
    <p className="or-h">Stage</p>
    <div className="or-stages">{st.options.outcomes.map((o) => <button key={o.key} className={`pl-chip ${e.outcome === o.key ? 'dark' : 'gray'}`} onClick={() => onMove(o.key)}>{o.label}</button>)}</div>
    {e.arguments.length > 0 && <><p className="or-h">Arguments</p><div className="or-stages">{e.arguments.map((a) => <span key={a} className="pl-chip lav">{st.options.arguments[a] || a}</span>)}</div></>}
    {e.variant && <><p className="or-h">Variant</p><p>{e.variant}</p></>}
  </Drawer>;
}

/* Meeting prep: brief built only from what the person said publicly, plus an objection simulator. */
const Cite = ({ url, quote, children }: { url: string; quote?: string; children?: ReactNode }) => <a className="an-cite" href={url} target="_blank" rel="noreferrer" title={quote}>{children || 'source'} <ExternalLink size={11} /></a>;
const ClaimLine = ({ c }: { c: Claim }) => <li>{c.text} <Cite url={c.url} quote={c.quote}>{c.position ? `min ${c.position}` : 'quote'}</Cite></li>;
function Meeting({ status, defaultProfile, initial }: { status: Status | null; defaultProfile: string; initial: string }) {
  const people = status?.voicePeople || [];
  const [person, setPerson] = useState('');
  const [facts, setFacts] = useState('');
  const [brief, setBrief] = useState<Brief | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [chat, setChat] = useState<{ role: string; text: string; citations?: Claim[] }[]>([]);
  const [msg, setMsg] = useState('');
  useEffect(() => { if (person) return; const hit = people.find((p) => norm(p.person) === norm(initial)); if (hit) setPerson(hit.person); else if (people[0]) setPerson(people[0].person); }, [people, person, initial]);
  if (!status) return <SkeletonState rows={3} />;
  if (!people.length) return <EmptyState icon={<MessageSquare size={22} />} title="No voices indexed yet">Index someone's public blog, newsletter or podcast with scripts/voice.mjs to prepare a meeting.</EmptyState>;
  const parsedFacts = facts.split('\n').map((l) => l.split('|').map((x) => x.trim())).filter(([t, s]) => t && s).map(([text, source]) => ({ text, source }));
  const run = async () => { setBusy(true); setErr(''); try { setBrief(await analysisApi.brief(person, defaultProfile, parsedFacts)); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); } };
  const send = async () => { const history = chat.map(({ role, text }) => ({ role, text })); setChat([...chat, { role: 'You', text: msg }]); setMsg(''); try { const r = await analysisApi.simulate(person, msg, history); setChat((c) => [...c, { role: person, text: r.reply, citations: r.citations }]); } catch (e) { setErr(errMsg(e)); } };
  return <div className="pl-row even">
    <section className="pl-card">
      <header><h3>Meeting brief</h3></header>
      <div className="or-form">
        <label className="x-field">Person<select value={person} onChange={(e) => { setPerson(e.target.value); setBrief(null); setChat([]); }}>{people.map((p) => <option key={p.person_key} value={p.person}>{p.person} · {p.sources} sources</option>)}</select></label>
        <label className="x-field">Facts you can back up (fact | source URL)<textarea rows={3} value={facts} onChange={(e) => setFacts(e.target.value)} placeholder="Pilot results published on … | https://…" /></label>
        <button className="x-btn primary" onClick={() => void run()} disabled={busy || !person}>{busy ? 'Preparing…' : 'Prepare brief'}</button>
      </div>
      {err && <ErrorState message={err} />}
      {brief && <div className="an-brief">
        {brief.sections.map((s) => <div key={s.key}><p className="or-h">{s.label}</p>{s.claims.length ? <ul className="an2-dr-ul">{s.claims.map((c, i) => <ClaimLine key={i} c={c} />)}</ul> : <p className="pl-mut">{s.note || 'No evidence.'}</p>}</div>)}
        <p className="or-h">Likely objections</p>
        {brief.objections.map((o, i) => <div key={i} className="or-obj"><b>{o.objection}</b> <Cite url={o.url} quote={o.quote}>quote</Cite><p>{o.answer}</p></div>)}
      </div>}
    </section>
    <section className="pl-card">
      <header><h3>Objection simulator</h3></header>
      <div className="an-chat">{chat.map((m, i) => <div key={i} className={`an-msg ${m.role === 'You' ? 'me' : ''}`}><b>{m.role}</b><p>{m.text}</p>{m.citations?.map((c, j) => <Cite key={j} url={c.url} quote={c.quote}>{c.position ? `min ${c.position}` : `quote ${j + 1}`}</Cite>)}</div>)}</div>
      <div className="an-row"><input className="an-input" value={msg} onChange={(e) => setMsg(e.target.value)} placeholder={`Pitch ${person || 'them'}…`} onKeyDown={(e) => { if (e.key === 'Enter' && msg.trim()) void send(); }} /><button className="x-btn" disabled={!msg.trim()} onClick={() => void send()}><Send size={14} /></button></div>
    </section>
  </div>;
}
