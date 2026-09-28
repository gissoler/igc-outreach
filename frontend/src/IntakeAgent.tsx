import { ArrowLeft, Check, ChevronRight, FileText, LoaderCircle, Paperclip, RotateCcw, Send, ShieldCheck, Sparkles, X } from 'lucide-react';
import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from 'react';
import { intakeApi, type IntakeField, type IntakeState } from './accountApi';
import { ACCEPT, extractText } from './docText';
import './intake.css';

/* Prerregistro conversacional: el usuario escribe o adjunta documentos, el agente arma el perfil
   (con origen y cita por campo) y el usuario lo confirma antes de cualquier investigación. */

type Kind = 'text' | 'long' | 'number' | 'tags' | 'lines' | 'objectives' | 'maturity' | 'round' | 'relation';
const META: Record<string, { label: string; kind: Kind; placeholder?: string }> = {
  'organization.name': { label: 'Organization you represent', kind: 'text', placeholder: 'Only if different, e.g. IGC Pharma' },
  'company.relation': { label: 'Relationship to the company', kind: 'relation' },
  'company.name': { label: 'Company or project to fund', kind: 'text' },
  'founder.title': { label: 'Your role', kind: 'text', placeholder: 'CEO, founder, CSO…' },
  'company.website': { label: 'Website', kind: 'text' },
  'product.name': { label: 'Product or project', kind: 'text' },
  'product.one_liner': { label: 'What it does, in one sentence', kind: 'text' },
  'product.description': { label: 'Description', kind: 'long' },
  'funding.objectives': { label: 'What you\'re looking for', kind: 'objectives' },
  'funding.round': { label: 'Round', kind: 'round' },
  'funding.amount_usd': { label: 'Amount (USD)', kind: 'number' },
  'funding.use_of_funds': { label: 'Use of funds', kind: 'text' },
  'funding.timeline': { label: 'Timeline', kind: 'text', placeholder: '6 months' },
  'industry.sectors': { label: 'Sector', kind: 'tags' },
  'product.maturity': { label: 'Stage', kind: 'maturity' },
  'geography': { label: 'Geography', kind: 'tags', placeholder: 'US, CO, LATAM…' },
  'company.traction': { label: 'Traction and key data', kind: 'long' },
  'product.differentiation': { label: 'Why you win', kind: 'long' },
  'product.business_model': { label: 'Business model', kind: 'text' },
  'company.team': { label: 'Team', kind: 'long' },
  'competitors': { label: 'Competitors', kind: 'tags' },
  'criteria': { label: 'Criteria', kind: 'lines', placeholder: 'One per line' },
  'constraints': { label: 'Constraints', kind: 'lines', placeholder: 'One per line' },
};
const REQUIRED = ['company.name', 'product.name', 'funding.objectives', 'product.one_liner', 'industry.sectors', 'product.maturity', 'geography'];
const GROUPS: [string, string[]][] = [
  ['Who\'s looking, and for whom', ['organization.name', 'founder.title', 'company.name', 'company.relation']],
  ['Product', ['product.name', 'product.one_liner', 'product.description', 'company.website']],
  ['Funding', ['funding.objectives', 'funding.round', 'funding.amount_usd', 'funding.use_of_funds', 'funding.timeline']],
  ['Market and stage', ['industry.sectors', 'product.maturity', 'geography']],
  ['Investor view', ['company.traction', 'product.differentiation', 'product.business_model', 'company.team']],
  ['Criteria and constraints', ['competitors', 'criteria', 'constraints']],
];
export const OBJECTIVES: [string, string][] = [['investment', 'Investment (VC, angels)'], ['grant', 'Non-dilutive grants'], ['partnering', 'Partnering'], ['sponsorship', 'Sponsorship'], ['debt', 'Debt']];
const RELATIONS: [string, string][] = [['same', 'It\'s my own company'], ['subsidiary', 'Subsidiary'], ['spinout', 'Spin-off'], ['sponsored', 'Project we sponsor'], ['portfolio', 'Portfolio company'], ['client', 'Client'], ['other', 'Other']];
const MATURITY: [string, string][] = [['idea', 'Idea'], ['prototype', 'Prototype or pilot'], ['preclinical', 'Preclinical'], ['clinical_phase_1', 'Clinical phase 1'], ['clinical_phase_2', 'Clinical phase 2'], ['clinical_phase_3', 'Clinical phase 3'], ['marketed', 'On the market'], ['other', 'Other']];
const ROUNDS = ['pre-seed', 'seed', 'series-a', 'series-b', 'growth'];
const errorText = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong.';
const asList = (v: unknown) => Array.isArray(v) ? v.map(String) : [];

