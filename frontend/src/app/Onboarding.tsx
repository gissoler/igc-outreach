/* ─────────────────────────────────────────────────────────────────────────────
   OnboardingWorkspace: configuración navegable (no un step form). Seis secciones a
   las que se entra y se sale libremente; cada cambio se guarda en el prerregistro
   del servidor (PUT /intake/field) y se muestra el estado del guardado.
   ───────────────────────────────────────────────────────────────────────────── */
import { AlertCircle, Sparkles, MessageSquareText, Pencil, Building2, Check, CheckCircle2, ChevronLeft, ChevronRight, CircleDot, CloudOff, FileText, FlaskConical, Link2, ListChecks, LoaderCircle, Network, Paperclip, Play, Save, ShieldCheck, Target, Trash2, Upload, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { accountApi, ApiError, intakeApi, type AccountSession, type AccountSource, type IntakeState, type NetworkGraphData } from '../accountApi';
import { AgentChat } from '../IntakeAgent';
import { ACCEPT, extractText } from '../docText';
import type { Job } from '../researchApi';
import { fmtDateTime, fmtInt, fmtUsd, fmtTime } from './format';
import { MODE_LABEL } from './model';
import { NetworkGraph } from './NetworkGraph';
import { prefsOf, type Profile, type ResearchPrefs } from './profile';
import { PageHeader } from './Shell';
import { EmptyState, ErrorState, Info, SkeletonState } from './ui';

export type SectionId = 'asistente' | 'empresa' | 'producto' | 'objetivo' | 'evidencia' | 'red' | 'revision';
type Kind = 'text' | 'long' | 'url' | 'amount' | 'tags' | 'lines' | 'objectives' | 'select';
type FieldDef = { path: string; label: string; kind: Kind; required?: boolean; placeholder?: string; help?: string; options?: [string, string][]; max?: number };
const OBJECTIVES: [string, string][] = [['investment', 'Investment (VC, angels)'], ['partnering', 'Partnering / licensing'], ['grant', 'Non-dilutive grants'], ['sponsorship', 'Sponsorship'], ['debt', 'Debt']];
const MATURITY: [string, string][] = [['idea', 'Idea'], ['prototype', 'Prototype or pilot'], ['preclinical', 'Preclinical'], ['clinical_phase_1', 'Clinical phase 1'], ['clinical_phase_2', 'Clinical phase 2'], ['clinical_phase_3', 'Clinical phase 3'], ['marketed', 'On the market'], ['other', 'Other']];
const RELATIONS: [string, string][] = [['same', 'It\'s my own company'], ['subsidiary', 'Subsidiary'], ['spinout', 'Spin-off'], ['sponsored', 'Project we sponsor'], ['portfolio', 'Portfolio company'], ['client', 'Client'], ['other', 'Other']];
const ENTITY_TYPES: [string, string][] = [['for_profit', 'For-profit company'], ['nonprofit', 'Nonprofit'], ['academic', 'University or research institute']];
const ROUNDS: [string, string][] = [['pre-seed', 'Pre-seed'], ['seed', 'Seed'], ['series-a', 'Series A'], ['series-b', 'Series B'], ['series-c', 'Series C'], ['growth', 'Growth / late stage'], ['public', 'Public company (offering, PIPE)']];
const APPLICANT_ROLES: [string, string][] = [['direct', 'Apply directly'], ['subcontractor', 'Subcontractor or vendor'], ['either', 'Either route']];

const F: Record<string, FieldDef> = {
  'company.name': { path: 'company.name', label: 'Company or project to fund', kind: 'text', required: true, placeholder: 'e.g. Mentiva', help: 'Excluded from results; heads every message.', max: 220 },
  'organization.name': { path: 'organization.name', label: 'Organization you represent', kind: 'text', placeholder: 'Only if different, e.g. IGC Pharma', help: 'Its team and relationships feed the warm paths.', max: 220 },
  'company.relation': { path: 'company.relation', label: 'Relationship', kind: 'select', options: RELATIONS, help: 'How the company is introduced in drafts.' },
  'company.entity_type': { path: 'company.entity_type', label: 'Type of organization', kind: 'select', options: ENTITY_TYPES, help: 'Grant calls often accept only one type. If empty, it stays unknown and cannot be used to claim eligibility.' },
  'company.country': { path: 'company.country', label: 'Country', kind: 'text', placeholder: 'United States, Colombia…', help: 'Where the applicant is based. National programs depend on it.', max: 60 },
  'company.state': { path: 'company.state', label: 'State or region', kind: 'text', placeholder: 'California, Antioquia…', help: 'State and regional grant programs only fund local applicants; we also read the official portals of that state.', max: 80 },
  'funding.applicant_role': { path: 'funding.applicant_role', label: 'How you can participate', kind: 'select', options: APPLICANT_ROLES, help: 'Keeps direct applications separate from subcontractor, vendor and partner routes.' },
  'project.target_population': { path: 'project.target_population', label: 'Target population', kind: 'long', placeholder: 'e.g. older adults in rural counties at risk of dementia', max: 600 },
  'funding.search_terms': { path: 'funding.search_terms', label: 'Programs and exact search terms', kind: 'tags', placeholder: 'RHTP, rural health, dementia screening', help: 'These words are preserved in the first searches instead of being replaced by broad sectors.' },
  'company.city': { path: 'company.city', label: 'City', kind: 'text', placeholder: 'Boston, Medellín…', max: 80 },
  'founder.title': { path: 'founder.title', label: 'Your role', kind: 'text', placeholder: 'CEO, founder, CSO…', max: 220 },
  'company.website': { path: 'company.website', label: 'Website', kind: 'url', placeholder: 'https://…', help: 'Public source to verify facts.' },
  'product.name': { path: 'product.name', label: 'Product or project', kind: 'text', required: true, placeholder: 'e.g. IGC-AD1 or AHA', max: 220 },
  'product.one_liner': { path: 'product.one_liner', label: 'What it does, in one sentence', kind: 'text', required: true, placeholder: 'e.g. Predicts agitation episodes in dementia 40 minutes early.', help: 'Used to match topics in the evidence.', max: 220 },
  'product.description': { path: 'product.description', label: 'Description', kind: 'long', placeholder: 'The problem, who it is for, and any proof so far (users, pilots, revenue).', max: 1500 },
  'product.maturity': { path: 'product.maturity', label: 'Stage', kind: 'select', options: MATURITY, help: 'Changes which sources apply; required for an investment search, optional for grants.' },
  'industry.sectors': { path: 'industry.sectors', label: 'Sector', kind: 'tags', required: true, placeholder: 'e.g. neurology, dementia, digital health', help: 'Each term is a fit keyword: 35% of the score in strategic mode, 25% in financial.' },
  'funding.objectives': { path: 'funding.objectives', label: 'What you\'re looking for', kind: 'objectives', required: true, options: OBJECTIVES, help: 'Decides which sources run and the funding-type factor.' },
  'funding.round': { path: 'funding.round', label: 'Round', kind: 'select', options: ROUNDS },
  'funding.amount_usd': { path: 'funding.amount_usd', label: 'Amount (USD)', kind: 'amount', placeholder: '2500000', help: 'Compared against published ceilings.' },
  'geography': { path: 'geography', label: 'Geography', kind: 'tags', required: true, placeholder: 'US, Europe, LATAM…', help: 'Filters calls; flagged as eligibility to confirm.' },
  'funding.timeline': { path: 'funding.timeline', label: 'Timeline', kind: 'text', placeholder: 'e.g. 6 months', max: 220 },
  'funding.apply_window': { path: 'funding.apply_window', label: 'When you can apply', kind: 'text', placeholder: 'e.g. November to December 2026', help: 'Only calls that close inside these dates are kept; the rest go to the watch list. Dates like 2026-11-01 to 2026-12-31 also work.', max: 100 },
  'funding.use_of_funds': { path: 'funding.use_of_funds', label: 'Use of funds', kind: 'text', placeholder: 'e.g. clinical validation and certification', max: 220 },
  'company.traction': { path: 'company.traction', label: 'Proof it works so far', kind: 'long', placeholder: 'For example: 200 users, 3 pilots, $10k revenue, a signed letter of intent or study results.', help: 'Anything that shows people want this or that it works. Say "none yet" if you have nothing.', max: 600 },
  'product.differentiation': { path: 'product.differentiation', label: 'Why you win', kind: 'long', placeholder: 'What you do that alternatives can\'t.', max: 600 },
  'product.business_model': { path: 'product.business_model', label: 'Business model', kind: 'text', placeholder: 'Who pays, how much, how you reach them.', max: 600 },
  'company.team': { path: 'company.team', label: 'Team', kind: 'long', placeholder: 'Founders and why you are the right team.', max: 600 },
  'competitors': { path: 'competitors', label: 'Competitors', kind: 'tags', placeholder: 'Organizations to avoid', help: 'Excluded and flagged as conflict risk.' },
  'criteria': { path: 'criteria', label: 'Criteria', kind: 'lines', placeholder: 'One per line: thesis, ticket, stage…', help: 'Shown as criteria to validate per candidate.' },
  'constraints': { path: 'constraints', label: 'Constraints', kind: 'lines', placeholder: 'One per line: what to avoid', help: 'Included in the plan and warnings.' },
};
type SectionDef = { id: SectionId; label: string; icon: ReactNode; why: string; impact: string; fields: string[]; advanced?: string[] };
export const SECTIONS: SectionDef[] = [
  { id: 'asistente', label: 'AI assistant', icon: <Sparkles size={16} />, why: 'Tell it in your own words — faster than a form.', impact: '', fields: [] },
  { id: 'empresa', label: 'Company', icon: <Building2 size={16} />, why: 'Who\'s looking, and for whom.', impact: '', fields: ['company.name', 'organization.name', 'company.relation', 'company.entity_type', 'company.country', 'company.state', 'company.city', 'founder.title', 'company.website'] },
  { id: 'producto', label: 'Product', icon: <FlaskConical size={16} />, why: 'The terms the engine looks for in evidence.', impact: '', fields: ['product.name', 'product.one_liner', 'product.description', 'product.maturity', 'industry.sectors'], advanced: ['company.traction', 'product.differentiation', 'product.business_model', 'company.team'] },
  { id: 'objetivo', label: 'Goal', icon: <Target size={16} />, why: 'Decides which sources run and how funding type is scored.', impact: '', fields: ['funding.objectives', 'funding.applicant_role', 'project.target_population', 'funding.search_terms', 'funding.round', 'funding.amount_usd', 'geography', 'funding.timeline', 'funding.apply_window', 'funding.use_of_funds'], advanced: ['competitors', 'criteria', 'constraints'] },
  { id: 'evidencia', label: 'Documents', icon: <FileText size={16} />, why: 'Your documents fill the profile with quotes.', impact: '', fields: [] },
  { id: 'red', label: 'Network', icon: <Network size={16} />, why: 'The best meetings come through someone you already know.', impact: '', fields: [] },
  { id: 'revision', label: 'Review', icon: <ListChecks size={16} />, why: 'See exactly what will be used before anything runs.', impact: '', fields: [] },
];
const REQUIRED = Object.values(F).filter((f) => f.required).map((f) => f.path);
const BLOCKING = ['company.name', 'product.name', 'product.one_liner', 'funding.objectives'];
const asList = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);
const errorText = (e: unknown) => (e instanceof Error ? e.message : 'Couldn\'t save.');
const draftKey = (uid: string, path: string) => `igc-draft:${uid}:${path}`;
const readDraft = (uid: string, path: string) => { try { return localStorage.getItem(draftKey(uid, path)); } catch { return null; } };
const writeDraft = (uid: string, path: string, v: string | null) => { try { if (v == null) localStorage.removeItem(draftKey(uid, path)); else localStorage.setItem(draftKey(uid, path), v); } catch { /* sin almacenamiento */ } };

