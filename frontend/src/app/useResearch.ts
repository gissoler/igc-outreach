/* Ciclo de vida de una evaluación: historial, carga, ejecución en vivo (SSE con sondeo de
   respaldo), detención y feedback. Mismo contrato que Research.tsx, pero sin arrancar una
   investigación nueva (ni consumir crédito) solo por abrir la aplicación. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, subscribeRun, type Brief, type Feedback, type History, type Job } from '../researchApi';
import { mergeEvents, type LiveRunEvent } from '../liveRunModel';
import type { RunConnection } from '../LiveAgentRun';

const KEY = (userId: string) => `igc-eval-job:${userId}`;
const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string | null) => { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch { /* sin almacenamiento */ } };
export const errorText = (e: unknown, action = '') => e instanceof ApiError ? `${action ? `${action} ` : ''}(HTTP ${e.status}): ${e.message}${e.detail ? ` ${e.detail}` : ''}` : `${action ? `${action}: ` : ''}${e instanceof Error ? e.message : 'The request failed.'}`;

export type ResearchState = ReturnType<typeof useResearch>;
export function useResearch(userId: string) {
  const [history, setHistory] = useState<History | null>(null);
  const [historyError, setHistoryError] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [events, setEvents] = useState<{ jobId: string | null; list: LiveRunEvent[] }>({ jobId: null, list: [] });
  const [connection, setConnection] = useState<RunConnection>('idle');
  const [attempt, setAttempt] = useState(0);
  const generation = useRef(0);

  const loadHistory = useCallback(async () => {
    try { const h = await api<History>('/jobs'); setHistory(h); setHistoryError(''); return h; }
    catch (e) { setHistoryError(errorText(e, 'Couldn\'t load history')); setHistory((h) => h || []); return null; }
  }, []);

  // Al entrar: la última evaluación abierta en este navegador, o la más reciente de la cuenta.
  useEffect(() => {
    let alive = true;
    void loadHistory().then((h) => {
      if (!alive || !h) return;
      const remembered = read(KEY(userId));
      const pick = h.find((x) => x.id === remembered)?.id || h.find((x) => ['done', 'partial'].includes(x.status) && (x.leads ?? 1) > 0)?.id || h.find((x) => ['done', 'partial'].includes(x.status))?.id || h[0]?.id || null;
      setJobId(pick);
    });
    return () => { alive = false; };
  }, [userId, loadHistory]);

  useEffect(() => {
    if (!jobId) { setJob(null); return; }
    write(KEY(userId), jobId);
    const gen = ++generation.current;
    const alive = () => gen === generation.current;
    let timer: ReturnType<typeof setTimeout>;
    let close: (() => void) | null = null;
    const add = (incoming: LiveRunEvent[]) => setEvents((r) => r.jobId === jobId ? { jobId, list: mergeEvents(r.list, incoming) } : { jobId, list: mergeEvents([], incoming) });
    const poll = async (fallback: boolean) => {
      try {
        const result = await api<Job>(`/jobs/${jobId}`);
        if (!alive()) return;
        setJob(result); setError(''); setLoading(false);
        add(result.run?.events || []);
        if (!['running', 'queued'].includes(result.status)) { setConnection('closed'); if (fallback) void loadHistory(); return; }
        if (!fallback && typeof EventSource !== 'undefined') {
          setConnection('connecting');
          close = subscribeRun(jobId, {
            onSnapshot: (s) => { if (alive()) { add(s.events); setConnection('live'); } },
            onEvent: (ev) => { if (alive()) add([ev]); },
            onReconnecting: () => { if (alive()) setConnection('reconnecting'); },
            onEnd: () => { close = null; if (alive()) void poll(true); },
            onFailure: () => { close = null; if (alive()) { setConnection('polling'); void poll(true); } },
          });
        } else { setConnection('polling'); timer = setTimeout(() => void poll(true), 1500); }
      } catch (e) {
        if (!alive()) return;
        setLoading(false);
        if (e instanceof ApiError && e.status === 404) { write(KEY(userId), null); setJob(null); setJobId(null); setError('That evaluation is no longer available.'); return; }
        setError(errorText(e, 'Couldn\'t load the evaluation'));
        timer = setTimeout(() => void poll(fallback), 5000);
      }
    };
    setLoading(true);
    void poll(false);
    return () => { ++generation.current; clearTimeout(timer); close?.(); };
  }, [jobId, attempt, userId, loadHistory]);

  const start = useCallback(async (brief: Brief) => {
    setStarting(true); setError('');
    try {
      const r = await api<{ jobId: string }>('/jobs', brief);
      setJob(null); setEvents({ jobId: r.jobId, list: [] }); setJobId(r.jobId);
      void loadHistory();
      return r.jobId;
    } catch (e) { setError(errorText(e, 'Couldn\'t start the evaluation')); return null; }
    finally { setStarting(false); }
  }, [loadHistory]);
  const stop = useCallback(async () => {
    if (!jobId) return;
    setStopping(true);
    try { await api(`/jobs/${jobId}/cancel`, {}, 'POST'); setAttempt((a) => a + 1); }
    catch (e) { setError(errorText(e, 'Couldn\'t stop the evaluation')); }
    finally { setStopping(false); }
  }, [jobId]);
  const feedback = useCallback(async (leadId: string, decision: 'approve' | 'reject', reason: string, note: string) => {
    if (!jobId) throw new Error('No active evaluation.');
    const value = await api<Feedback>(`/jobs/${jobId}/feedback`, { leadId, decision, reason: decision === 'approve' ? 'relevant' : reason, note });
    setJob((j) => j && ({ ...j, leads: j.leads.map((l) => l.id === leadId ? { ...l, feedback: value } : l) }));
    return value;
  }, [jobId]);

  const running = !!job && ['queued', 'running'].includes(job.status);
  return {
    history, historyError, jobId, job, loading, error, starting, stopping, running, connection,
    events: events.jobId === jobId ? events.list : [],
    select: (id: string) => { if (id !== jobId) { setJob(null); setJobId(id); } },
    retry: () => setAttempt((a) => a + 1), start, stop, feedback, reloadHistory: loadHistory, clearError: () => setError(''),
  };
}
