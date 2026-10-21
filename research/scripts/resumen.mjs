import fs from 'node:fs';
const dir = process.argv[2];
const norm = u => String(u||'').toLowerCase().replace(/^https?:\/\/(www\.)?/,'').replace(/[#?].*$/,'').replace(/\/$/,'');
const host = u => norm(u).split('/')[0];
const walk = (o,f) => { if (Array.isArray(o)) o.forEach(x=>walk(x,f)); else if (o && typeof o==='object') { f(o); Object.values(o).forEach(x=>walk(x,f)); } };
const cut = (s,n=160) => { s = typeof s==='string' ? s : JSON.stringify(s); return s.length>n ? s.slice(0,n)+'…' : s; };
const KEYS = ['finalists','findings','verified','recommended'];
let md = '# Resumen de corridas\n';
for (const d of fs.readdirSync(dir).filter(x=>/^RD-\d+/.test(x)).sort()) {
  const read = f => { try { return fs.readFileSync(`${dir}/${d}/${f}`,'utf8'); } catch { return ''; } };
  const ev = read('events.jsonl').split('\n').filter(Boolean).map(l=>{try{return JSON.parse(l)}catch{return null}}).filter(Boolean);
  let res = {}; try { res = JSON.parse(read('result.json')); } catch {}
  const kept = new Set();
  const collect = o => walk(o, x => { for (const k of KEYS) if (Array.isArray(x[k])) walk(x[k], y => { if (typeof y.url==='string') kept.add(norm(y.url)); }); });
  collect(res); ev.filter(e=>e.type==='finish').forEach(collect);
  const keptHosts = new Set([...kept].map(host));
  const start = ev.find(e=>e.type==='run_start');
  md += `\n---\n## ${d} · ${start?.objective || ''}\n\n### Brief\n`;
  for (const [k,v] of Object.entries(start?.brief || {})) md += `- **${k}:** ${cut(v,300)}\n`;
  const by = {};
  for (const e of ev.filter(e=>e.type==='tool_call')) {
    const t = e.tool || '?'; const g = by[t] ||= { q: [], urls: new Set() };
    g.q.push(`${cut(e.args?.query ?? e.args?.q ?? e.args?.keywords ?? e.args, 110)} (${e.results_n ?? '?'})`);
    (e.urls || []).forEach(u => g.urls.add(u));
  }
  md += `\n### Fuentes y queries (★ = se quedó en el resultado)\n`;
  for (const [t,g] of Object.entries(by)) {
    const k = [...g.urls].filter(u => kept.has(norm(u)));
    md += `\n**${t}** — ${g.q.length} consultas, ${g.urls.size} URLs, ${k.length} elegidas\n`;
    [...new Set(g.q)].slice(0,15).forEach(q => md += `- ${q}\n`);
    k.forEach(u => md += `  - ★ ${u}\n`);
  }
  const ap = ev.filter(e=>e.type==='apollo_stage' && e.called);
  if (ap.length) {
    md += `\n**apollo (post_judge)** — ${ap.length} organizaciones consultadas\n`;
    ap.forEach(e => md += `- ${[...keptHosts].some(h=>h===e.domain||h.endsWith('.'+e.domain)) ? '★ ' : ''}${e.domain} · ${e.status} · ${e.people_n ?? 0} personas · ${e.credits} créditos\n`);
  }
  md += `\n**Elegidas en total:** ${kept.size}. Detalle y recomendaciones: ${d}/report.md\n`;
  if (!kept.size) md += `> No encontré la lista de elegidas en result.json. Claves: ${Object.keys(res).join(', ')}\n`;
}
fs.writeFileSync(`${dir}/resumen.md`, md);
console.log(`Listo: ${dir}/resumen.md`);