function validate(def: FieldDef, raw: string): string | null {
  const v = raw.trim();
  if (def.required && !v) return 'Required.';
  if (def.max && v.length > def.max) return `Max ${def.max} characters (you have ${v.length}).`;
  if (def.kind === 'url' && v) { try { const u = new URL(v); if (!/^https?:$/.test(u.protocol)) return 'Use an http(s) address.'; } catch { return 'Enter a full URL, e.g. https://company.com'; } }
  if (def.kind === 'amount' && v) { const n = Number(v.replace(/[^\d.]/g, '')); if (!Number.isFinite(n) || n <= 0) return 'Enter a positive USD amount, no separators.'; if (n >= 1e12) return 'Must be under a trillion.'; }
  if (def.path === 'product.one_liner' && v && v.length < 15) return 'Too short: add what it does and for whom.';
  return null;
}

/* ───────── Autosave ───────── */
export type SaveState = { status: 'idle' | 'saving' | 'saved' | 'error'; at: string | null; error: string | null; pending: number };
export function AutosaveStatus({ state, onRetry }: { state: SaveState; onRetry?: () => void }) {
  return <span className={`as ${state.status}`} role="status" aria-live="polite">
    {state.status === 'saving' ? <><LoaderCircle size={13} className="spin" /> Saving…</> : state.status === 'error' ? <><CloudOff size={13} /> Save failed{onRetry && <button className="x-link-btn" onClick={onRetry}>Retry</button>}</> : state.status === 'saved' ? <><Check size={13} /> Saved · {fmtTime(state.at)}</> : <><Check size={13} /> Saved</>}
  </span>;
}

