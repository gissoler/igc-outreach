/* Piezas puras del reporte de una corrida (P0.8): embudo, modelos realmente usados según la traza, proveedores
   (con los apagados aparte) y el pie, que solo afirma verificación si hubo lecturas exitosas. Sin red ni archivos. */

const PURPOSE_OF_ROLE = { agent: 'step', compiler: 'assess', judge: 'judge', understand: 'understand' };
const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

/** Modelos que de verdad respondieron (o fueron llamados) por propósito, contados desde los eventos model_call. */
export function modelsUsed(events = []) {
  const out = {};
  for (const e of events) {
    if (e.type !== 'model_call') continue;
    const purpose = e.purpose || PURPOSE_OF_ROLE[e.role] || e.role; const row = (out[purpose] ||= { calls: 0, ok: 0, models: {}, roles: {} });
    row.calls++; if (e.ok) row.ok++; row.models[e.model] = (row.models[e.model] || 0) + 1; row.roles[e.role] = (row.roles[e.role] || 0) + 1;
  }
  return out;
}

/** Embudo por objetivo: páginas abiertas → leídas por el modelo (ok / mínimo) → sin lectura → candidatas → finalistas → hallazgos. */
export function funnelOf(audits = [], findings = []) {
  return audits.map((a) => {
    const agent = Boolean(a.agent?.on);
    const readOk = agent ? Number(a.reads?.ok ?? a.read) || 0 : Number(a.read) || 0; const readMin = agent ? Number(a.reads?.ok_min) || 0 : 0;
    return { objective: a.objective, agent, pages_opened: Number(a.pages) || 0, read_ok: readOk, read_min: readMin, unread: Number(a.unread) || 0, retried: Number(a.reads?.retried) || 0,
      candidates: agent ? Number(a.candidates) || 0 : null, finalists: agent ? Number(a.judge?.finalists) || 0 : null, findings: Number(a.kept) || 0,
      apply: findings.filter((f) => f.objective === a.objective && f.verdict === 'apply').length };
  });
}
export const anyRead = (funnel = []) => funnel.some((f) => f.read_ok + f.read_min > 0);

/** Proveedores de búsqueda desde la traza; un proveedor apagado (saldo/clave) va aparte y no suma errores al resto. */
export function providerRows(events = []) {
  const rows = {}; const off = {};
  for (const e of events) {
    if (e.type === 'provider_disabled') off[e.provider] = e.reason;
    if (e.type !== 'tool_call' || e.tool !== 'search' || !e.provider) continue;
    const r = (rows[e.provider] ||= { calls: 0, results: 0, errors: 0, ms: 0, cost_usd: 0 });
    r.calls++; r.results += Number(e.results_n) || 0; r.errors += e.error ? 1 : 0; r.ms += Number(e.ms_call) || 0; r.cost_usd += Number(e.cost_usd) || 0;
  }
  for (const [p, reason] of Object.entries(off)) (rows[p] ||= { calls: 0, results: 0, errors: 0, ms: 0, cost_usd: 0 }).disabled = reason;
  const active = Object.entries(rows).filter(([, r]) => !r.disabled);
  return { rows, active_errors: active.reduce((n, [, r]) => n + r.errors, 0), active_calls: active.reduce((n, [, r]) => n + r.calls, 0), disabled: off };
}

/** Pie del reporte. Sin ninguna lectura exitosa no se afirma verificación: se dice qué falló. */
export function footerFor(funnel = [], findings = []) {
  if (!anyRead(funnel)) {
    const opened = funnel.reduce((n, f) => n + f.pages_opened, 0); const unread = funnel.reduce((n, f) => n + f.unread, 0);
    return `> Ninguna página fue leída con éxito por el modelo (${opened} abiertas, ${unread} sin lectura): este reporte no contiene verificaciones. Cero hallazgos aquí es un fallo operativo, no evidencia de que no existan oportunidades. Ver el embudo y \`events.jsonl\`.`;
  }
  return findings.length
    ? '> Todo lo listado pasó la verificación en código (cita literal en la página, fecha contra hoy, sin agregadores ni redes). Lo que no aparece aquí no se pudo verificar; no se inventa.'
    : '> Hubo lecturas exitosas, pero ninguna página pasó la verificación en código. Ver el embudo, las páginas sin lectura y `events.jsonl`.';
}

/** Líneas markdown del embudo, páginas sin lectura y Apollo. */
export function funnelLines(funnel = [], audits = []) {
  const lines = ['## Embudo', '', '| Objetivo | Páginas abiertas | Leídas por el modelo | Lectura mínima | Sin lectura | Reintentos | Candidatas | Finalistas (juez) | Hallazgos | apply |', '|---|---|---|---|---|---|---|---|---|---|',
    ...funnel.map((f) => `| ${f.objective} | ${f.pages_opened} | ${f.read_ok} | ${f.read_min} | ${f.unread} | ${f.retried} | ${f.candidates ?? '—'} | ${f.finalists ?? '—'} | **${f.findings}** | ${f.apply} |`)];
  const unread = audits.flatMap((a) => (a.unread_by_model || []).map((u) => ({ ...u, objective: a.objective })));
  if (unread.length) lines.push('', `## Páginas sin lectura del modelo (${unread.length})`, '', '| Ref | Razón | Reintento mínimo | Forma (código) | Avisos (código) | Plazos (código) | URL |', '|---|---|---|---|---|---|---|',
    ...unread.map((u) => `| ${u.page_ref} | ${esc(u.reason)} | ${u.retried ? (u.retried.ok ? 'ok' : esc(u.retried.reason)) : 'no'} | ${esc(u.triage?.structure?.kind)} | ${esc((u.triage?.banners || []).map((b) => b.kind).join(', ')) || '—'} | ${esc((u.triage?.dates || []).filter((d) => /deadline/.test(d.role)).map((d) => `${d.date}${d.past ? ' (pasada)' : ''}`).join(', ')) || '—'} | ${u.url} |`));
  const apollo = audits.filter((a) => a.apollo);
  if (apollo.length) lines.push('', '## Apollo', '', ...apollo.map((a) => `- ${a.objective}: etapa \`${a.apollo.stage}\` · activado ${a.apollo.enabled ? 'sí' : 'no'} · configurado ${a.apollo.configured ? 'sí' : 'no'} · elegibles ${a.apollo.eligible} · llamadas ${a.apollo.called} · créditos ${a.apollo.credits}/${a.apollo.cap}${Object.keys(a.apollo.reasons || {}).length ? ` · razones de no llamada: ${Object.entries(a.apollo.reasons).map(([k, v]) => `${k} ${v}`).join(', ')}` : ''}`));
  return lines;
}