export function formatValue(path: string, value: unknown): string {
  if (value === undefined || value === null || value === '') return '';
  if (path === 'funding.amount_usd') return `US$${Number(value).toLocaleString('en-US')}`;
  if (path === 'funding.objectives') return asList(value).map((v) => OBJECTIVES.find(([id]) => id === v)?.[1] || v).join(' · ');
  if (path === 'product.maturity') return MATURITY.find(([id]) => id === value)?.[1] || String(value);
  if (path === 'company.relation') return RELATIONS.find(([id]) => id === value)?.[1] || String(value);
  if (Array.isArray(value)) return value.join(', ');
  return String(value);
}
function originLabel(f?: IntakeField) {
  if (!f) return null;
  if (f.origin === 'user') return { text: 'edited by you', tone: 'user' };
  if (f.origin === 'profile') return { text: 'from your profile', tone: 'user' };
  if (f.origin.startsWith('document:')) return { text: `from ${f.origin.slice(9)}`, tone: f.confidence };
  if (f.origin === 'model') return { text: f.confidence === 'source' ? 'AI · quoted' : 'AI · inferred', tone: f.confidence };
  return { text: 'from chat', tone: f.confidence };
}
function Origin({ field }: { field?: IntakeField }) {
  const o = originLabel(field);
  if (!o) return null;
  return <em className={`ia-origin ${o.tone}`} title={field?.quote ? `“${field.quote}”` : undefined}>{o.text}</em>;
}

/* ───────── Panel izquierdo: perfil en construcción ───────── */
export function LiveProfile({ intake, onRemoveDocument }: { intake: IntakeState | null; onRemoveDocument: (id: string) => void }) {
  if (!intake) return <p className="rl-note">Loading…</p>;
  const done = REQUIRED.filter((p) => !intake.missing.includes(p)).length;
  const shown = Object.keys(META).filter((p) => REQUIRED.includes(p) || intake.fields[p]);
  return <div className="ia-live">
    <div className="ia-live-head"><h4>Profile in progress</h4><span>{done} of {REQUIRED.length}</span></div>
    <div className="ia-meter"><i style={{ width: `${(done / REQUIRED.length) * 100}%` }} /></div>
    <dl>{shown.map((p) => {
      const f = intake.fields[p];
      return <div key={p} className={`${f ? 'on' : ''} ${intake.changed?.includes(p) ? 'fresh' : ''}`}>
        <dt><i className={f ? f.confidence : 'empty'} />{META[p].label}</dt>
        <dd>{f ? formatValue(p, f.value) : <span className="ia-empty">pending</span>}</dd>
      </div>;
    })}</dl>
    {intake.documents.length > 0 && <div className="ia-docs"><h5>Documents</h5>{intake.documents.map((d) => <span key={d.id} title={d.preview}><FileText size={13} /> {d.name}<small>{d.chars.toLocaleString('en-US')} car.</small><button onClick={() => onRemoveDocument(d.id)} aria-label={`Remove ${d.name}`}><X size={12} /></button></span>)}</div>}
    <p className="ia-legend"><span><i className="source" />in the source</span><span><i className="inferred" />inferred</span><span><i className="user" />yours</span></p>
  </div>;
}

/* ───────── Paso 1: conversación + adjuntos ───────── */
type Pending = { id: string; file: File; status: 'reading' | 'ready' | 'error'; text?: string; pages?: number; error?: string };
const STARTERS = ['I want to raise a seed round', 'I\'m looking for non-dilutive health grants', 'We want a pharma licensing partner'];

