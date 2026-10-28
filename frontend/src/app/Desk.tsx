/* ─────────────────────────────────────────────────────────────────────────────
   Raise Desk (27-10): investment results organized to decide and act.
   Answers, per candidate and with the source in view: who to approach first and why, what shows
   they invest and may fit, which comparable deals they did, who the right contact is, and what
   to do next. No numeric scores, rings or confidence labels: tiers come from requirements and
   evidence (server: investors/fit.mjs). Sections only appear when there is data behind them.
   ───────────────────────────────────────────────────────────────────────────── */
import { AlertTriangle, Bookmark, CheckCircle2, ChevronRight, ExternalLink, FileText, LoaderCircle, Search, Sparkles, Users } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { API, type Job, type Lead, type OutreachPlan, type PlanItem, type TrackingItem } from '../researchApi';
import { clip } from './format';

const TIER: Record<string, { title: string; tag: string; tone: string; help: string }> = {
  meets: { title: 'Meets your criteria', tag: 'Meets criteria', tone: 'mint', help: 'Investor type and investing activity shown by its sources. Gaps are listed; review before contacting.' },
  alternative: { title: 'Alternatives (other investor types)', tag: 'Alternative', tone: 'lav', help: 'Investors with evidence, but not the type you asked for first.' },
  verify: { title: 'To verify', tag: 'Verify first', tone: 'sun', help: 'Type, investing activity or the person’s role is not shown by the sources yet.' },
  excluded: { title: 'Ruled out', tag: 'Ruled out', tone: 'gray', help: 'Your exclusions, non-investment roles, companies that received capital, or other types when you asked for only one.' },
};
const TYPE: Record<string, string> = { family_office: 'Family office', venture_capital: 'Venture capital', corporate_venture: 'Corporate venture', angel: 'Angel', private_equity: 'Private equity', hedge_fund: 'Public-markets investor', crossover: 'Crossover fund', foundation: 'Foundation', wealth_adviser: 'Wealth adviser', operating_company: 'Operating company', funded_company: 'Raised capital (not an investor)', investor: 'Investor (type not stated)', unknown: 'Type not established' };
export const tierOf = (l: Lead) => l.investorFit?.tier || (l.bucket === 'discarded' ? 'excluded' : l.bucket === 'top' ? 'meets' : 'verify');
export const typeText = (l: Lead) => { const e = l.investorFit?.entity; if (!e) return null; return `${TYPE[e.type] || e.type}${e.nameOnly ? ' (name only, not confirmed)' : ''}`; };
const isInvestmentJob = (job: Job) => job.brief.fundingTypes.includes('investment');