function FieldEditor({ def, intake, uid, onSave, fieldError }: { def: FieldDef; intake: IntakeState; uid: string; onSave: (path: string, value: unknown) => Promise<boolean>; fieldError?: string | null }) {
  const f = intake.fields[def.path];
  const server = f?.value;
  const serverText = def.kind === 'lines' ? asList(server).join('\n') : def.kind === 'tags' || def.kind === 'objectives' ? '' : server == null ? '' : String(server);
  const [text, setText] = useState(() => readDraft(uid, def.path) ?? serverText);
  const [touched, setTouched] = useState(false);
  const [tag, setTag] = useState('');
  const recovered = readDraft(uid, def.path);
  useEffect(() => { if (readDraft(uid, def.path) == null) setText(serverText); }, [serverText, uid, def.path]);
  const err = touched ? validate(def, text) : null;
  const commit = async () => {
    setTouched(true);
    if (validate(def, text) && text.trim()) return;
    if (text.trim() === serverText.trim()) { writeDraft(uid, def.path, null); return; }
    const value = def.kind === 'lines' ? text.split('\n').map((x) => x.trim()).filter(Boolean) : def.kind === 'amount' ? (text.trim() ? Number(text.replace(/[^\d.]/g, '')) : null) : text.trim() || null;
    if (await onSave(def.path, value)) writeDraft(uid, def.path, null);
  };
  const id = `f-${def.path.replace('.', '-')}`;
  const origin = f ? (f.origin === 'user' ? 'edited by you' : f.origin === 'profile' ? 'from your profile' : f.origin.startsWith('document:') ? `from ${f.origin.slice(9)}` : f.confidence === 'inferred' ? 'inferred · review' : 'from chat') : null;
  const label = <span className="of-label"><label htmlFor={id}>{def.label}</label>{def.required && <b className="of-req" aria-label="required">*</b>}{origin && <em className={`of-origin ${f?.confidence}`} title={f?.quote ? `«${f.quote}»` : undefined}>{origin}</em>}{def.help && <Info label={`Why: ${def.label}`}>{def.help}</Info>}</span>;
  const message = fieldError || err;
  let control: ReactNode;
  if (def.kind === 'objectives') {
    const on = asList(server);
    control = <div className="of-chips" role="group" aria-labelledby={id} id={id}>{def.options!.map(([v, l]) => { const active = on.includes(v); return <button key={v} type="button" aria-pressed={active} className={active ? 'on' : ''} onClick={() => void onSave(def.path, active ? on.filter((x) => x !== v) : [...on, v])}>{active ? <Check size={13} /> : <CircleDot size={13} />}{l}</button>; })}</div>;
  } else if (def.kind === 'select') {
    control = <select id={id} value={String(server ?? '')} onChange={(e) => void onSave(def.path, e.target.value || null)}><option value="">Not set</option>{def.options!.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>;
  } else if (def.kind === 'tags') {
    const values = asList(server);
    const push = () => { const items = tag.split(',').map((x) => x.trim()).filter(Boolean); if (items.length) void onSave(def.path, [...values, ...items]); setTag(''); };
    control = <div className={`of-tags ${def.required && !values.length ? 'empty' : ''}`}>{values.map((t) => <span key={t}>{t}<button type="button" onClick={() => void onSave(def.path, values.filter((x) => x !== t))} aria-label={`Remove ${t}`}><X size={11} /></button></span>)}<input id={id} value={tag} placeholder={values.length ? 'Add and press Enter' : def.placeholder} onChange={(e) => setTag(e.target.value)} onBlur={push} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); push(); } }} /></div>;
  } else if (def.kind === 'long' || def.kind === 'lines') {
    control = <textarea id={id} rows={def.kind === 'long' ? 4 : 3} value={text} placeholder={def.placeholder} aria-invalid={!!message} onChange={(e) => { setText(e.target.value); writeDraft(uid, def.path, e.target.value); }} onBlur={() => void commit()} />;
  } else {
    control = <input id={id} type="text" inputMode={def.kind === 'amount' ? 'numeric' : undefined} value={text} placeholder={def.placeholder} aria-invalid={!!message} onChange={(e) => { setText(e.target.value); writeDraft(uid, def.path, e.target.value); }} onBlur={() => void commit()} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />;
  }
  const missing = def.required && !f;
  return <div className={`of ${def.kind === 'long' || def.kind === 'objectives' || def.kind === 'lines' ? 'wide' : ''} ${message ? 'invalid' : ''} ${missing ? 'missing' : ''}`} id={`field-${def.path}`}>
    {label}{control}
    {def.kind === 'amount' && text && !err && <small className="of-hint">{fmtUsd(Number(text.replace(/[^\d.]/g, '')))}</small>}
    {message ? <small className="of-err" role="alert"><AlertCircle size={12} /> {message}</small> : missing ? <small className="of-hint">Required</small> : null}
    {recovered != null && recovered !== serverText && !touched && <small className="of-recover">Unsaved draft recovered. <button className="x-link-btn" onClick={() => void commit()}>Save</button><button className="x-link-btn" onClick={() => { writeDraft(uid, def.path, null); setText(serverText); }}>Discard</button></small>}
  </div>;
}