export function AgentChat({ intake, onChange, onReview, onError, title = 'Tell us what you want to fund', description = 'Write freely or attach your deck. The assistant builds your profile; you confirm it.', reviewLabel = 'Review profile', reviewRequiresConversation = true }: { intake: IntakeState | null; onChange: (s: IntakeState) => void; onReview: () => void; onError: (e: string) => void; title?: string; description?: string; reviewLabel?: string; reviewRequiresConversation?: boolean }) {
  const [text, setText] = useState('');
  const [files, setFiles] = useState<Pending[]>([]);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<{ text: string; files: string[] } | null>(null);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const thread = useRef<HTMLDivElement>(null);
  useEffect(() => { thread.current?.scrollTo({ top: thread.current.scrollHeight, behavior: 'smooth' }); }, [intake?.messages.length, busy]);

  function add(list: FileList | File[]) {
    const items: Pending[] = [...list].slice(0, 8).map((file) => ({ id: crypto.randomUUID(), file, status: 'reading' }));
    setFiles((f) => [...f, ...items]);
    for (const item of items) extractText(item.file)
      .then((r) => setFiles((f) => f.map((x) => x.id === item.id ? { ...x, status: 'ready', text: r.text, pages: r.pages } : x)))
      .catch((e) => setFiles((f) => f.map((x) => x.id === item.id ? { ...x, status: 'error', error: errorText(e) } : x)));
  }
  const ready = files.filter((f) => f.status === 'ready');
  const reading = files.some((f) => f.status === 'reading');
  async function send(message = text) {
    if (busy || reading || (!message.trim() && !ready.length)) return;
    setBusy(true); onError(''); setSent({ text: message, files: ready.map((f) => f.file.name) }); setText('');
    try {
      const next = await intakeApi.message(message, ready.map((f) => ({ name: f.file.name, type: f.file.type, size: f.file.size, text: f.text || '', pages: f.pages })));
      onChange(next);
      setFiles((f) => f.filter((x) => x.status === 'error'));
      if (next.modelError) onError(`The model didn't respond (${next.modelError}). Used basic extraction.`);
    } catch (e) { onError(errorText(e)); setText(message); } finally { setBusy(false); setSent(null); }
  }
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } };
  const onDrop = (e: DragEvent) => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) add(e.dataTransfer.files); };
  const fresh = (intake?.messages.length || 0) <= 1;
  const missing = intake?.missing.length ?? REQUIRED.length;

  return <div className="ia-chat">
    <div className="ia-chat-head">
      <div><h1>{title}</h1><p className="rl-sub">{description}</p></div>
      <span className={`ia-model ${intake?.model.configured ? 'on' : ''}`} title={intake?.model.configured ? 'Local model via OpenAI-compatible endpoint' : 'No model: rule-based extraction'}><Sparkles size={13} />{intake?.model.configured ? intake.model.model : 'Basic extraction'}</span>
    </div>
    <div className="ia-thread" ref={thread} aria-live="polite">
      {intake?.messages.map((m, i) => <div key={i} className={`ia-msg ${m.role}`}>
        {m.role === 'assistant' && <img src="/igc-outreach-mark.png" alt="" width={26} height={26} />}
        <div>{m.text && <p>{m.text}</p>}{m.files?.length ? <div className="ia-files">{m.files.map((f) => <span key={f}><FileText size={12} />{f}</span>)}</div> : null}</div>
      </div>)}
      {sent && <div className="ia-msg user pending"><div>{sent.text && <p>{sent.text}</p>}{sent.files.length > 0 && <div className="ia-files">{sent.files.map((f) => <span key={f}><FileText size={12} />{f}</span>)}</div>}</div></div>}
      {busy && <div className="ia-msg assistant"><img src="/igc-outreach-mark.png" alt="" width={26} height={26} /><div><p className="ia-typing"><i /><i /><i /> {sent?.files.length ? 'Reading your documents…' : 'Thinking…'}</p></div></div>}
      {fresh && !busy && <div className="ia-starters">{STARTERS.map((s) => <button key={s} onClick={() => void send(s)}>{s}</button>)}<button onClick={() => input.current?.click()}><Paperclip size={13} /> Attach pitch deck</button></div>}
    </div>
    <div className={`ia-composer ${drag ? 'drag' : ''}`} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={onDrop}>
      {files.length > 0 && <div className="ia-pending">{files.map((f) => <span key={f.id} className={f.status} title={f.error}>
        {f.status === 'reading' ? <LoaderCircle className="spin" size={12} /> : f.status === 'error' ? <X size={12} /> : <Check size={12} />}
        {f.file.name}{f.status === 'error' && <small>{f.error}</small>}
        <button onClick={() => setFiles((l) => l.filter((x) => x.id !== f.id))} aria-label={`Remove ${f.file.name}`}><X size={12} /></button>
      </span>)}</div>}
      <textarea rows={2} value={text} placeholder="e.g. We're Andes Labs, raising $1.5M pre-seed for Aurora, a wearable that…" onChange={(e) => setText(e.target.value)} onKeyDown={onKey} disabled={busy} aria-label="Message" />
      <div className="ia-composer-bar">
        <button className="ia-attach" onClick={() => input.current?.click()} disabled={busy}><Paperclip size={16} /> Attach</button>
        <small>PDF, Word, PowerPoint, Excel or text</small>
        <button className="ia-send" onClick={() => void send()} disabled={busy || reading || (!text.trim() && !ready.length)} aria-label="Send">{busy ? <LoaderCircle className="spin" size={17} /> : <Send size={17} />}</button>
      </div>
      <input ref={input} type="file" multiple accept={ACCEPT} hidden onChange={(e) => { if (e.target.files) add(e.target.files); e.target.value = ''; }} />
    </div>
    <div className="rl-actions ia-actions">
      <span className="ia-status">{missing ? `${missing === 1 ? '1 required field missing' : `Missing ${missing} required fields`}; finish in review.` : <><Check size={14} /> Profile complete</>}</span>
      <button className="rl-primary" onClick={onReview} disabled={busy || !intake || (reviewRequiresConversation && intake.messages.length <= 1)}>{reviewLabel} <ChevronRight size={17} /></button>
    </div>
  </div>;
}

