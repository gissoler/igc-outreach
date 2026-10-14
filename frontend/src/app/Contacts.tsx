/* ─────────────────────────────────────────────────────────────────────────────
   "Who to contact first": the main result screen after an evaluation.
   Feedback 28/09 (David, PA): lead with a table — person, channel, why, how to
   reach them and a short email — and keep the map as support.
   Visual system: Plan CRM "My Leads" table + "Lead Detail" progress (Dstudio,
   Dribbble). The "how we got here" strip follows Scout's request → research →
   recommendation pattern (Appwave / Confidency, Dribbble): show the work,
   what was ruled out and why, then one clear list.
   ───────────────────────────────────────────────────────────────────────────── */
import { Check, ChevronRight, Copy, ExternalLink, Mail, Route, Search, UserRound, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Job, Lead } from '../researchApi';
import { clip, clipWords, fmtPct } from './format';
import { bestPath, isDemoJob, NOT_A_CALL_REASON, notACall, warmPlanOf, warmShort, type Summary, type SourceHealthItem } from './model';

const TINTS = ['lav', 'mint', 'sun', 'sky'];
const initialsOf = (s: string) => s.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
const firstName = (s: string | null | undefined) => (s || '').trim().split(/\s+/)[0] || '';
const FUND: Record<string, string> = { investment: 'investors', partnering: 'partners', grant: 'grants', sponsorship: 'sponsors', debt: 'lenders' };

/* Topics the engine matched, e.g. "Matches neurology, dementia in the evidence." → "neurology, dementia". */
function topicsOf(lead: Lead): string | null {
  for (const w of lead.why) { const m = /^Matches (.+?) in the evidence/i.exec(w); if (m) return m[1]; }
  return null;
}

/* One plain sentence: why this person, now. */
export function reasonFor(lead: Lead): string {
  const topics = topicsOf(lead);
  const role = lead.role ? lead.role.split(',')[0] : null;
  const org = lead.org;
  if (lead.fundingType === 'grant' || lead.kind === 'opportunity') {
    const kind = (lead.opportunityType || 'funding opportunity').replace('_', ' ');
    return topics ? `Specific ${kind} matching ${topics}.` : `Specific ${kind}: ${clip(lead.title, 72)}`;
  }
  if (topics && role) return `${role} at ${org}; backs ${topics}.`;
  if (topics) return `${org} backs ${topics}.`;
  return clip(lead.why[0] || lead.title, 90);
}

const listAnd = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs[0] || '');
const possessive = (name: string) => (/s$/i.test(name) ? `${name}'` : `${name}'s`);
const topicList = (t: string | null) => listAnd((t || '').split(/\s*,\s*/).filter(Boolean));