/* ───────── Secciones especiales ───────── */
function EvidenceSection({ intake, setIntake, onError }: { intake: IntakeState; setIntake: (s: IntakeState) => void; onError: (e: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [changed, setChanged] = useState<string[]>([]);
  const [chat, setChat] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const counts = { source: 0, inferred: 0, user: 0 } as Record<string, number>;
  for (const f of Object.values(intake.fields)) counts[f.confidence] = (counts[f.confidence] || 0) + 1;
  const inferred = Object.entries(intake.fields).filter(([, f]) => f.confidence === 'inferred');
  async function upload(files: FileList) {
    setBusy(true); onError('');
    try {
      const docs = [];
      for (const file of [...files].slice(0, 6)) { const r = await extractText(file); docs.push({ name: file.name, type: file.type, size: file.size, text: r.text, pages: r.pages }); }
      const next = await intakeApi.message('', docs);
      setIntake(next); setChanged(next.changed || []);
    } catch (e) { onError(errorText(e)); } finally { setBusy(false); }
  }
  return <div className="ow-evidence">
    <div className="ow-prov"><div><b>{counts.source}</b><span>quoted from source</span></div><div><b>{counts.inferred}</b><span>inferred · review</span></div><div><b>{counts.user}</b><span>entered by you</span></div></div>
    {inferred.length > 0 && <div className="x-callout warn"><b>Review {inferred.length} inferred fields</b><span>{inferred.map(([p]) => F[p]?.label || p).join(' · ')}.</span></div>}
    <div className="ow-drop" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files.length) void upload(e.dataTransfer.files); }}>
      <Upload size={20} aria-hidden="true" /><div><b>Add a pitch deck, one-pager, Word or Excel</b><span>Text is extracted in your browser.</span></div>
      <button className="x-btn" disabled={busy} onClick={() => input.current?.click()}>{busy ? <LoaderCircle size={15} className="spin" /> : <Paperclip size={15} />} {busy ? 'Reading…' : 'Choose files'}</button>
      <input ref={input} type="file" multiple hidden accept={ACCEPT} onChange={(e) => { if (e.target.files?.length) void upload(e.target.files); e.target.value = ''; }} />
    </div>
    {changed.length > 0 && <p className="x-note" role="status"><CheckCircle2 size={14} /> Updated {changed.length} fields: {changed.map((p) => F[p]?.label || p).join(', ')}.</p>}
    <h3 className="x-h3">Documents ({intake.documents.length})</h3>
    {intake.documents.length ? <ul className="ow-docs">{intake.documents.map((d) => <li key={d.id}><FileText size={15} aria-hidden="true" /><span><b>{d.name}</b><small>{fmtInt(d.chars)} characters{d.pages ? ` · ${d.pages} pages` : ''} · {fmtDateTime(d.at)}</small><q>{d.preview}</q></span><button className="x-icon-btn" aria-label={`Remove ${d.name} and its fields`} onClick={() => void intakeApi.removeDocument(d.id).then(setIntake).catch((e) => onError(errorText(e)))}><Trash2 size={14} /></button></li>)}</ul>
      : <EmptyState icon={<FileText size={20} />} title="No documents yet">Optional.</EmptyState>}
    <details className="ow-chat" open={chat} onToggle={(e) => setChat((e.target as HTMLDetailsElement).open)}><summary>Tell the assistant instead <span className="x-muted">({intake.messages.length} messages · {intake.model.configured ? 'AI on' : 'basic mode'})</span></summary>
      {chat && <AgentChat intake={intake} onChange={setIntake} onReview={() => setChat(false)} onError={onError} title="Tell the assistant" description="Write freely; you approve every field." reviewLabel="Done" reviewRequiresConversation={false} />}
    </details>
  </div>;
}

