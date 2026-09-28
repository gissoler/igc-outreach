/* Piezas del asesor usadas en Outreach: redactor de update/intro por persona, editor del update del período y revisión.
   La app redacta y registra; nunca envía. Todo dato del update sale del formulario. */
import { CheckCircle2, Copy, Sparkles, UserPlus, XCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { advisorApi, type Connector, type Draft, type IntroDraft, type ShortItem, type UpdateForm } from '../analysisApi';
import { ErrorState, Info } from './ui';

const errMsg = (e: unknown) => (e instanceof Error ? e.message : 'Unexpected error');
const today = () => new Date().toISOString().slice(0, 10);
const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean).map((x) => (/^\[(privado|private)\]/i.test(x) ? { text: x.replace(/^\[(privado|private)\]\s*/i, ''), public: false } : { text: x, public: true }));
const unlines = (xs: { text: string; public: boolean }[] = []) => xs.map((x) => (x.public ? x.text : `[private] ${x.text}`)).join('\n');
const emptyForm = (): FormState => ({ period: today().slice(0, 7), language: 'en', tldr: '', metrics: [{ name: '', value: '', previous: '', unit: '', public: true }], highlights: '', lowlights: '', market: '', asks: '', nextMilestones: '', raisingInMonths: '' });
type FormState = { id?: string; period: string; language: 'es' | 'en'; tldr: string; metrics: { name: string; value: string; previous: string; unit: string; public: boolean }[]; highlights: string; lowlights: string; market: string; asks: string; nextMilestones: string; raisingInMonths: string };
export type Target = { kind: 'lead'; item: ShortItem } | { kind: 'connector'; item: Connector };

export function Review({ id, text, editable = false }: { id: string; text?: string; editable?: boolean }) {
  const [done, setDone] = useState('');
  const send = (label: 'aprobado' | 'editado' | 'rechazado', final?: string) => advisorApi.review(id, label, final).then(() => setDone(label)).catch(() => setDone('error'));
  if (done) return <span className="x-chip ok">{done === 'error' ? 'Not saved' : `Marked: ${done}`}</span>;
  return <span className="adv-review" title="Each review trains the model">
    <button className="x-btn" onClick={() => void send('aprobado')}><CheckCircle2 size={14} /> Approve</button>
    {editable && <button className="x-btn" onClick={() => void send('editado', text)}>Save my edit</button>}
    <button className="x-btn" onClick={() => void send('rechazado')}><XCircle size={14} /> Reject</button>
  </span>;
}