/* What this run could not do, and what that changes in the result (from the real run events). */
export function runLimits(job: Job): { text: string; impact: string }[] {
  const out: { text: string; impact: string }[] = []; const seen = new Set<string>();
  const push = (key: string, text: string, impact: string) => { if (!seen.has(key)) { seen.add(key); out.push({ text, impact }); } };
  for (const e of job.run?.events || []) {
    const m = `${e.provider || ''} ${e.title} ${e.message}`;
    if (/decision agent|openjev|\bjev\b/i.test(m) && /\b(402|unavailable|failed|error)\b/i.test(m)) push('jev', `Decision Agent did not run (${/402/.test(m) ? 'HTTP 402: the provider refused the request, usually billing or credits' : clip(e.message, 90)}).`, 'Order and tiers come from the rules only; no second review.');
    else if (/no imported contacts|warm paths can'?t be computed/i.test(m)) push('net', 'No contacts imported, so no introduction paths were computed.', 'Every approach shown is direct (cold) unless a source documents a relationship.');
    else if (/deals database is empty/i.test(m)) push('deals', 'The deals database is empty; revealed-thesis ranking was skipped.', 'Deals shown come only from pages read in this run.');
    else if (/limited (equity|coverage)/i.test(m)) push('cov', 'Limited coverage for public-company financing: placement-agent data is not integrated.', 'PIPE and registered-direct participants may be missing.');
    else if ((e.status === 'error' || e.phase === 'error') && e.provider) push(`err:${e.provider}`, `${e.provider}: ${clip(e.message, 120)}`, 'Results from this source are missing.');
  }
  return out;
}

const basisTag = (b: PlanItem['basis']) => <span className={`dk-basis ${b}`}>{b === 'fact' ? 'Fact' : b === 'inference' ? 'Inference' : 'Proposal'}</span>;
const contactLine = (l: Lead, job: Job) => {
  if (l.person) return { name: l.person, role: l.role || 'Role not confirmed', fit: l.investorFit?.role?.value };
  const people = job.leads.filter((p) => p.person && p.org === l.org && tierOf(p) !== 'excluded');
  const best = people.find((p) => p.investorFit?.role?.value === 'investing') || null;
  return best ? { name: best.person!, role: best.role || 'Role not confirmed', fit: best.investorFit?.role?.value } : null;
};

export function RaiseDesk({ job, selectedId, onOpen, onSimilar }: { job: Job; selectedId: string | null; onOpen: (id: string) => void; onSimilar?: (ids: string[]) => void }) {
  const [pick, setPick] = useState<Set<string>>(new Set());
  const [showOut, setShowOut] = useState(false);
  const leads = job.leads;
  const groups = useMemo(() => {
    const g: Record<string, Lead[]> = { meets: [], alternative: [], verify: [], excluded: [] };
    for (const l of leads) g[tierOf(l)].push(l);
    return g;
  }, [leads]);
  const limits = runLimits(job);
  const asked = (job.brief.investorTypes || '').split(',').filter(Boolean).map((t) => TYPE[t] || t);
  const first = groups.meets.filter((l) => !l.person).slice(0, 3);
  const row = (l: Lead) => {
    const f = l.investorFit; const c = contactLine(l, job);
    const why = f?.reasons[0] || l.why[0] || '';
    const gap = f?.gaps[0];
    return <li key={l.id}><div className={`dk-row ${selectedId === l.id ? 'open' : ''}`}>
      {onSimilar && tierOf(l) !== 'excluded' && <input type="checkbox" aria-label={`Select ${l.person || l.org} for “find more like these”`} checked={pick.has(l.id)} onChange={(e) => setPick((s) => { const n = new Set(s); if (e.target.checked) n.add(l.id); else n.delete(l.id); return n; })} />}
      <button type="button" className="dk-main" onClick={() => onOpen(l.id)} aria-pressed={selectedId === l.id}>
        <span className="dk-name"><b>{l.person || l.org}</b><small>{l.person ? `${l.role || 'Role not confirmed'} · ${l.org}` : typeText(l) || 'Type not established'}</small></span>
        <span className="dk-why"><span>{clip(why, 170)}</span>{gap && tierOf(l) !== 'excluded' && <small className="dk-gap"><AlertTriangle size={11} /> To confirm: {clip(gap, 110)}</small>}</span>
        <span className="dk-contact">{c ? <><b>{c.name}</b><small>{c.role}{c.fit === 'investing' ? '' : ' · investment role not shown'}</small></> : <small>{tierOf(l) === 'excluded' ? '' : 'No investment contact found'}</small>}</span>
        <span className="dk-deals">{f?.deals.length ? <b>{f.deals.length} deal{f.deals.length === 1 ? '' : 's'} cited</b> : <small>No deals cited</small>}</span>
        <span className={`pl-chip ${TIER[tierOf(l)].tone}`}>{TIER[tierOf(l)].tag}</span>
        <ChevronRight size={16} aria-hidden="true" />
      </button>
    </div></li>;
  };
  return <section className="dk" aria-label="Investor results">
    {limits.length > 0 && <div className="dk-limits" role="note"><h3><AlertTriangle size={14} /> What this run could not do</h3><ul>{limits.map((x) => <li key={x.text}><b>{x.text}</b> <span>{x.impact}</span></li>)}</ul></div>}
    <div className="dk-first">
      <h3>Who to approach first</h3>
      {first.length ? <ol>{first.map((l) => { const c = contactLine(l, job); return <li key={l.id}><button className="x-link-btn" onClick={() => onOpen(l.id)}><b>{l.org}</b></button> — {clip(l.investorFit?.reasons[0] || '', 160)}{c ? ` Contact: ${c.name} (${c.role}).` : ' No investment contact named yet.'} <i>Next: {l.investorFit?.nextAction}</i></li>; })}</ol>
        : <p className="dk-none">{asked.length ? `No candidate meets all your criteria (${asked.join(', ')}) with evidence in this run.` : 'No candidate meets your criteria with evidence in this run.'} {groups.alternative.length || groups.verify.length ? 'Alternatives and candidates to verify are listed separately below; they are not a validated selection.' : 'Try widening the geography or sector, or import a list of funds to review.'}</p>}
    </div>
    {(['meets', 'alternative', 'verify'] as const).map((t) => groups[t].length > 0 && <div key={t} className="dk-group">
      <header><h3>{TIER[t].title} <span className="pl-badge">{groups[t].length}</span></h3><small>{TIER[t].help}</small></header>
      <ul className="dk-list">{groups[t].map(row)}</ul>
    </div>)}
    {groups.excluded.length > 0 && <div className="dk-group out">
      <header><h3>{TIER.excluded.title} <span className="pl-badge">{groups.excluded.length}</span></h3><button className="x-link-btn" aria-expanded={showOut} onClick={() => setShowOut(!showOut)}>{showOut ? 'Hide' : 'Show why'}</button></header>
      {showOut && <ul className="dk-list">{groups.excluded.map((l) => <li key={l.id}><button type="button" className="dk-out" onClick={() => onOpen(l.id)}><b>{l.person ? `${l.person} · ${l.role || 'role?'} · ${l.org}` : l.org}</b><span>{clip(l.discard || l.investorFit?.reasons[0] || '', 180)}</span></button></li>)}</ul>}
    </div>}
    {onSimilar && <div className="dk-similar"><Sparkles size={14} /> <span>{pick.size ? `${pick.size} selected.` : 'Select good candidates to look for similar investors.'}</span><button className="x-btn sm" disabled={!pick.size} onClick={() => onSimilar([...pick])}><Search size={13} /> Find more investors like these</button></div>}
    <p className="dk-foot"><Users size={13} /> Order follows the tiers above, then the evidence found. There is no fit score. Nothing is sent from the app.</p>
  </section>;
}

/* ───────── Detail: investor dossier, outreach plan and follow-up ───────── */
async function call<T>(path: string, init?: RequestInit, ms = 120_000): Promise<T> {
  const r = await fetch(API + path, { ...init, headers: init?.body ? { 'Content-Type': 'application/json' } : undefined, signal: AbortSignal.timeout(ms) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((d as { error?: string }).error || `HTTP ${r.status}`);
  return d as T;
}
const Quote = ({ q, url }: { q?: string | null; url?: string | null }) => q ? <q className="dk-q">{clip(q, 260)}{url && <a href={url} target="_blank" rel="noreferrer" aria-label="Open source"> <ExternalLink size={11} /></a>}</q> : null;

export function InvestorDossier({ lead, job }: { lead: Lead; job: Job }) {
  const f = lead.investorFit;
  if (!isInvestmentJob(job) || !f) return null;
  const ev = lead.investorEvidence || {};
  const people = lead.person ? [] : job.leads.filter((p) => p.person && p.org === lead.org);
  const fields: [string, string][] = [['thesis', 'Thesis and sectors'], ['stage', 'Stages'], ['geography', 'Geography'], ['recent', 'Recent activity'], ['contact', 'How to reach them']];
  return <section className="ld-sec dk-dossier">
    <header className="ld-h"><h3>Investor evidence</h3><span className={`pl-chip ${TIER[f.tier].tone}`}>{TIER[f.tier].tag}</span></header>
    <dl className="dk-dl">
      <div><dt>Entity type</dt><dd>{typeText(lead)}<Quote q={f.entity.quote} url={f.entity.url} /></dd></div>
      {f.role && <div><dt>Person’s role</dt><dd>{lead.role || 'Not confirmed'} — {f.role.value === 'investing' ? 'investment role by title (personal thesis not verified)' : f.role.value === 'leadership' ? 'senior role; investment authority not shown' : f.role.value === 'operational' ? 'not an investment role' : 'function not shown'}</dd></div>}
      {fields.filter(([k]) => ev[k]?.quote).map(([k, label]) => <div key={k}><dt>{label}</dt><dd><Quote q={ev[k]!.quote as string} url={ev[k]!.url as string} /></dd></div>)}
      <div><dt>Listed or private</dt><dd>{f.listed.value === 'listed_evidence' ? <>Mentions listed-company financing<Quote q={f.listed.quote} url={f.listed.url} /></> : f.listed.value === 'private_only' ? <>States a private-company focus<Quote q={f.listed.quote} url={f.listed.url} /></> : 'Not shown by the sources'}</dd></div>
    </dl>
    <h4 className="dk-h4">Why it appears</h4><ul className="x-bullets">{f.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
    {f.gaps.length > 0 && <><h4 className="dk-h4">To confirm</h4><ul className="x-bullets neg">{f.gaps.map((g) => <li key={g}>{g}</li>)}</ul></>}
    <h4 className="dk-h4">Comparable deals</h4>
    {f.deals.length ? <table className="x-table dk-deals-t"><thead><tr><th scope="col">Company</th><th scope="col">Year</th><th scope="col">Instrument</th><th scope="col">Amount</th><th scope="col">Source</th></tr></thead><tbody>{f.deals.map((d) => <tr key={d.company + d.year}><th scope="row">{d.company}</th><td>{d.year || 'Not stated'}</td><td>{d.instruments.join(', ') || 'Not stated'}</td><td>{d.amount ? `${d.amount.value} · ${d.amount.kind === 'round_size' ? 'total round, not their share' : 'reported participation'}` : 'Unknown'}</td><td><a href={d.url} target="_blank" rel="noreferrer" title={d.quote}>Open <ExternalLink size={11} /></a></td></tr>)}</tbody></table>
      : <p className="ld-empty">No deal cited in the sources read. Nothing is filled in to complete the card.</p>}
    {f.instruments.length > 0 && <p className="dk-note">Instruments mentioned: {f.instruments.map((i) => i.instrument).join(', ')}. Past use is not an offer to you.</p>}
    {people.length > 0 && <><h4 className="dk-h4">People found at {lead.org}</h4><ul className="dk-people">{people.map((p) => <li key={p.id}><b>{p.person}</b> — {p.role || 'role not confirmed'} <span className={`pl-chip ${TIER[tierOf(p)].tone}`}>{p.investorFit?.role?.value === 'operational' ? 'Not an investment role' : TIER[tierOf(p)].tag}</span>{p.contact?.type === 'email' && <small> · email via {p.contact.provenance?.split('·')[0] || 'contact finder'}</small>}</li>)}</ul></>}
    <p className="ld-next"><b>Next step:</b> {f.nextAction}</p>
  </section>;
}

function PlanList({ title, items }: { title: string; items: PlanItem[] }) {
  if (!items?.length) return null;
  return <><h4 className="dk-h4">{title}</h4><ul className="dk-plan">{items.map((x, i) => <li key={i}>{basisTag(x.basis)} <span>{x.text}</span>{x.source && <small> [{x.source}]</small>}</li>)}</ul></>;
}
export function OutreachPlanPanel({ lead, job }: { lead: Lead; job: Job }) {
  const [plan, setPlan] = useState<OutreachPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { setPlan(null); setErr(''); void call<{ plan: OutreachPlan | null }>(`/jobs/${job.id}/leads/${encodeURIComponent(lead.id)}/plan`, undefined, 15000).then((r) => setPlan(r.plan)).catch(() => undefined); }, [job.id, lead.id]);
  const make = async () => { setBusy(true); setErr(''); try { setPlan((await call<{ plan: OutreachPlan }>(`/jobs/${job.id}/leads/${encodeURIComponent(lead.id)}/plan`, { method: 'POST', body: '{}' })).plan); } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(false); } };
  if (!isInvestmentJob(job) || tierOf(lead) === 'excluded') return null;
  return <section className="ld-sec dk-planbox">
    <header className="ld-h"><h3>Outreach plan</h3><button className="x-btn sm primary" onClick={() => void make()} disabled={busy}>{busy ? <LoaderCircle size={13} className="spin" /> : <FileText size={13} />} {plan ? 'Prepare again' : 'Prepare an outreach plan'}</button></header>
    {err && <p className="x-note err" role="alert">{err}</p>}
    {!plan ? <p className="ld-empty">Builds a plan from this candidate’s sources and your company context. Facts, inferences and proposals are labeled. Nothing is sent.</p> : <div className="dk-planbody">
      {plan.note && <p className="dk-note"><AlertTriangle size={12} /> {plan.note}</p>}
      <PlanList title="Goal of the first contact" items={plan.objective} />
      <PlanList title="Who and through which channel" items={[...plan.who, ...plan.channel]} />
      <PlanList title="Angle" items={plan.angle} />
      <PlanList title="Deals that support the angle" items={plan.supportingDeals} />
      <PlanList title="Prepare" items={plan.materials} />
      <h4 className="dk-h4">Draft first message <span className="dk-basis proposal">Draft</span></h4>
      <pre className="dk-draft"><b>Subject: {plan.draft.subject}</b>{'\n\n'}{plan.draft.body}</pre>
      <p className="dk-note">{plan.draft.note}</p>
      <PlanList title="Follow-up" items={plan.followUp} />
      <PlanList title="Continue, postpone or discard" items={plan.conditions} />
      <PlanList title="Questions for a meeting" items={plan.questions} />
      {plan.unknown.length > 0 && <p className="dk-note">Unknown: {plan.unknown.join('; ')}.</p>}
      <details className="x-tech"><summary>Facts used ({plan.facts.length}) · built by {plan.by}</summary><ul className="dk-plan">{plan.facts.map((x) => <li key={x.id}><small>[{x.id}]</small> {x.text} {x.url && <a href={x.url} target="_blank" rel="noreferrer"><ExternalLink size={11} /></a>}</li>)}</ul></details>
    </div>}
  </section>;
}

const STATUS: [string, string][] = [['to_research', 'To research'], ['to_contact', 'To contact'], ['contacted', 'Contacted'], ['in_conversation', 'In conversation'], ['paused', 'Paused'], ['discarded', 'Discarded']];
export function FollowUpPanel({ lead, job }: { lead: Lead; job: Job }) {
  const key = `${(lead.org || '').toLowerCase()}|${(lead.person || '').toLowerCase()}`;
  const [item, setItem] = useState<TrackingItem | null>(null);
  const [draft, setDraft] = useState({ owner: '', status: 'to_research', nextAction: '', nextDate: '', note: '', activity: '', kind: 'proposed' as 'proposed' | 'scheduled' | 'done', activityDate: '' });
  const [msg, setMsg] = useState('');
  useEffect(() => { void call<{ items: TrackingItem[] }>('/tracking', undefined, 15000).then((r) => { const it = r.items.find((x) => x.key === key) || null; setItem(it); setDraft((d) => ({ ...d, owner: it?.owner || '', status: it?.status || 'to_research', nextAction: it?.nextAction || lead.investorFit?.nextAction || '', nextDate: it?.nextDate || '' })); }).catch(() => undefined); }, [key, lead.investorFit?.nextAction]);
  const save = async () => {
    setMsg('');
    const activities = [...(item?.activities || []), ...(draft.activity.trim() ? [{ kind: draft.kind, text: draft.activity.trim(), date: draft.activityDate || undefined }] : [])];
    const notes = [...(item?.notes || []), ...(draft.note.trim() ? [{ text: draft.note.trim(), at: new Date().toISOString() }] : [])];
    try { const r = await call<{ item: TrackingItem }>(`/tracking/${encodeURIComponent(key)}`, { method: 'PUT', body: JSON.stringify({ jobId: job.id, leadId: lead.id, name: lead.person || lead.org, org: lead.org, owner: draft.owner, status: draft.status, nextAction: draft.nextAction, nextDate: draft.nextDate, notes, activities }) }, 15000); setItem(r.item); setDraft((d) => ({ ...d, note: '', activity: '', activityDate: '' })); setMsg('Saved on this server for your workspace. Not shared with a team.'); }
    catch (e) { setMsg(e instanceof Error ? e.message : 'Couldn’t save.'); }
  };
  return <section className="ld-sec dk-follow">
    <header className="ld-h"><h3><Bookmark size={14} /> Follow-up</h3>{item && <small>Last real interaction: {item.lastInteraction || 'none recorded'}</small>}</header>
    <div className="dk-form">
      <label className="x-field"><span>Owner</span><input value={draft.owner} onChange={(e) => setDraft({ ...draft, owner: e.target.value })} placeholder="Who follows up" /></label>
      <label className="x-field"><span>Status</span><select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}>{STATUS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      <label className="x-field wide"><span>Next action</span><input value={draft.nextAction} onChange={(e) => setDraft({ ...draft, nextAction: e.target.value })} /></label>
      <label className="x-field"><span>Next action date</span><input type="date" value={draft.nextDate} onChange={(e) => setDraft({ ...draft, nextDate: e.target.value })} /></label>
      <label className="x-field wide"><span>Log an activity</span><input value={draft.activity} onChange={(e) => setDraft({ ...draft, activity: e.target.value })} placeholder="e.g. Sent intro email" /></label>
      <label className="x-field"><span>Kind</span><select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as 'proposed' })}><option value="proposed">Proposed</option><option value="scheduled">Scheduled</option><option value="done">Done (it happened)</option></select></label>
      <label className="x-field"><span>Date</span><input type="date" value={draft.activityDate} onChange={(e) => setDraft({ ...draft, activityDate: e.target.value })} /></label>
      <label className="x-field wide"><span>Note</span><input value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} /></label>
    </div>
    <div className="x-row"><button className="x-btn sm primary" onClick={() => void save()}><CheckCircle2 size={13} /> {item ? 'Update' : 'Save to follow-up'}</button>{msg && <small role="status">{msg}</small>}</div>
    {item && (item.activities.length > 0 || item.notes.length > 0) && <ul className="dk-acts">{item.activities.map((a) => <li key={a.id}><span className={`dk-basis ${a.kind === 'done' ? 'fact' : a.kind === 'scheduled' ? 'inference' : 'proposal'}`}>{a.kind === 'done' ? 'Done' : a.kind === 'scheduled' ? 'Scheduled' : 'Proposed'}</span> {a.text}{a.date ? ` · ${a.date}` : ''}</li>)}{item.notes.map((n) => <li key={n.at}><small>{n.at.slice(0, 10)}</small> {n.text}</li>)}</ul>}
    <p className="dk-note">A draft or a plan is not a contact. Only activities marked “Done” count as interactions.</p>
  </section>;
}