function NetworkSection({ session, profile, ensureProfile, prefs, setPrefs, onError }: { session: AccountSession; profile: Profile | null; ensureProfile: () => Promise<Profile | null>; prefs: ResearchPrefs; setPrefs: (p: Partial<ResearchPrefs>) => void; onError: (e: string) => void }) {
  const [sources, setSources] = useState<AccountSource[] | null>(null);
  const [graph, setGraph] = useState<NetworkGraphData | null>(null);
  const [linkedinReady, setLinkedinReady] = useState<boolean | null>(null);
  const [url, setUrl] = useState(profile?.founder.linkedin_url || '');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [origin, setOrigin] = useState('linkedin');
  const [howto, setHowto] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [manualName, setManualName] = useState(profile?.founder.name || session.profile?.founder.name || session.user.name || '');
  const [manualRole, setManualRole] = useState(profile?.founder.title || session.profile?.founder.title || '');
  const [manualOrg, setManualOrg] = useState(profile?.founder.org || session.profile?.founder.org || '');
  const refresh = useCallback(() => {
    void accountApi.sources().then(setSources).catch(() => setSources([]));
    void accountApi.networkGraph().then(setGraph).catch(() => setGraph(null));
  }, []);
  useEffect(() => { refresh(); void accountApi.connectors().then((c) => setLinkedinReady(Boolean(c.linkedin?.configured))).catch(() => setLinkedinReady(false)); }, [refresh]);
  const run = async (key: string, fn: () => Promise<string>) => { setBusy(key); setMsg(''); onError(''); try { const p = await ensureProfile(); if (!p) { onError('Before connecting your network, add your company, product, one-liner and goal.'); return; } setMsg(await fn()); refresh(); } catch (e) { onError(errorText(e)); } finally { setBusy(null); } };
  const analyzeLinkedIn = async () => {
    setBusy('li'); setMsg(''); onError(''); setNotFound(false);
    try {
      const p = await ensureProfile();
      if (!p) { onError('Before connecting your network, add your company, product, one-liner and goal.'); return; }
      const r = await accountApi.connectLinkedIn(url);
      const fromSetup = /setup/i.test(r.linkedin.source || '');
      setMsg(fromSetup
        ? `Your LinkedIn isn't indexed publicly, so we used your setup name (${r.linkedin.name}): ${r.interactions.count} people who appear with you online.`
        : `${r.linkedin.name || 'Profile'} verified: ${r.interactions.count} people who appear with you online.`);
      refresh();
    } catch (e) {
      if ((e instanceof ApiError && e.code === 'linkedin_not_found') || /find that profile publicly/i.test(e instanceof Error ? e.message : '')) setNotFound(true);
      else onError(errorText(e));
    } finally { setBusy(null); }
  };
  const saveManual = async () => {
    setBusy('li-manual'); setMsg(''); onError('');
    try {
      const p = await ensureProfile();
      if (!p) { onError('Before connecting your network, add your company, product, one-liner and goal.'); return; }
      const r = await accountApi.connectLinkedIn(url, { name: manualName.trim(), role: manualRole.trim(), organization: manualOrg.trim() });
      setNotFound(false);
      setMsg(`${r.linkedin.name || 'Profile'} saved: ${r.interactions.count} people who appear with you online.`);
      refresh();
    } catch (e) { onError(errorText(e)); } finally { setBusy(null); }
  };
  const ORIGINS: Record<string, { label: string; accept: string; steps: string[] }> = {
    linkedin: { label: 'My LinkedIn connections', accept: '.csv', steps: ['In LinkedIn, open Me → Settings & Privacy → Data privacy.', 'Choose "Get a copy of your data" and select only Connections.', 'LinkedIn emails you the file in minutes. Upload it as is.'] },
    gmail: { label: 'My Google / Gmail contacts', accept: '.csv', steps: ['Open contacts.google.com.', 'Click Export and choose Google CSV.', 'Upload the downloaded file.'] },
    outlook: { label: 'My Outlook contacts', accept: '.csv', steps: ['In Outlook, open People → Manage contacts → Export contacts.', 'Upload the downloaded file.'] },
    calendar: { label: 'My calendar (meetings)', accept: '.ics', steps: ['Google Calendar: Settings → Import & export → Export (unzip and use the .ics).', 'Outlook desktop: File → Save calendar.', 'We only use who you met, never meeting content.'] },
    hubspot: { label: 'My CRM (HubSpot)', accept: '.csv', steps: ['HubSpot: Contacts → Export view.', 'Upload the downloaded file.'] },
    apollo: { label: 'My Apollo list', accept: '.csv', steps: ['Apollo: select contacts → Export.', 'Upload the downloaded file.'] },
  };
  const importFile = (file: File) => run('file', async () => { const text = await file.text(); const r = await accountApi.importSource(origin, text, file.name); return `Done: ${fmtInt(r.count)} contacts added from ${file.name}.`; });
  const stub: Job = useMemo(() => ({ id: 'net', brief: { name: session.profile?.founder.name || session.user.name, role: session.profile?.founder.title || '', company: session.profile?.founder.org || '', product: '', description: '', industry: '', stage: 'other', geography: '', fundingTypes: ['investment'], amount: null, criteria: '', exclusions: '', event: '', minDays: 30, mode: 'strategic', dataMode: 'live', useTeam: false, useApify: false, excludeCompetitors: false, strictTypes: false }, mode: 'live', status: 'done', createdAt: new Date().toISOString(), events: [], leads: [], senderEvidence: [] }), [session]);
  const li = profile?.linkedin_interactions;
  const label: Record<string, string> = { linkedin: 'LinkedIn connections', linkedin_interactions: 'Your public LinkedIn activity', web_relations: 'People who appear with you online', linkedin_authenticated_graph: 'Verified LinkedIn connections', gmail: 'Google contacts', outlook: 'Outlook contacts', calendar: 'Calendar', hubspot: 'HubSpot', apollo: 'Apollo' };
  const o = ORIGINS[origin];
  return <div className="ow-net">
    <div className="ow-net-sum">
      <div><b>{graph ? fmtInt(graph.summary.people) : '—'}</b><span>people in your network</span></div>
      <div><b>{graph ? fmtInt(graph.summary.verified) : '—'}</b><span>confirmed relationships</span></div>
      <div><b>{graph ? fmtInt(graph.summary.public) : '—'}</b><span>public interactions</span></div>
      <div><b>{graph ? fmtInt(graph.summary.mutualPaths) : '—'}</b><span>mutual contacts with candidates</span></div>
    </div>
    <div className="ow-net-grid">
      <article className="ow-src"><header><Link2 size={16} /><b>1 · Your LinkedIn profile</b>{li?.status === 'ready' ? <span className="x-state ok">{li.count} people found</span> : <span className="x-state empty">Not analyzed</span>}</header>
        <p>Paste your profile link. We find people who appear with you on the public web. No password needed.</p>
        <div className="x-row"><input aria-label="Your LinkedIn profile link" value={url} onChange={(e) => { setUrl(e.target.value); setNotFound(false); }} placeholder="linkedin.com/in/your-name" /><button className="x-btn primary" disabled={!!busy || !url.trim() || linkedinReady === false} onClick={() => void analyzeLinkedIn()}>{busy === 'li' ? <LoaderCircle size={14} className="spin" /> : null} Analyze my LinkedIn</button></div>
        {linkedinReady === false && <small className="x-muted">Not enabled for your org yet. Upload contacts meanwhile.</small>}
        {li?.updatedAt && <small className="x-muted">Last run: {fmtDateTime(li.updatedAt)}. Takes up to 3 minutes; small cost.</small>}
        {notFound && <div className="x-callout warn"><b>We couldn't find your LinkedIn profile publicly.</b><span>Help us with your name and role below and we'll build your network from what you enter, instead of the public link.</span>
          <div className="ow-grid">
            <label className="x-field"><span>Your name</span><input aria-label="Your name" value={manualName} onChange={(e) => setManualName(e.target.value)} placeholder="e.g. Ada Lovelace" /></label>
            <label className="x-field"><span>Your role</span><input aria-label="Your role" value={manualRole} onChange={(e) => setManualRole(e.target.value)} placeholder="e.g. CEO, founder" /></label>
            <label className="x-field"><span>Organization</span><input aria-label="Your organization" value={manualOrg} onChange={(e) => setManualOrg(e.target.value)} placeholder="e.g. Mentiva" /></label>
          </div>
          <div className="x-row"><button className="x-btn primary" disabled={!!busy || !manualName.trim()} onClick={() => void saveManual()}>{busy === 'li-manual' ? <LoaderCircle size={14} className="spin" /> : null} Save and continue</button></div>
        </div>}
      </article>
      <article className="ow-src"><header><Upload size={16} /><b>2 · Your contacts</b></header>
        <p>The most reliable way to find who you really know. Only you see it.</p>
        <label className="x-field"><span>Where is the list from?</span><select value={origin} onChange={(e) => { setOrigin(e.target.value); setHowto(false); }}>{Object.entries(ORIGINS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></label>
        <label className="ow-upload"><Upload size={15} /> {busy === 'file' ? 'Uploading…' : 'Choose file'}<input type="file" accept={o.accept} hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void importFile(f); e.target.value = ''; }} /></label>
        <button className="x-link-btn" aria-expanded={howto} onClick={() => setHowto(!howto)}>How do I export this?</button>
        {howto && <ol className="ow-howto">{o.steps.map((x) => <li key={x}>{x}</li>)}</ol>}
      </article>
    </div>
    {msg && <p className="x-note" role="status"><CheckCircle2 size={14} /> {msg}</p>}
    <h3 className="x-h3">Connected</h3>
    {sources === null ? <SkeletonState rows={2} /> : sources.length ? <table className="x-table"><thead><tr><th scope="col">Source</th><th scope="col" className="num">People</th><th scope="col">Updated</th><th /></tr></thead><tbody>{sources.map((x) => <tr key={x.source}><th scope="row">{label[x.source] || x.source}</th><td className="num">{fmtInt(x.count)}</td><td>{fmtDateTime(x.updatedAt)}</td><td>{['linkedin', 'gmail', 'outlook', 'calendar', 'hubspot', 'apollo'].includes(x.source) && <button className="x-link-btn" onClick={() => void run(`rm-${x.source}`, async () => { await accountApi.disconnectSource(x.source); return `${label[x.source]}: disconnected.`; })}>Remove</button>}</td></tr>)}</tbody></table>
      : <EmptyState icon={<Network size={20} />} title="No contacts connected yet">Without your network, every outreach is cold.</EmptyState>}
    <label className="ow-toggle"><input type="checkbox" checked={prefs.useApify} onChange={(e) => setPrefs({ useApify: e.target.checked })} disabled={!profile} /><span><b>Find the decision-maker at each organization</b><small>Small cost per use. Turn off for a free evaluation.</small></span></label>
    {graph && graph.nodes.length > 1 && <NetworkGraph job={stub} account={graph} selectedLeadId={null} onSelectLead={() => undefined} onInspect={() => undefined} height={380} mode="network" />}
  </div>;
}

