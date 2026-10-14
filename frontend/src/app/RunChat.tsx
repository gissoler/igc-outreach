/* Asistente de la corrida: conversación con memoria sobre ESTA corrida (candidatos, verificaciones, descartes, contactos).
   El servidor solo deja pasar datos que están en la corrida; aquí solo se muestra y se envía. */
import { Bot, Copy, Send } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { API, type Job } from '../researchApi';
import { Drawer } from './ui';

type Msg = { role: 'user' | 'assistant'; text: string; at?: string; cites?: string[] };
const SUGGEST = ['Why did you rule out the rest?', 'What do I need to apply to the first one?', 'Draft a message to the best contact'];

async function call(jobId: string, message?: string) {
  const r = await fetch(`${API}/jobs/${jobId}/chat`, { method: message ? 'POST' : 'GET', headers: message ? { 'Content-Type': 'application/json' } : undefined, body: message ? JSON.stringify({ message }) : undefined, signal: AbortSignal.timeout(180000) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error || `Error ${r.status}`);
  return data as { ready?: boolean; messages: Msg[]; reply?: string };
}

export function RunChat({ job, open, onClose, onSelectLead }: { job: Job; open: boolean; onClose: () => void; onSelectLead: (id: string) => void }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [ready, setReady] = useState(true);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!open) return; call(job.id).then((d) => { setMsgs(d.messages || []); setReady(d.ready !== false); }).catch(() => undefined); }, [open, job.id]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [msgs, busy]);
  const send = async (q: string) => {
    const m = q.trim(); if (!m || busy) return;
    setErr(''); setBusy(true); setText(''); setMsgs((x) => [...x, { role: 'user', text: m }]);
    try { const d = await call(job.id, m); setMsgs(d.messages); } catch (e) { setErr(e instanceof Error ? e.message : 'The assistant did not answer.'); setMsgs((x) => x.slice(0, -1)); setText(m); } finally { setBusy(false); }
  };
  const name = (id: string) => job.leads.find((l) => l.id === id)?.title || id;
  return <Drawer open={open} onClose={onClose} title={<span><Bot size={16} /> Ask about this run</span>} subtitle="Answers use only what this run found, read and verified." width={560}
    footer={<form className="rc-form" onSubmit={(e) => { e.preventDefault(); void send(text); }}>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder={ready ? 'e.g. why did you rule out X? · what do I need to apply to Y? · draft the message to Z' : 'The AI model is not connected on the server.'} disabled={!ready || busy} aria-label="Your question"
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(text); } }} />
      <button className="x-btn primary" type="submit" disabled={!ready || busy || !text.trim()}><Send size={14} /> {busy ? 'Thinking…' : 'Send'}</button>
    </form>}>
    <div className="rc-log" aria-live="polite">
      {!msgs.length && <div className="rc-empty"><p>Ask anything about these results. The assistant checks the run before answering and says so when the run does not have the answer.</p>
        <div className="rc-sugg">{SUGGEST.map((s) => <button key={s} className="x-btn sm" onClick={() => void send(s)} disabled={!ready || busy}>{s}</button>)}</div></div>}
      {msgs.map((m, i) => <div key={i} className={`rc-msg ${m.role}`}>
        <p>{m.text}</p>
        {m.role === 'assistant' && <div className="rc-meta">
          {(m.cites || []).map((id) => <button key={id} className="rc-cite" onClick={() => onSelectLead(id)} title="Open this candidate">{name(id).slice(0, 48)}</button>)}
          <button className="rc-copy" onClick={() => void navigator.clipboard?.writeText(m.text)} title="Copy"><Copy size={12} /></button>
        </div>}
      </div>)}
      {busy && <div className="rc-msg assistant rc-busy"><p>Checking the run…</p></div>}
      {err && <p className="x-callout warn">{err}</p>}
      <div ref={end} />
    </div>
  </Drawer>;
}
