/* Candidate snapshot inside the Outreach pipeline: the analysis done on this person or organization,
   short and visual (patterns from Dribbble CRM/ATS scorecards: an overall score ring, a few stat tiles,
   a per-factor breakdown and 2–3 lines of "why"). Everything comes from the run and the AI dossier;
   nothing new is inferred here. */
import { AlertTriangle, CheckCircle2, Mail, Route, Sparkles, Timer } from 'lucide-react';
import type { DossierResult } from '../analysisApi';
import type { Lead } from '../researchApi';

const FACTOR: Record<string, string> = { fit: 'Topic fit', type: 'Funding type', timing: 'Timing', path: 'Warm path', contact: 'Contact', amountFit: 'Amount' };
const FIT: Record<string, string> = { alto: 'High fit', medio: 'Medium fit', bajo: 'Low fit', descartar: 'Discard', incierto: 'Unclear fit' };
const ROLE: Record<string, string> = { decisor: 'Decides', influye: 'Influences', conector: 'Connector', no_relevante: 'Not relevant', incierto: 'Unclear role' };
const ROUTE: Record<string, string> = { intro_doble_opt_in: 'Double opt-in intro', pedido_de_consejo: 'Ask for advice', evento: 'Meet at an event', update_en_frio: 'Warm up with updates', via_conector_interno: 'Via internal connector', no_contactar_aun: "Don't contact yet", descartar: 'Discard' };
const plain = (s: string) => String(s || '').replace(/\*\*/g, '').trim();
const clip = (s: string, n: number) => { const t = plain(s); return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t; };
const norm = (s: string | null | undefined) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Finds the run candidate behind a pipeline item: exact lead key first, then person, then organization. */
export function findLead(leads: Lead[] | undefined, { leadKey, person, org }: { leadKey?: string | null; person?: string | null; org?: string | null }): Lead | null {
  if (!leads?.length) return null;
  const byKey = leadKey ? leads.find((l) => l.key === leadKey || l.id === leadKey) : null;
  if (byKey) return byKey;
  const p = norm(person); const o = norm(org);
  return (p && leads.find((l) => norm(l.person) === p)) || (!p && o ? leads.find((l) => !l.person && norm(l.org) === o) : null) || (o ? leads.find((l) => norm(l.org) === o) : null) || null;
}
export function findDossier(dossiers: DossierResult[] | undefined, lead: Lead | null, person?: string | null): DossierResult | null {
  if (!dossiers?.length) return null;
  const key = lead?.key;
  return dossiers.find((d) => key && d.leadKey === key) || dossiers.find((d) => norm(d.person) === norm(person || lead?.person || lead?.org)) || null;
}

function Ring({ value, label }: { value: number; label: string }) {
  const r = 26; const c = 2 * Math.PI * r; const v = Math.max(0, Math.min(100, Math.round(value)));
  return <svg className="ci-ring" viewBox="0 0 64 64" role="img" aria-label={`${label}: ${v} of 100`}>
    <circle cx="32" cy="32" r={r} className="ci-ring-bg" />
    <circle cx="32" cy="32" r={r} className="ci-ring-fg" strokeDasharray={`${(v / 100) * c} ${c}`} transform="rotate(-90 32 32)" />
    <text x="32" y="36" textAnchor="middle" className="ci-ring-t">{v}</text>
    <title>{`${label}: ${v}/100`}</title>
  </svg>;
}