export function Composer({ jobId, target, updates, cadence, onClose, onSent, embedded = false }: { jobId: string; target: Target; updates: UpdateForm[]; cadence: number; onClose: () => void; onSent: () => void; embedded?: boolean }) {
  const [updateId, setUpdateId] = useState(updates[0]?.id || '');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [text, setText] = useState('');
  const [intro, setIntro] = useState<IntroDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [notice, setNotice] = useState('');
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!embedded) box.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, [embedded]);
  const who = target.kind === 'lead' ? { leadKey: target.item.leadKey } : { connectorKey: target.item.key };
  const name = target.item.name;
  const compose = async (polish: boolean) => {
    setBusy(true); setErr('');
    try { const d = await advisorApi.compose({ jobId, updateId, polish, cadence, ...who }); setDraft(d); setText(`Subject: ${d.subject}\n\n${d.body}`); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  const introDraft = async () => { try { if (target.kind === 'connector') setIntro(await advisorApi.intro({ jobId, connectorKey: target.item.key, leadKey: target.item.targets[0]?.leadKey })); } catch (e) { setErr(errMsg(e)); } };
  const sent = async (channel: string) => { try { await advisorApi.sent({ jobId, channel, sentAt: today(), updateId, generationId: draft?.generationId || undefined, ...who }); setNotice('Logged. Stage and next date updated.'); onSent(); } catch (e) { setErr(errMsg(e)); } };
  useEffect(() => { if (updateId) void compose(false); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [updateId]);
  return <div ref={box} className="adv-composer" role="region" aria-label={`Draft for ${name}`}>
    {!embedded && <div className="adv-row-head"><h3 className="x-h3">Draft for {name}</h3><button className="x-btn" onClick={onClose}>Close</button></div>}
    {!updates.length ? <p className="x-callout warn"><b>Write an investor update first.</b>Use “Investor update” at the top. The advisor only uses what you write there.</p> : <>
      <div className="an-row"><label className="x-field">Update<select value={updateId} onChange={(e) => setUpdateId(e.target.value)}>{updates.map((u) => <option key={u.id} value={u.id}>{u.period}{u.tldr ? ` · ${u.tldr.slice(0, 40)}` : ''}</option>)}</select></label>
        <button className="x-btn" disabled={busy} onClick={() => void compose(true)}><Sparkles size={14} /> {busy ? 'Drafting…' : 'Polish with the fleet'}</button>
        {target.kind === 'connector' && <button className="x-btn" onClick={() => void introDraft()}><UserPlus size={14} /> Intro request (double opt-in)</button>}</div>
      {err && <ErrorState message={err} />}
      {draft && <>
        <p className="x-muted an-small">Method: {draft.method} · {draft.wordCount} words{draft.note ? ` · ${draft.note}` : ''}</p>
        {draft.warnings.map((w, i) => <div key={i} className="x-callout warn">{w}</div>)}
        <textarea className="adv-text" rows={16} value={text} onChange={(e) => setText(e.target.value)} />
        <div className="an-row">
          <button className="x-btn" onClick={() => void navigator.clipboard?.writeText(text)}><Copy size={14} /> Copy</button>
          <button className="x-btn primary" onClick={() => void sent(target.kind === 'connector' ? 'intro_advisor' : 'update')}>Sent: log it</button>
          {draft.generationId && <Review id={draft.generationId} text={text} editable />}
        </div>
      </>}
      {intro && <div className="an-card"><b>To {intro.connector}</b><pre className="adv-pre">{intro.ask}</pre><b>Forwardable text</b><pre className="adv-pre">{intro.forwardable}</pre><p className="x-muted an-small">{intro.rules.join(' ')}</p><button className="x-btn" onClick={() => void navigator.clipboard?.writeText(`${intro.ask}\n\n---\n${intro.forwardable}`)}><Copy size={14} /> Copy</button></div>}
      {notice && <p className="x-note">{notice}</p>}
    </>}
  </div>;
}

export function UpdateEditor({ updates, jobId, onSaved, embedded = false }: { updates: UpdateForm[]; jobId: string; onSaved: () => void; embedded?: boolean }) {
  const [f, setF] = useState<FormState>(emptyForm);
  const [err, setErr] = useState('');
  const [notice, setNotice] = useState('');
  const edit = (u: UpdateForm) => setF({ id: u.id, period: u.period, language: u.language, tldr: u.tldr, metrics: u.metrics.length ? u.metrics : emptyForm().metrics, highlights: unlines(u.highlights), lowlights: unlines(u.lowlights), market: unlines(u.market), asks: unlines(u.asks), nextMilestones: unlines(u.nextMilestones), raisingInMonths: u.raisingInMonths == null ? '' : String(u.raisingInMonths) });
  const save = async () => {
    setErr('');
    try {
      await advisorApi.saveUpdate({ id: f.id, jobId, period: f.period, language: f.language, tldr: f.tldr, metrics: f.metrics.filter((m) => m.name && m.value), highlights: lines(f.highlights), lowlights: lines(f.lowlights), market: lines(f.market), asks: lines(f.asks), nextMilestones: lines(f.nextMilestones), raisingInMonths: f.raisingInMonths === '' ? null : Number(f.raisingInMonths) });
      setNotice('Update saved. Draft it per person now.'); setF(emptyForm()); onSaved();
    } catch (e) { setErr(errMsg(e)); }
  };
  const setMetric = (i: number, k: string, v: string | boolean) => setF({ ...f, metrics: f.metrics.map((m, j) => (j === i ? { ...m, [k]: v } : m)) });
  return <div className="adv-update">
    {!embedded && <h3 className="x-h3">Period update <Info wide>The only facts the advisor may use. Start a line with [private] to keep it out.</Info></h3>}
    {updates.length > 0 && <p className="x-muted an-small">Saved: {updates.map((u) => <button key={u.id} className="adv-link" onClick={() => edit(u)}>{u.period}</button>)}</p>}
    <div className="an-form">
      <label className="x-field">Period<input type="month" value={f.period} onChange={(e) => setF({ ...f, period: e.target.value })} /></label>
      <label className="x-field">Language<select value={f.language} onChange={(e) => setF({ ...f, language: e.target.value as 'es' | 'en' })}><option value="es">Spanish</option><option value="en">English</option></select></label>
      <label className="x-field adv-wide">One line (TL;DR)<input value={f.tldr} onChange={(e) => setF({ ...f, tldr: e.target.value })} placeholder="What changed since the last update" /></label>
      <fieldset className="an-args adv-wide"><legend>Metrics (current and previous)</legend>
        {f.metrics.map((m, i) => <div key={i} className="adv-metric"><input aria-label="Metric" placeholder="Metric" value={m.name} onChange={(e) => setMetric(i, 'name', e.target.value)} /><input aria-label="Value" placeholder="Value" value={m.value} onChange={(e) => setMetric(i, 'value', e.target.value)} /><input aria-label="Previous" placeholder="Previous" value={m.previous} onChange={(e) => setMetric(i, 'previous', e.target.value)} /><input aria-label="Unit" placeholder="Unit" value={m.unit} onChange={(e) => setMetric(i, 'unit', e.target.value)} /><label className="x-check"><input type="checkbox" checked={m.public} onChange={(e) => setMetric(i, 'public', e.target.checked)} />Public</label></div>)}
        {f.metrics.length < 6 && <button className="x-btn" onClick={() => setF({ ...f, metrics: [...f.metrics, { name: '', value: '', previous: '', unit: '', public: true }] })}>+ Metric</button>}
      </fieldset>
      <label className="x-field">Progress (one per line)<textarea rows={3} value={f.highlights} onChange={(e) => setF({ ...f, highlights: e.target.value })} /></label>
      <label className="x-field">What didn't work<textarea rows={3} value={f.lowlights} onChange={(e) => setF({ ...f, lowlights: e.target.value })} /></label>
      <label className="x-field">What we see in the market<textarea rows={3} value={f.market} onChange={(e) => setF({ ...f, market: e.target.value })} /></label>
      <label className="x-field">Specific asks (intros, profiles, advice)<textarea rows={3} value={f.asks} onChange={(e) => setF({ ...f, asks: e.target.value })} /></label>
      <label className="x-field">Next milestones<textarea rows={2} value={f.nextMilestones} onChange={(e) => setF({ ...f, nextMilestones: e.target.value })} /></label>
      <label className="x-field">Months until the round opens (optional)<input type="number" min={0} max={36} value={f.raisingInMonths} onChange={(e) => setF({ ...f, raisingInMonths: e.target.value })} /></label>
      <div className="an-row"><button className="x-btn primary" onClick={() => void save()}>{f.id ? 'Save changes' : 'Save update'}</button>{f.id && <button className="x-btn" onClick={() => setF(emptyForm())}>New</button>}</div>
    </div>
    {err && <ErrorState message={err} />}
    {notice && <p className="x-note">{notice}</p>}
  </div>;
}