/* ───────── Paso 2: confirmar el perfil ───────── */
function TextEdit({ value, onSave, long, placeholder, type = 'text' }: { value: string; onSave: (v: string) => void; long?: boolean; placeholder?: string; type?: string }) {
  const [v, setV] = useState(value);
  const commit = () => { if (v.trim() !== value.trim()) onSave(v.trim()); };
  return long
    ? <textarea rows={3} value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} onBlur={commit} />
    : <div className="rl-input"><input type={type} value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} /></div>;
}
function TagEdit({ values, onSave, placeholder }: { values: string[]; onSave: (v: string[]) => void; placeholder?: string }) {
  const [draft, setDraft] = useState('');
  const push = () => { const items = draft.split(',').map((x) => x.trim()).filter(Boolean); if (items.length) onSave([...values, ...items]); setDraft(''); };
  return <div className="ia-tags">
    {values.map((t) => <span key={t}>{t}<button onClick={() => onSave(values.filter((x) => x !== t))} aria-label={`Remove ${t}`}><X size={11} /></button></span>)}
    <input value={draft} placeholder={values.length ? 'Add…' : placeholder || 'Type and press Enter'} onChange={(e) => setDraft(e.target.value)} onBlur={push} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); push(); } }} />
  </div>;
}

export function ConfirmProfile({ intake, onChange, onBack, onConfirm, busy, onError, confirmLabel = 'Confirm profile', title = 'Confirm your profile', backLabel = 'Back to chat' }: { intake: IntakeState; onChange: (s: IntakeState) => void; onBack: () => void; onConfirm: () => void; busy: boolean; onError: (e: string) => void; confirmLabel?: string; title?: string; backLabel?: string }) {
  const save = (path: string, value: unknown) => { onError(''); void intakeApi.field(path, value).then(onChange).catch((e) => onError(errorText(e))); };
  const editor = (path: string): ReactNode => {
    const m = META[path];
    const value = intake.fields[path]?.value;
    const key = `${path}:${JSON.stringify(value ?? '')}`;
    if (m.kind === 'objectives') {
      const on = asList(value);
      return <div className="rl-pills">{OBJECTIVES.map(([id, label]) => { const active = on.includes(id); return <button key={id} className={active ? 'on' : ''} onClick={() => save(path, active ? on.filter((x) => x !== id) : [...on, id])}><i>{active && <Check size={12} />}</i>{label}</button>; })}</div>;
    }
    if (m.kind === 'maturity' || m.kind === 'round' || m.kind === 'relation') {
      const options: [string, string][] = m.kind === 'maturity' ? MATURITY : m.kind === 'relation' ? RELATIONS : ROUNDS.map((r) => [r, r]);
      return <div className="rl-input"><select value={String(value ?? '')} onChange={(e) => save(path, e.target.value || null)}><option value="">Not set</option>{options.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></div>;
    }
    if (m.kind === 'tags') return <TagEdit key={key} values={asList(value)} placeholder={m.placeholder} onSave={(v) => save(path, v)} />;
    if (m.kind === 'lines') return <textarea key={key} rows={2} defaultValue={asList(value).join('\n')} placeholder={m.placeholder} onBlur={(e) => { const v = e.target.value.split('\n').map((x) => x.trim()).filter(Boolean); if (JSON.stringify(v) !== JSON.stringify(asList(value))) save(path, v); }} />;
    if (m.kind === 'number') return <TextEdit key={key} type="text" value={value ? String(value) : ''} placeholder="1500000" onSave={(v) => save(path, v ? Number(v.replace(/[^\d.]/g, '')) || v : null)} />;
    return <TextEdit key={key} long={m.kind === 'long'} value={String(value ?? '')} placeholder={m.placeholder} onSave={(v) => save(path, v || null)} />;
  };
  const blocking = intake.missing.filter((p) => ['company.name', 'product.name', 'product.one_liner', 'funding.objectives'].includes(p));
  return <div className="ia-confirm">
    <h1>{title}</h1>
    <p className="rl-sub">Here's what we understood. Fix anything before confirming.</p>
    {GROUPS.map(([title, paths]) => <section key={title} className="ia-group">
      <h2>{title}</h2>
      <div className="ia-grid">{paths.map((p) => <div key={p} className={`ia-field ${['product.description', 'funding.objectives', 'criteria', 'constraints'].includes(p) ? 'wide' : ''} ${intake.missing.includes(p) ? 'missing' : ''}`}>
        <span className="ia-label">{META[p].label}{REQUIRED.includes(p) && <b>*</b>}<Origin field={intake.fields[p]} /></span>
        {editor(p)}
      </div>)}</div>
    </section>)}
    <div className="rl-actions ia-actions">
      <button className="rl-skip" onClick={onBack}><ArrowLeft size={15} /> {backLabel}</button>
      <span className="ia-status">{blocking.length ? `Missing: ${blocking.map((p) => META[p].label).join(', ')}` : intake.missing.length ? `Optional: ${intake.missing.map((p) => META[p].label).join(', ')}` : ''}</span>
      <button className="rl-primary" disabled={busy || blocking.length > 0} onClick={onConfirm}>{busy ? <LoaderCircle className="spin" size={17} /> : <ShieldCheck size={16} />} {confirmLabel} <ChevronRight size={17} /></button>
    </div>
  </div>;
}

/* ───────── Panel izquierdo del paso 2: plan de investigación ───────── */
export function PlanAside({ intake, onReset }: { intake: IntakeState | null; onReset?: () => void }) {
  if (!intake) return null;
  const goals = [...new Set(intake.plan.steps.map((s) => s.goal))];
  return <div className="ia-plan">
    <h4>How we'll research</h4>
    <p className="rl-note">Sources are chosen based on your goal.</p>
    {goals.map((g) => <div key={g} className="ia-plan-goal"><h5>{g}</h5><ul>{intake.plan.steps.filter((s) => s.goal === g).map((s) => <li key={s.source} className={s.status === 'activo' ? 'on' : 'off'} title={s.why}><b>{s.source}</b><small>{s.why}</small><em>{s.status}</em></li>)}</ul></div>)}
    {intake.plan.skipped.length > 0 && <div className="ia-plan-goal"><h5>Skipped</h5><ul>{intake.plan.skipped.map((s) => <li key={s.source} className="off"><b>{s.source}</b><small>{s.reason}</small></li>)}</ul></div>}
    <ul className="rl-list">{intake.plan.rules.map((r) => <li key={r}><Check size={14} /> {r}</li>)}</ul>
    {onReset && <button className="ia-reset" onClick={onReset}><RotateCcw size={13} /> Start over</button>}
  </div>;
}