export function CandidateInsight({ lead, dossier }: { lead: Lead | null; dossier: DossierResult | null }) {
  if (!lead && !dossier) return <section className="ci ci-empty"><Sparkles size={14} /> No analysis for this item yet. Run an evaluation (and the AI analysis) to see its scorecard here.</section>;
  const d = dossier?.dossier;
  const score = lead ? lead.score : 0;
  const path = Math.max(0, ...(lead?.paths || []).map((p) => p.strength), ...(d?.warm_paths || []).map((p) => p.strength));
  const email = lead?.contact?.type === 'email' ? lead.contact : null;
  const timing = lead?.deadline ? (lead.daysToDeadline != null ? (lead.daysToDeadline < 0 ? 'Closed' : `${lead.daysToDeadline} days left`) : lead.deadline) : lead?.status === 'open' ? 'Open' : lead?.status === 'closed' ? 'Closed' : 'No deadline';
  const verdict = lead ? (lead.bucket === 'top' ? { t: 'Contact now', tone: 'mint' } : lead.bucket === 'radar' ? { t: 'Later', tone: 'sun' } : { t: 'Ruled out', tone: 'rose' }) : null;
  const why = [...(d?.fit.reasons || []).map((r) => r.text), ...(lead?.why || [])].map((w) => clip(w, 150)).filter(Boolean).slice(0, 3);
  const watch = clip(d?.risks?.[0] || lead?.discard || (lead?.missing || []).find((m) => !/geographic eligibility/i.test(m)) || '', 140);
  const next = d ? `${ROUTE[d.best_route.type] || d.best_route.type}${d.best_route.via ? ` via ${d.best_route.via}` : ''}` : lead?.warmPlan ? clip(`${lead.warmPlan.label}${lead.warmPlan.via ? ` via ${lead.warmPlan.via}` : ''}`, 120) : '';
  const bars = (lead?.breakdown || []).filter((b) => b.max > 0);
  const fitBar = bars.find((b) => b.factor === 'fit');
  const fitPct = lead && typeof lead.fit === 'number' ? Math.round(lead.fit * 100) : fitBar ? Math.round((100 * fitBar.points) / fitBar.max) : null;
  const sources = new Set((lead?.evidence || []).map((e) => { try { return new URL(e.url).hostname; } catch { return e.source; } })).size;
  const jev = lead?.jev;

  return <section className="ci" aria-label="Candidate analysis">
    <div className="ci-head">
      {lead && <Ring value={score} label="Overall score" />}
      <div className="ci-verdict">
        <div className="ci-chips">
          {verdict && <span className={`pl-chip ${verdict.tone}`}>{verdict.t}</span>}
          {d && <span className={`pl-chip ${d.fit.verdict === 'alto' ? 'mint' : d.fit.verdict === 'medio' ? 'sun' : 'gray'}`}>{FIT[d.fit.verdict] || d.fit.verdict}</span>}
          {d && <span className="pl-chip lav">{ROLE[d.role.kind] || d.role.kind}</span>}
          {jev && <span className="pl-chip gray" title={`Action confidence ${Math.round(jev.actionConfidence * 100)}% · evidence ${Math.round(jev.evidenceSufficient * 100)}%`}>{jev.provider || 'Jev'}: {jev.action === 'prioritize' ? 'prioritize' : jev.action === 'discard' ? 'review' : 'dig deeper'}</span>}
        </div>
        {d?.summary ? <p className="ci-sum">{clip(d.summary, 220)}</p> : lead && <p className="ci-sum">{clip(lead.title, 160)}</p>}
      </div>
    </div>

    <div className="ci-tiles">
      <div title="How well the evidence matches your topic"><span>Fit</span><b>{fitPct !== null ? `${fitPct}%` : d ? FIT[d.fit.verdict] : '—'}</b></div>
      <div title="Deadline or status"><span><Timer size={11} /> Timing</span><b>{timing}</b></div>
      <div title="Strongest documented path from your network"><span><Route size={11} /> Warm path</span><b>{path ? `${Math.round(path * 100)}%` : 'To build'}</b></div>
      <div title={email?.provenance || 'No email yet'}><span><Mail size={11} /> Contact</span><b className={email ? 'ok' : ''}>{email ? 'Email' : lead?.contact ? 'Web only' : 'None'}</b></div>
    </div>

    {bars.length > 0 && <div className="ci-bars" role="list" aria-label="Score breakdown">
      {bars.map((b) => { const pct = Math.round((100 * b.points) / b.max); return <div key={b.factor} role="listitem" className="ci-bar" title={`${FACTOR[b.factor] || b.factor}: ${b.points} of ${b.max} points`}>
        <span>{FACTOR[b.factor] || b.factor}</span><i><em style={{ width: `${Math.max(pct, pct ? 3 : 0)}%` }} /></i><b>{b.points}<small>/{b.max}</small></b>
      </div>; })}
    </div>}

    {why.length > 0 && <ul className="ci-why">{why.map((w, i) => <li key={i}><CheckCircle2 size={13} /><span>{w}</span></li>)}</ul>}
    {watch && <p className="ci-watch"><AlertTriangle size={13} /><span>{watch}</span></p>}
    <div className="ci-foot">
      {next && <span><b>Next move</b> {next}</span>}
      <span className="ci-src">{sources} source{sources === 1 ? '' : 's'}{email ? ` · ${clip(email.value, 40)}` : ''}</span>
    </div>
  </section>;
}
