#!/usr/bin/env node
// Uso: node scripts/judge-report.mjs eval/runs/<carpeta> [--only open|closed|forecast|upcoming|unknown|unverified] [--url texto]
// Escribe <carpeta>/judge-razonamiento.md: por página, lo que dijeron compilador y juez, la cita y lo que decidió el código.
// Solo lee result.json; no llama a ningún modelo.
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith('--'));
const opt = (k) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : null; };
if (!dir) { console.error('Falta la carpeta de la corrida.'); process.exit(1); }
const only = opt('only'); const urlPart = opt('url');
const result = JSON.parse(fs.readFileSync(path.join(dir, 'result.json'), 'utf8'));
const s = (v, n = 400) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const out = [`# Razonamiento del juez · ${s(result.brief?.company || result.brief?.organization)} · hoy=${result.today}`, ''];
for (const au of result.audits || []) {
  const traces = (au.traces || []).filter((t) => !urlPart || String(t.url).includes(urlPart));
  const judged = traces.filter((t) => t.judge && (!only || t.judge.state === only));
  const unread = traces.filter((t) => !t.judge);
  out.push(`## ${au.objective}: ${judged.length} páginas leídas por compilador y juez${only ? ` (estado ${only})` : ''}; ${unread.length} descartadas o sin leer antes del juez`, '');
  for (const t of judged) {
    const j = t.judge;
    out.push(`### ${s(t.title, 110) || s(t.url, 110)}`, `- URL: ${t.url}`,
      `- Tipo de página: juez ${j.pageType?.judge ?? '-'} · compilador ${j.pageType?.compiler ?? '-'}`,
      `- Estado por código: ${j.state}${j.deadline ? ` · cierre ${j.deadline}` : ''}${j.estimatedDeadline ? ` · cierre estimado ${j.estimatedDeadline}` : ''}${j.daysLeft != null ? ` · ${j.daysLeft} días` : ''}`,
      `- Resultado: ${t.drop || j.dropReason ? `descartada (${t.drop || j.dropReason})` : t.verdict || '-'}`);
    for (const [id, c] of Object.entries(j.criteria || {})) out.push(`- ${id}: **${c.verdict}** · ${s(c.reason, 300)}${c.quote ? ` · cita: «${s(c.quote, 220)}»${c.quoteOk === false ? ' [la cita NO está literal en la página]' : ''}` : ''}${c.compiler === 'disagree' ? ' · el juez contradice al compilador' : ''}`);
    const ds = (j.dates?.judge || []).filter((d) => d.date);
    if (ds.length) out.push(`- Fechas del juez: ${ds.map((d) => `${d.role} ${d.date}${d.estimated ? ' (estimada)' : ''}${d.verified ? '' : ' [sin cita válida]'}`).join(' · ')}`);
    if ((j.disagreements || []).length) out.push(`- Desacuerdos: ${j.disagreements.map((x) => s(x, 160)).join(' | ')}`);
    if ((j.blockers || []).length) out.push(`- Bloqueos para la lista principal: ${j.blockers.map((x) => s(x, 160)).join(' | ')}`);
    out.push('');
  }
  if (!only) {
    out.push('### Descartadas o sin leer antes del juez', '');
    for (const t of unread) out.push(`- ${s(t.url, 140)} · ${t.drop || t.verdict || '-'}${t.note ? ` · ${s(t.note, 90)}` : ''}`);
    out.push('');
  }
}
const file = path.join(dir, 'judge-razonamiento.md');
fs.writeFileSync(file, out.join('\n'));
console.log(`Escrito ${file}`);
