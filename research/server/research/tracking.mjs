/* Seguimiento de un candidato guardado. Distingue actividades propuestas, programadas y realizadas:
   generar un borrador o un plan NO cuenta como contacto. Solo una actividad «done» cuenta como interacción. */
const STATUSES = ['to_research', 'to_contact', 'contacted', 'in_conversation', 'paused', 'discarded'];
const KINDS = ['proposed', 'scheduled', 'done'];
const str = (v, n = 300) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const day = (v) => { const s = str(v, 10); if (!s) return ''; if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error('Dates must be YYYY-MM-DD.'); return s; };
export function validateTracking(input, key, existing = null, now = new Date().toISOString()) {
  if (!input || typeof input !== 'object') throw new Error('Invalid item.');
  const status = input.status ?? existing?.status ?? 'to_research';
  if (!STATUSES.includes(status)) throw new Error('Invalid status.');
  const activities = (Array.isArray(input.activities) ? input.activities : existing?.activities || []).slice(0, 200).map((a) => {
    if (!KINDS.includes(a?.kind)) throw new Error('Activity kind must be proposed, scheduled or done.');
    return { id: str(a.id, 60) || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, kind: a.kind, text: str(a.text, 500), date: day(a.date), at: str(a.at, 30) || now };
  });
  const notes = (Array.isArray(input.notes) ? input.notes : existing?.notes || []).slice(0, 200).map((n) => ({ text: str(n?.text, 1000), at: str(n?.at, 30) || now })).filter((n) => n.text);
  const done = activities.filter((a) => a.kind === 'done').map((a) => a.date || a.at.slice(0, 10)).sort();
  return {
    key, jobId: str(input.jobId ?? existing?.jobId, 60), leadId: str(input.leadId ?? existing?.leadId, 200), name: str(input.name ?? existing?.name, 200), org: str(input.org ?? existing?.org, 200),
    owner: str(input.owner ?? existing?.owner, 120), status, nextAction: str(input.nextAction ?? existing?.nextAction, 300), nextDate: day(input.nextDate ?? existing?.nextDate),
    lastInteraction: done.at(-1) || null, notes, activities, createdAt: existing?.createdAt || now, updatedAt: now,
  };
}