/* Four lines, two paragraphs — the length David asked for. Review before sending. */
export function shortDraft(lead: Lead, job: Job): { to: string; subject: string; text: string } {
  const b = job.brief;
  const venture = b.venture || b.company;
  const pitch = clipWords((b.oneLiner || b.description || b.product || '').replace(/\.$/, ''), 140);
  const round = b.round || b.stage;
  const first = firstName(lead.person) || lead.org;
  const topics = topicList(topicsOf(lead));
  const p = bestPath(lead);
  if (lead.fundingType === 'grant' || lead.kind === 'opportunity') {
    const number = lead.grantPlan?.programNumber || 'program number to confirm';
    // Una convocatoria se aplica en el portal: el «borrador» es la hoja de cómo aplicar que arma el servidor.
    const apply = lead.grantPlan?.apply;
    return {
      to: apply?.portal?.name || 'Official program page',
      subject: lead.draft?.subject || `How to apply · ${number}`,
      text: lead.draft?.body || `Official call: ${number} — ${lead.title}\n\nNext action: ${lead.grantPlan?.nextAction || 'Review the official notice and apply on the official portal.'}`,
    };
  }
  if (p?.introducer) {
    const via = firstName(p.introducer);
    return {
      to: p.introducer,
      subject: `Intro to ${lead.person || lead.org}?`,
      text: `Hi ${via}, would you be open to introducing me to ${lead.person || first}${lead.person ? ` at ${lead.org}` : ''}? ${topics ? `They back ${topics}, which is exactly our space.` : 'They look like a strong fit for us.'}\n\n${venture}: ${pitch}. We're raising a ${round} round; I can send a 3-line blurb you can forward. Thank you!`,
    };
  }
  return {
    to: lead.person || lead.org,
    subject: `${venture} · ${round} round`,
    text: `Hi ${first}, ${topics ? `I've followed ${possessive(lead.org)} work in ${topics}` : `I came across ${lead.org}`} and think ${venture} fits your thesis.\n\n${pitch}. We're raising a ${round} round. Would you have 20 minutes in the next two weeks?`,
  };
}

export function CopyBtn({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [ok, setOk] = useState(false);
  return <button className="pl-btn sm" onClick={() => { void navigator.clipboard.writeText(text).then(() => { setOk(true); setTimeout(() => setOk(false), 1600); }); }}>{ok ? <Check size={13} /> : <Copy size={13} />}{ok ? 'Copied' : label}</button>;
}

/* ───────── Intro: what this screen is ───────── */
export function ResultsIntro({ job }: { job: Job }) {
  const venture = job.brief.venture || job.brief.company;
  const grantsOnly = job.brief.fundingTypes.length === 1 && job.brief.fundingTypes[0] === 'grant';
  const kinds = [...new Set(job.brief.fundingTypes.map((t) => FUND[t] || t))].join(' and ');
  const n = job.leads.filter((l) => l.bucket === 'top' || l.bucket === 'radar').length;
  return <section className="ct-intro" aria-label="What you are looking at">
    <div>
      <p>{grantsOnly ? <>Calls for <b>{venture}</b> ranked by fit. Open one to see the official page without leaving Outreach.</> : <>People who can put <b>{venture}</b> in front of {kinds || 'funders'}, ranked by fit. Open one to see why, how to reach them and an email to review.</>}</p>
    </div>
  </section>;
}

/* ───────── How we got here (Scout pattern) ───────── */
export function HowWeGotHere({ job, s, health, onSources }: { job: Job; s: Summary; health: SourceHealthItem[]; onSources: () => void }) {
  const ok = health.filter((h) => h.state === 'ok').length;
  const ruled = job.leads.filter((l) => l.bucket === 'discarded');
  const reasons = new Map<string, number>();
  for (const l of ruled) { const r = (l.discard || 'Not enough evidence').replace(/\.$/, ''); reasons.set(r, (reasons.get(r) || 0) + 1); }
  const b = job.brief;
  const chips = [b.oneLiner || b.product, b.fundingTypes.map((t) => FUND[t] || t).join(' + '), b.round || b.stage, b.geography].filter(Boolean) as string[];
  const terms = job.plan?.terms || [];
  const followedPeople = job.leads.filter((lead) => lead.followUp?.from);
  const followedFunds = new Set(followedPeople.map((lead) => lead.followUp!.from));
  const grantsOnly = b.fundingTypes.length === 1 && b.fundingTypes[0] === 'grant';
  const facts: string[] = [
    ...(terms.length > 1 ? [`${terms.length} phrasings`] : []),
    `${ok} of ${health.length} sources answered`,
    ...(followedFunds.size ? [`${followedFunds.size} funders → ${followedPeople.length} people`] : []),
    ...(job.queryLedger?.length ? [`${job.queryLedger.length} follow-up queries`] : []),
  ];
  return <details className="ct-how" aria-label="How we searched">
    <summary><span>How we searched</span><small>{facts.join(' · ')}</small><ChevronRight size={14} className="ct-how-go" aria-hidden /></summary>
    <div className="ct-how-body">
      <div className="ct-brief"><small>Your brief</small>{chips.map((c) => <span key={c} className="pl-chip gray">{clip(c, 48)}</span>)}</div>
      {terms.length > 1 && <p className="ct-terms"><Search size={13} /> Searched separately: {terms.map((t) => <span key={t.term} className={`pl-chip ${t.source === 'yours' ? 'mint' : 'lav'}`} title={t.source === 'yours' ? 'Your words' : t.source === 'model' ? 'Suggested by the model' : 'Industry synonym'}>{t.term}</span>)}</p>}
      <p className="ct-terms"><button className="pl-link" onClick={onSources}>See which sources answered</button></p>
      {reasons.size > 0 && <p className="ct-ruled"><X size={13} /> Ruled out: {[...reasons.entries()].sort((a, z) => z[1] - a[1]).slice(0, 3).map(([r, n]) => `${clip(r, 60)} (${n})`).join(' · ')}</p>}
    </div>
  </details>;
}

/* ───────── Main table ─────────
   One table for every funding type. Same Plan CRM look, laid out as a fixed grid
   (columns never drift): #, who, fit, stage, why, reach. Above it, the funnel shows
   how much work the system did: found → shortlisted (and ruled out) → ready. */
type Stage = { label: string; tone: 'mint' | 'sun' | 'lav' | 'sky' | 'gray' };
const isForecast = (l: Lead) => ['forecast', 'forecasted'].includes(l.status) || l.registry?.status === 'forecasted';
const estimatedDue = (l: Lead) => l.grantPlan?.estimatedDeadline || l.estimatedDeadline || l.registry?.forecastClose || null;
function stageOf(l: Lead, grantsOnly: boolean): Stage {
  if (l.bucket === 'discarded') return { label: 'Ruled out', tone: 'gray' };
  if (grantsOnly) {
    if (isForecast(l)) return { label: 'Watch', tone: 'sky' };
    const d = l.grantPlan?.decision;
    if (d === 'go' || d === 'conditional_go') return { label: 'Apply now', tone: 'mint' };
    if (d === 'watch') return { label: 'Watch', tone: 'sky' };
    if (d === 'no_go') return { label: 'Do not pursue', tone: 'gray' };
    return { label: 'Clarify first', tone: 'sun' };
  }
  return l.bucket === 'top' ? { label: 'Contact now', tone: 'mint' } : { label: 'Later', tone: 'lav' };
}
type View = 'all' | 'top' | 'radar' | 'out';

export function ContactsTable({ job, selectedId, onOpen }: { job: Job; selectedId: string | null; onOpen: (leadId: string) => void }) {
  const demo = isDemoJob(job);
  const grantsOnly = job.brief.fundingTypes.length === 1 && job.brief.fundingTypes[0] === 'grant';
  const [view, setView] = useState<View>('all');
  const shown = (l: Lead) => !notACall(l);
  const by = (b: string) => job.leads.filter((l) => (b === 'discarded' ? l.bucket === b || !shown(l) : l.bucket === b && shown(l)));
  const counts = { top: by('top').length, radar: by('radar').length, out: by('discarded').length };
  const shortlisted = counts.top + counts.radar;
  const leads = useMemo(() => {
    const pick = view === 'all' ? job.leads.filter((l) => (l.bucket === 'top' || l.bucket === 'radar') && shown(l)) : by(view === 'out' ? 'discarded' : view);
    return [...pick].sort((a, z) => a.rank - z.rank);
  }, [job, view]);
  const noun = grantsOnly ? 'opportunities' : 'candidates';
  const tabs: [View, string, number][] = [
    ['all', 'All', shortlisted],
    ['top', grantsOnly ? 'Act now' : 'Contact now', counts.top],
    ['radar', grantsOnly ? 'Watch' : 'Later', counts.radar],
    ['out', 'Ruled out', counts.out],
  ];
  return <section className="pl-card flush ct-card">
    <div className="ct-funnel" aria-label="What the system did">
      <div><b>{job.leads.length}</b><span>{noun} found</span></div>
      <div><b>{shortlisted}</b><span>shortlisted · {counts.out} ruled out</span></div>
      <div className="hot"><b>{counts.top}</b><span>{grantsOnly ? 'ready to review' : 'ready to contact'}</span></div>
    </div>
    <div className="ct-tabs" role="tablist" aria-label="Which list">
      {tabs.map(([k, label, n]) => <button key={k} role="tab" aria-selected={view === k} className={view === k ? 'on' : ''} onClick={() => setView(k)}>{label}<span>{n}</span></button>)}
    </div>
    <ul className="ct-list">{leads.map((l, i) => {
      const p = bestPath(l);
      const w = warmPlanOf(l);
      const isOpen = selectedId === l.id;
      const name = grantsOnly ? l.title : (l.person || l.org);
      const found = l.evidence.filter((e) => e.verified);
      const st = stageOf(l, grantsOnly);
      const out = l.bucket === 'discarded' || !shown(l);
      const sub = out ? null
        : grantsOnly ? `${l.grantPlan?.checklist.filter((x) => x.done).length || 0}/${l.grantPlan?.checklist.length || 5} checks`
        : p ? (p.introducer ? `Ask ${p.introducer}` : 'You know them') : w ? warmShort(w) : null;
      const why = !shown(l) && l.bucket !== 'discarded' ? NOT_A_CALL_REASON : out ? (l.discard || 'Not enough evidence') : grantsOnly ? (l.grantPlan?.nextAction || l.grantPlan?.label || reasonFor(l)) : reasonFor(l);
      const estimate = estimatedDue(l);
      const reach = grantsOnly
        ? isForecast(l)
          ? { icon: null, main: estimate ? `Estimated due date: ${estimate}` : 'Forecast', small: l.grantPlan?.estimatedDatePassed ? 'Estimated date already passed' : 'Not open yet' }
          : { icon: null, main: l.deadline || 'No deadline published', small: l.daysToDeadline != null ? `${l.daysToDeadline} days left` : l.status }
        : l.contact ? { icon: l.contact.type === 'email' ? <Mail size={13} /> : <ExternalLink size={13} />, main: l.contact.type === 'email' ? 'Email' : l.contact.type === 'linkedin' ? 'LinkedIn' : 'Website', small: found.length ? `Found · ${found.length}` : 'Our read' }
        : { icon: null, main: 'Not public', small: 'Ask via intro' };
      const C = 2 * Math.PI * 17;
      return <li key={l.id}><button type="button" className={`ct-item ${isOpen ? 'open' : ''} ${out ? 'out' : ''}`} aria-pressed={isOpen} onClick={() => onOpen(l.id)}>
        <span className="ct-rank">{String(i + 1).padStart(2, '0')}</span>
        <span className="ct-main">
          <i className={`pl-av ${TINTS[i % 4]}`}>{initialsOf(name)}</i>
          <span className="ct-name"><b title={name}>{name}</b><small>{grantsOnly ? `${l.org}${l.grantPlan?.programNumber ? ` · ${l.grantPlan.programNumber}` : ''}` : l.person ? `${l.role || 'Role to confirm'} · ${l.org}` : clip(l.title, 48)}</small></span>
        </span>
        <span className="ct-why"><span title={why}>{why}</span></span>
        <span className="ct-stage"><span className={`pl-chip ${st.tone}`}>{st.label}</span>{sub && <small>{sub}</small>}</span>
        <span className="ct-reach">{reach.icon}<span><b>{reach.main}</b><small>{reach.small}</small></span></span>
        <svg className={`ct-ring ${l.score >= 60 ? 'hi' : ''}`} viewBox="0 0 40 40" role="img" aria-label={`Fit ${l.score} out of 100`}><circle cx="20" cy="20" r="17" className="bg" /><circle cx="20" cy="20" r="17" className="fg" strokeDasharray={`${(Math.max(2, Math.min(100, l.score)) / 100) * C} ${C}`} transform="rotate(-90 20 20)" /><text x="20" y="24.5" textAnchor="middle">{l.score}</text></svg>
        <ChevronRight size={16} className="ct-go" aria-hidden />
      </button></li>;
    })}</ul>
    {!leads.length && <p className="pl-empty ct-empty"><Search size={14} /> {view === 'out' ? 'Nothing was ruled out.' : view === 'radar' ? 'Nothing on the radar.' : (grantsOnly ? 'No actionable opportunity yet. Widen topic and opportunity type.' : 'No one to contact yet. Widen sector or geography.')}</p>}
    <p className="ct-foot"><UserRound size={13} /> {grantsOnly ? 'Ranked by topic fit, eligibility evidence, deadline and program terms. The score is not a probability of winning.' : 'Ranked by fit, evidence and how warm the route is. The score orders the list; it is not a probability of investment.'}</p>
  </section>;
}