function ReviewSection({ intake, prefs, setPrefs, onGo, canPrefs }: { intake: IntakeState; prefs: ResearchPrefs; setPrefs: (p: Partial<ResearchPrefs>) => void; onGo: (s: SectionId, field?: string) => void; canPrefs: boolean }) {
  const blocking = intake.missing.filter((p) => BLOCKING.includes(p));
  const required = intake.missing.filter((p) => !BLOCKING.includes(p));
  const where = (p: string) => SECTIONS.find((s) => s.fields.includes(p) || s.advanced?.includes(p))?.id || 'empresa';
  const credit = intake.plan.steps.filter((s) => s.cost === 'crédito');
  const v = (p: string) => intake.fields[p]?.value;
  return <div className="ow-review">
    <div className={`ow-gate ${blocking.length ? 'bad' : required.length ? 'warn' : 'ok'}`} role="status">{blocking.length ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}<div><b>{blocking.length ? `Missing ${blocking.length} required fields` : required.length ? `Ready to run · ${required.length} recommended fields pending` : 'Profile complete'}</b><span>{blocking.length ? 'The search can\'t be built without them.' : 'You can run now; filling the rest improves results.'}</span></div></div>
    {(blocking.length > 0 || required.length > 0) && <ul className="ow-missing">{[...blocking, ...required].map((p) => <li key={p} className={BLOCKING.includes(p) ? 'block' : ''}><button onClick={() => onGo(where(p), p)}><b>{F[p]?.label || p}</b><span>{SECTIONS.find((s) => s.id === where(p))?.label} →</span></button></li>)}</ul>}
    <h3 className="x-h3">What the evaluation will use</h3>
    <dl className="x-dl cols">
      <dt>Company</dt><dd>{String(v('company.name') || '—')}{v('organization.name') ? ` · via ${String(v('organization.name'))}` : ''}</dd>
      <dt>Product</dt><dd>{String(v('product.name') || '—')} — {String(v('product.one_liner') || '—')}</dd>
      <dt>Looking for</dt><dd>{asList(v('funding.objectives')).map((o) => OBJECTIVES.find(([id]) => id === o)?.[1] || o).join(' · ') || '—'}{v('funding.round') ? ` · ${String(v('funding.round'))}` : ''}{v('funding.amount_usd') ? ` · ${fmtUsd(Number(v('funding.amount_usd')))}` : ''}</dd>
      {asList(v('funding.objectives')).includes('grant') && <><dt>Apply window</dt><dd>{v('funding.apply_window') ? String(v('funding.apply_window')).replace(' to ', ' → ') : <button className="x-link-btn" onClick={() => onGo('objetivo', 'funding.apply_window')}>Not set — add the dates you can apply</button>}</dd></>}
      <dt>Fit keywords</dt><dd>{asList(v('industry.sectors')).join(', ') || '—'}</dd>
      <dt>Exact grant terms</dt><dd>{asList(v('funding.search_terms')).join(', ') || '—'}</dd>
      <dt>Target population</dt><dd>{String(v('project.target_population') || '—')}</dd>
      <dt>Applicant route</dt><dd>{String(v('funding.applicant_role') || '—')}</dd>
      <dt>Geography</dt><dd>{asList(v('geography')).join(', ') || '—'}</dd>
      <dt>Exclusions</dt><dd>{asList(v('competitors')).join(', ') || 'None'}</dd>
      <dt>Documents</dt><dd>{intake.documents.length ? intake.documents.map((d) => d.name).join(', ') : 'None'}</dd>
    </dl>
    <details className="ow-adv">
      <summary>Advanced settings <span className="x-muted">(optional — the defaults work)</span></summary>
      <div className="ow-adv-body">
        <h3 className="x-h3">Scoring <Info wide label="Scoring mode">Mode changes the score weights, not the evidence searched.</Info></h3>
        <div className="ow-mode" role="radiogroup" aria-label="Scoring mode">{(['strategic', 'financial'] as const).map((m) => <button key={m} role="radio" aria-checked={prefs.mode === m} disabled={!canPrefs} className={prefs.mode === m ? 'on' : ''} onClick={() => setPrefs({ mode: m })}><b>{MODE_LABEL[m]}</b></button>)}</div>
        <label className="ow-inline">Minimum lead time <input type="number" min={0} max={730} value={prefs.minDays} disabled={!canPrefs} onChange={(e) => setPrefs({ minDays: Math.max(0, Math.min(730, Math.round(Number(e.target.value) || 0))) })} /> days <small>Earlier deadlines go to radar.</small></label>
        <label className="ow-inline">Deadline from <input type="date" value={prefs.deadlineFrom || ''} disabled={!canPrefs} onChange={(e) => setPrefs({ deadlineFrom: e.target.value || undefined })} /></label>
        <label className="ow-inline">Deadline through <input type="date" value={prefs.deadlineTo || ''} disabled={!canPrefs} min={prefs.deadlineFrom || undefined} onChange={(e) => setPrefs({ deadlineTo: e.target.value || undefined })} /> <small>Firm application deadlines outside this window are excluded.</small></label>
        {!canPrefs && <p className="x-muted">Preferences save once the profile is confirmed.</p>}
        <h3 className="x-h3">Where we look</h3>
        <ul className="ow-sources">{intake.plan.steps.filter((s) => s.status === 'activo').map((s) => <li key={`${s.goal}-${s.source}`}>{s.source}{s.cost === 'crédito' ? <span className="x-credit">paid</span> : null}</li>)}</ul>
        {credit.length > 0 && <p className="x-muted">Paid sources are used only when they add something the free ones can't find.</p>}
      </div>
    </details>
  </div>;
}

/* ───────── Asistente IA: conversar en lugar de llenar el formulario ───────── */
function AssistantSection({ intake, setIntake, onError, onGo }: { intake: IntakeState; setIntake: (s: IntakeState) => void; onError: (e: string) => void; onGo: (s: SectionId, field?: string) => void }) {
  // Feedback 29/09: no "understood so far" table — the progress bar is enough; the assistant asks for what is missing.
  return <div className="ow-ai solo">
    <div className="ow-ai-chat">
      <AgentChat intake={intake} onChange={setIntake} onError={onError} title="" description="" reviewLabel="Review and run" reviewRequiresConversation={false} onReview={() => onGo('revision')} />
      <p className="ow-ai-alt"><Pencil size={13} /> Prefer a form? <button className="x-link-btn" onClick={() => onGo('empresa')}>Fill it in yourself</button></p>
    </div>
  </div>;
}

/* ───────── Workspace ───────── */
export function OnboardingWorkspace({ session, section, onSection, onDone, onCancel, mode, onSession }: {
  session: AccountSession; section: SectionId; onSection: (s: SectionId) => void; mode: 'initial' | 'edit';
  onDone: (profile: Profile, run: boolean) => void; onCancel?: () => void; onSession: (s: AccountSession) => void;
}) {
  const uid = session.user.id;
  const [intake, setIntake] = useState<IntakeState | null>(null);
  const [loadError, setLoadError] = useState('');
  const [save, setSave] = useState<SaveState>({ status: 'idle', at: null, error: null, pending: 0 });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [lastFailed, setLastFailed] = useState<{ path: string; value: unknown } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [adv, setAdv] = useState(false);
  const profile = (session.profile as Profile | null) || null;
  const [prefs, setPrefsState] = useState<ResearchPrefs>(() => prefsOf(profile));
  const load = useCallback(() => { setLoadError(''); void intakeApi.get().then(setIntake).catch((e) => setLoadError(errorText(e))); }, []);
  useEffect(load, [load]);
  useEffect(() => { const t = window.location.hash.split('?field=')[1]; if (t) window.setTimeout(() => document.getElementById(`field-${decodeURIComponent(t)}`)?.querySelector<HTMLElement>('input,textarea,select,button')?.focus(), 200); }, [section, intake === null]);

  const saveField = useCallback(async (path: string, value: unknown) => {
    setSave((s) => ({ ...s, status: 'saving', pending: s.pending + 1 }));
    try {
      const next = await intakeApi.field(path, value);
      setIntake(next); setFieldErrors((e) => { const n = { ...e }; delete n[path]; return n; }); setLastFailed(null);
      setSave((s) => ({ status: s.pending - 1 > 0 ? 'saving' : 'saved', at: new Date().toISOString(), error: null, pending: s.pending - 1 }));
      return true;
    } catch (e) {
      setFieldErrors((x) => ({ ...x, [path]: errorText(e) })); setLastFailed({ path, value });
      setSave((s) => ({ status: 'error', at: s.at, error: errorText(e), pending: Math.max(0, s.pending - 1) }));
      return false;
    }
  }, []);
  const setPrefs = async (patch: Partial<ResearchPrefs>) => {
    const next = { ...prefs, ...patch }; setPrefsState(next);
    if (!profile) return;
    setSave((s) => ({ ...s, status: 'saving', pending: s.pending + 1 }));
    try { const p = await accountApi.saveProfile({ ...profile, research_prefs: next } as Profile); onSession({ ...session, profile: p }); setSave((s) => ({ status: 'saved', at: new Date().toISOString(), error: null, pending: Math.max(0, s.pending - 1) })); }
    catch (e) { setSave((s) => ({ status: 'error', at: s.at, error: errorText(e), pending: Math.max(0, s.pending - 1) })); }
  };
  /** Confirma el prerregistro para que exista un perfil (necesario para conectar la red). */
  const ensureProfile = async (): Promise<Profile | null> => {
    if (profile) return profile;
    if (!intake || intake.missing.some((p) => BLOCKING.includes(p))) return null;
    const r = await intakeApi.confirm();
    const p = await accountApi.saveProfile({ ...r.profile, onboardingComplete: false, research_prefs: prefs } as Profile);
    onSession({ ...session, profile: p }); setIntake(r.intake);
    return p as Profile;
  };
  const finish = async (run: boolean) => {
    setBusy(true); setError('');
    try {
      const r = await intakeApi.confirm();
      const merged = { ...profile, ...r.profile, linkedin_profile: profile?.linkedin_profile ?? r.profile.linkedin_profile, linkedin_interactions: profile?.linkedin_interactions ?? r.profile.linkedin_interactions, research_prefs: prefs, onboardingComplete: true } as Profile;
      const p = await accountApi.saveProfile(merged);
      onSession({ ...session, profile: p });
      onDone(p as Profile, run);
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };

  if (loadError) return <div className="ow"><ErrorState title="Couldn't load your setup" message={loadError} onRetry={load} /></div>;
  if (!intake) return <div className="ow"><SkeletonState rows={6} label="Loading setup…" /></div>;

  const filled = (p: string) => Boolean(intake.fields[p]);
  const plan = intake.planFields?.length ? intake.planFields : REQUIRED;
  const secProgress = (s: SectionDef) => {
    if (s.id === 'asistente') return { done: intake.messages.some((m) => m.role === 'user') ? 1 : 0, total: 1, req: 0, reqDone: 0 };
    if (s.id === 'evidencia') return { done: intake.documents.length ? 1 : 0, total: 1, req: 0, reqDone: 0 };
    if (s.id === 'red') { const has = Boolean(profile?.linkedin_interactions?.count || profile?.linkedin_profile); return { done: has ? 1 : 0, total: 1, req: 0, reqDone: 0 }; }
    if (s.id === 'revision') return { done: intake.confirmedAt ? 1 : 0, total: 1, req: 0, reqDone: 0 };
    const all = [...s.fields, ...(s.advanced || [])];
    const req = all.filter((p) => plan.includes(p));
    return { done: all.filter(filled).length, total: all.length, req: req.length, reqDone: req.filter(filled).length };
  };
  const reqDone = plan.filter(filled).length;
  const optAll = Object.keys(F).filter((p) => !F[p].required);
  const optDone = optAll.filter(filled).length;
  const blocking = intake.missing.filter((p) => BLOCKING.includes(p));
  const cur = SECTIONS.find((s) => s.id === section) || SECTIONS[0];
  const idx = SECTIONS.indexOf(cur);
  const go = (s: SectionId, field?: string) => { onSection(s); if (field) window.setTimeout(() => document.getElementById(`field-${field}`)?.querySelector<HTMLElement>('input,textarea,select,button')?.focus(), 120); };

  return <div className="ow">
    <aside className="ow-nav" aria-label="Setup sections">
      <div className="ow-progress"><span><b>{Math.round((reqDone / plan.length) * 100)}%</b> of your plan</span><div className="x-meter blue"><i style={{ width: `${(reqDone / plan.length) * 100}%` }} /></div><small>{reqDone} of {plan.length} answers</small></div>
      <ol>{SECTIONS.map((s, i) => { const p = secProgress(s); const miss = p.req - p.reqDone; const complete = s.id === 'revision' ? !!intake.confirmedAt : p.total ? p.done === p.total || (p.req > 0 && miss === 0 && p.done >= p.req) : false; return <li key={s.id}><button aria-current={s.id === section ? 'step' : undefined} className={`${s.id === section ? 'on' : ''} ${miss > 0 ? 'miss' : complete ? 'done' : ''}`} onClick={() => onSection(s.id)}>
        <span className="ow-num" aria-hidden="true">{miss > 0 ? '!' : complete ? <Check size={13} /> : i + 1}</span>
        <span className="ow-lbl"><b>{s.label}</b><small>{s.id === 'asistente' ? 'Start here' : s.id === 'evidencia' ? `${intake.documents.length} documents` : s.id === 'red' ? (profile?.linkedin_interactions?.count ? `${profile.linkedin_interactions.count} relationships` : 'Not connected') : s.id === 'revision' ? (blocking.length ? 'Not ready yet' : intake.missing.length ? 'Almost ready' : 'Ready') : miss > 0 ? 'To complete' : 'Done'}</small></span>
      </button></li>; })}</ol>
    </aside>
    <main className="ow-main">
      <PageHeader crumb={mode === 'initial' ? `Setup · step ${idx + 1} of ${SECTIONS.length}` : `Setup · ${idx + 1} of ${SECTIONS.length}`} title={cur.label} meta={cur.why}
        actions={<>{cur.id !== 'asistente' && <button className="x-btn ai sm" onClick={() => onSection('asistente')}><Sparkles size={14} /> Fill with AI</button>}{onCancel && <button className="x-btn sm" onClick={onCancel}>Back to evaluation</button>}<AutosaveStatus state={save} onRetry={lastFailed ? () => void saveField(lastFailed.path, lastFailed.value) : undefined} /></>} />
      {error && <ErrorState message={error} onRetry={() => setError('')} title="Couldn't finish" />}
      {cur.fields.length > 0 && <div className="ow-grid">{cur.fields.map((p) => <FieldEditor key={p} def={F[p]} intake={intake} uid={uid} onSave={saveField} fieldError={fieldErrors[p]} />)}</div>}
      {cur.advanced && <details className="ow-adv" open={adv || cur.advanced.some(filled)} onToggle={(e) => setAdv((e.target as HTMLDetailsElement).open)}><summary>Criteria, constraints and competitors <span className="x-muted">({cur.advanced.filter(filled).length}/{cur.advanced.length})</span></summary><div className="ow-grid">{cur.advanced.map((p) => <FieldEditor key={p} def={F[p]} intake={intake} uid={uid} onSave={saveField} fieldError={fieldErrors[p]} />)}</div></details>}
      {cur.id === 'asistente' && <AssistantSection intake={intake} setIntake={setIntake} onError={setError} onGo={go} />}
      {cur.id === 'evidencia' && <EvidenceSection intake={intake} setIntake={setIntake} onError={setError} />}
      {cur.id === 'red' && <NetworkSection session={session} profile={profile} ensureProfile={ensureProfile} prefs={prefs} setPrefs={(p) => void setPrefs(p)} onError={setError} />}
      {cur.id === 'revision' && <ReviewSection intake={intake} prefs={prefs} setPrefs={(p) => void setPrefs(p)} onGo={go} canPrefs={!!profile} />}
      {cur.id !== 'asistente' && <footer className="ow-foot">
        <button className="x-btn" disabled={idx === 0} onClick={() => onSection(SECTIONS[idx - 1].id)}><ChevronLeft size={15} /> {idx > 0 ? SECTIONS[idx - 1].label : 'Back'}</button>
        <span className="ow-foot-mid">{blocking.length ? <><AlertCircle size={14} /> Missing: {blocking.map((p) => F[p].label).join(', ')}</> : <><CheckCircle2 size={14} /> Ready to run</>}</span>
        {cur.id !== 'revision' ? <button className="x-btn" onClick={() => onSection(SECTIONS[idx + 1].id)}>{SECTIONS[idx + 1].label} <ChevronRight size={15} /></button>
          : <span className="x-row"><button className="x-btn" disabled={busy || blocking.length > 0} onClick={() => void finish(false)}><Save size={15} /> Save without running</button><button className="x-btn primary" disabled={busy || blocking.length > 0} onClick={() => void finish(true)}>{busy ? <LoaderCircle size={15} className="spin" /> : <Play size={15} />} Confirm and run</button></span>}
      </footer>}
    </main>
  </div>;
}
