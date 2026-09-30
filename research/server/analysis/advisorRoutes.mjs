// Rutas del agente asesor. Locales, sin envío de mensajes: la app redacta y registra; el fundador envía.
import { randomUUID } from 'node:crypto';
import { analyzeJob, composeIntro, composeUpdate, llmMemo, polishUpdate, validateUpdate, leadKeyOf, DEFAULT_CADENCE_DAYS, MEMO_SYSTEM, UPDATE_SYSTEM } from './advisor.mjs';
import { validateOutreach } from './outreach.mjs';
import { runDeep } from './agent/deepRun.mjs';
import { agentRole } from './agent/analyst.mjs';

const LABELS = ['aprobado', 'editado', 'rechazado'];

export function createAdvisorRoutes({ store, env = process.env, authUser, fetcher = fetch }) {
  const A = store.analysis;
  const active = new Map(); // userId → { runId, controller }
  const loadJob = (jobId, uid) => {
    const id = jobId || store.list(uid)[0]?.id;
    const job = id ? store.get(id) : null;
    if (!job || (job.userId && job.userId !== uid)) return null;
    return job;
  };
  const cadenceOf = (v) => (Number.isFinite(Number(v)) ? Math.max(30, Math.min(180, Number(v))) : DEFAULT_CADENCE_DAYS);
  const analysisFor = (job, uid, cadence) => analyzeJob(job, { events: A.outreachFor(uid), network: store.network(job.brief, uid), updates: A.updates(uid), cadenceDays: cadence });
  const recipientFor = (a, body) => {
    if (body.connectorKey) { const c = a.connectors.find((x) => x.key === body.connectorKey); return c ? { type: 'connector', ...c, person: c.name } : null; }
    const t = a.list.find((x) => x.leadKey === body.leadKey);
    return t ? { type: 'target', ...t } : null;
  };
  const logGeneration = (uid, kind, system, result) => {
    if (!result.input || !/^flota/.test(result.method || '')) return null;
    const g = { id: randomUUID(), userId: uid, kind, model: result.method.replace(/^flota \(|\)$/g, ''), system, input: result.input, output: kind === 'memo' ? JSON.stringify({ headline: result.headline, paragraphs: result.paragraphs }) : JSON.stringify({ subject: result.subject, body: result.body }), createdAt: new Date().toISOString() };
    A.saveGeneration(g);
    return g.id;
  };

  /* Starts the fleet analysis for a run. Shared by the manual button and by the automatic start after research.
     Resolves to { runId } once the first snapshot is saved, or { error, status, runId? } when it cannot start. */
  const startDeep = async ({ job, uid, refresh = false, samples = 1, maxContacts = 20, maxSteps = 6 }) => {
    if (!agentRole(env)) return { status: 409, error: 'No fleet model configured. Set VLLM_BASE and VLLM_CHAT_MODEL (or INTAKE_LLM_*) in research/.env.' };
    const key = uid || 'anon';
    if (active.has(key)) return { status: 409, error: 'An analysis is already running.', runId: active.get(key).runId };
    const controller = new AbortController();
    let runId = null;
    active.set(key, { runId: null, controller }); // reserved right away so two starts can't race
    const started = new Promise((ok) => {
      runDeep({ job, store, userId: uid, network: store.network(job.brief, uid), update: A.updates(uid)[0] || null, env, fetcher, signal: controller.signal, refresh, samples, maxContacts, maxSteps,
        save: (r) => { if (!runId) { runId = r.id; active.set(key, { runId, controller }); ok(r.id); } A.saveRun(r); } })
        .catch((e) => { if (runId) { const r = A.run(runId); if (r) A.saveRun({ ...r, status: 'failed', errors: [...(r.errors || []), { contact: 'orquestador', error: e.message }] }); } ok(runId); })
        .finally(() => active.delete(key));
    });
    return { status: 202, runId: await started };
  };

  async function handle(req, path, body, json, res, requestUrl) {
    if (!path.startsWith('/api/research/advisor')) return false;
    const uid = authUser(req)?.id || null;
    const q = requestUrl.searchParams;

    if (req.method === 'GET' && path === '/api/research/advisor') {
      const job = loadJob(q.get('jobId'), uid);
      if (!job) return json(404, { error: 'No evaluation to analyze. Run one first.' });
      return json(200, { ...analysisFor(job, uid, cadenceOf(q.get('cadence'))), updates: A.updates(uid).slice(0, 12) });
    }
    if (req.method === 'POST' && path === '/api/research/advisor/memo') {
      const job = loadJob(body.jobId, uid);
      if (!job) return json(404, { error: 'Evaluation not found.' });
      const memo = await llmMemo(analysisFor(job, uid, cadenceOf(body.cadence)), { env, fetcher });
      const generationId = logGeneration(uid, 'memo', MEMO_SYSTEM, memo);
      const { input, raw, ...pub } = memo;
      return json(200, { ...pub, generationId });
    }
    if (path === '/api/research/advisor/updates' && req.method === 'GET') return json(200, { updates: A.updates(uid) });
    if (path === '/api/research/advisor/updates' && req.method === 'POST') {
      try {
        const prev = body.id ? A.update(body.id) : null;
        if (prev && prev.userId !== uid) return json(404, { error: 'Update not found.' });
        const u = validateUpdate({ ...body, createdAt: prev?.createdAt }, { userId: uid });
        A.saveUpdate(u);
        return json(201, u);
      } catch (e) { return json(400, { error: e.message }); }
    }
    if (path === '/api/research/advisor/compose' && req.method === 'POST') {
      const job = loadJob(body.jobId, uid);
      if (!job) return json(404, { error: 'Evaluation not found.' });
      const update = body.updateId ? A.update(body.updateId) : A.updates(uid)[0];
      if (!update || update.userId !== uid) return json(400, { error: 'Fill in and save an update first.' });
      const a = analysisFor(job, uid, cadenceOf(body.cadence));
      const recipient = recipientFor(a, body);
      if (!recipient) return json(404, { error: 'Recipient not found in the shortlist or connectors.' });
      let draft = composeUpdate(update, recipient, { brief: job.brief });
      if (body.polish) draft = await polishUpdate(draft, { env, fetcher });
      const generationId = logGeneration(uid, 'update', UPDATE_SYSTEM, draft);
      const { input, rejected, ...pub } = draft;
      return json(200, { ...pub, generationId, recipient: { type: recipient.type, name: recipient.name } });
    }
    if (path === '/api/research/advisor/intro' && req.method === 'POST') {
      const job = loadJob(body.jobId, uid);
      if (!job) return json(404, { error: 'Evaluation not found.' });
      const a = analysisFor(job, uid, DEFAULT_CADENCE_DAYS);
      const connector = a.connectors.find((c) => c.key === body.connectorKey);
      const target = a.list.find((t) => t.leadKey === body.leadKey) || (connector && a.list.find((t) => t.leadKey === connector.targets[0]?.leadKey));
      if (!connector || !target) return json(404, { error: 'Connector or decision-maker not found.' });
      return json(200, { connector: connector.name, target: target.name, ...composeIntro({ connector, target, brief: job.brief, update: A.updates(uid)[0] || null, language: body.language === 'es' ? 'es' : 'en' }) });
    }
    if (path === '/api/research/advisor/sent' && req.method === 'POST') {
      const job = loadJob(body.jobId, uid);
      if (!job) return json(404, { error: 'Evaluation not found.' });
      const a = analysisFor(job, uid, DEFAULT_CADENCE_DAYS);
      const r = recipientFor(a, body);
      if (!r) return json(404, { error: 'Recipient not found.' });
      const channel = ['update', 'pedido_consejo', 'intro_advisor', 'cold_email'].includes(body.channel) ? body.channel : 'update';
      try {
        const e = validateOutreach({ fundName: r.org || r.name, person: r.person || r.name, channel, sentAt: body.sentAt, leadKey: r.leadKey || null, jobId: job.id, variant: body.generationId ? `gen:${String(body.generationId).slice(0, 8)}` : null, note: body.updateId ? `update ${body.updateId}` : '' }, { userId: uid });
        A.saveOutreach(e);
        return json(201, e);
      } catch (e) { return json(400, { error: e.message }); }
    }
    if (path === '/api/research/advisor/review' && req.method === 'POST') {
      const g = A.generation(String(body.generationId || ''));
      if (!g || g.user_id !== uid) return json(404, { error: 'Generation not found.' });
      if (!LABELS.includes(body.label)) return json(400, { error: `Invalid label (${LABELS.join(', ')}).` });
      if (body.label === 'editado' && (typeof body.final !== 'string' || !body.final.trim())) return json(400, { error: 'Missing edited text.' });
      A.reviewGeneration(g.id, { label: body.label, final: body.label === 'editado' ? body.final.slice(0, 20000) : null });
      return json(200, { ok: true });
    }
    // Análisis profundo: agentes de la flota (analista por contacto → estratega → crítico)
    if (path === '/api/research/advisor/deep' && req.method === 'POST') {
      const job = loadJob(body.jobId, uid);
      if (!job) return json(404, { error: 'Evaluation not found.' });
      const r = await startDeep({ job, uid, refresh: Boolean(body.refresh), samples: Math.max(1, Math.min(3, Number(body.samples) || 1)), maxContacts: Math.max(1, Math.min(25, Number(body.maxContacts) || 20)), maxSteps: Math.max(2, Math.min(10, Number(body.maxSteps) || 6)) });
      if (r.error) return json(r.status, { error: r.error, ...(r.runId ? { runId: r.runId } : {}) });
      return json(202, { runId: r.runId });
    }
    if (path === '/api/research/advisor/deep' && req.method === 'GET') {
      const job = loadJob(q.get('jobId'), uid);
      if (!job) return json(404, { error: 'Evaluation not found.' });
      return json(200, { run: A.latestRun(uid, job.id), role: agentRole(env), running: active.has(uid || 'anon') });
    }
    const dm = path.match(/^\/api\/research\/advisor\/deep\/([\w-]{8,64})(\/cancel)?$/);
    if (dm) {
      const r = A.run(dm[1]);
      if (!r || r.userId !== uid) return json(404, { error: 'Analysis not found.' });
      if (dm[2] && req.method === 'POST') { const a = active.get(uid || 'anon'); if (a?.runId === r.id) a.controller.abort(); return json(200, { ok: true }); }
      return json(200, { run: r, running: active.get(uid || 'anon')?.runId === r.id });
    }
    if (path === '/api/research/advisor/dossier/feedback' && req.method === 'POST') {
      if (!['util', 'corregir', 'equivocada'].includes(body.verdict)) return json(400, { error: 'Invalid verdict (util, corregir, equivocada).' });
      const ok = A.dossierFeedback(uid, String(body.key || ''), { verdict: body.verdict, note: String(body.note || '').slice(0, 2000), at: new Date().toISOString() });
      return ok ? json(200, { ok: true }) : json(404, { error: 'Card not found.' });
    }
    if (path === '/api/research/advisor/edges' && req.method === 'GET') return json(200, { edges: A.edgeJudgments(uid).slice(0, 200) });
    if (path === '/api/research/advisor/edge/label' && req.method === 'POST') {
      const strength = Number(body.strength);
      if (!Number.isFinite(strength) || strength < 0 || strength > 1) return json(400, { error: 'strength must be between 0 and 1.' });
      const ok = A.labelEdge(String(body.id || ''), uid, { strength, would_introduce: ['probable', 'incierto', 'improbable'].includes(body.would_introduce) ? body.would_introduce : null, note: String(body.note || '').slice(0, 500), at: new Date().toISOString() });
      return ok ? json(200, { ok: true }) : json(404, { error: 'Judgment not found.' });
    }
    if (path === '/api/research/advisor/trainset' && req.method === 'GET') {
      const rows = A.generations({ reviewed: true });
      const count = (k, l) => rows.filter((r) => r.kind === k && r.label === l).length;
      return json(200, { memo: { aprobado: count('memo', 'aprobado'), editado: count('memo', 'editado'), rechazado: count('memo', 'rechazado') }, update: { aprobado: count('update', 'aprobado'), editado: count('update', 'editado'), rechazado: count('update', 'rechazado') }, total: A.generations().length, note: 'Export with scripts/advisor-trainset.mjs. With < 200 approved or edited examples, don\'t train: use the prompt.' });
    }
    return json(404, { error: 'Advisor route not found.' });
  }

  /* Automatic start: when a research run ends with candidates, the advisor begins on its own so the
     action plan is waiting when the person opens it. Off with ADVISOR_AUTO=0. Never throws. */
  handle.autoStart = async (job) => {
    try {
      if (!job || String(env.ADVISOR_AUTO || '1') === '0') return null;
      if (!['done', 'partial'].includes(job.status)) return null;
      if (!(job.leads || []).some((l) => l.bucket !== 'discarded')) return null;
      const uid = job.userId || null;
      if (A.latestRun(uid, job.id)) return null; // already analyzed (or being analyzed)
      const r = await startDeep({ job, uid });
      return r.runId || null;
    } catch { return null; }
  };
  return handle;
}
export { leadKeyOf };
