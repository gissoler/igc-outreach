// Genera la plantilla de etiquetado manual a partir de las corridas V13 y la línea base. Uso: node gold.mjs <research> <salida.csv>
import { readFileSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
const [root, outPath] = process.argv.slice(2);
const runs = root + '/eval/runs/';
const load = (d) => JSON.parse(readFileSync(runs + d + '/result.json', 'utf8'));
const db = new DatabaseSync(root + '/data/firecrawl-cache.sqlite', { readOnly: true });
const cachedUrls = new Set(db.prepare("select url from firecrawl_cache where kind like 'scrape%'").all().map((r) => String(r.url || '').replace(/\/$/, '')));
const inCache = (u) => cachedUrls.has(String(u).replace(/\/$/, ''));
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const FUND = /raise|raised|lands|wins|award|grant to|secures|funding round|seed|series [ab]|closes \$|\$\d/i;
const rows = []; const seen = new Set();
const add = (run, x, origen) => {
  const k = String(x.url).replace(/\/$/, ''); if (seen.has(k)) return; seen.add(k);
  const m = x.read?.out || {}; const j = x.judge || {};
  const citas = [m.quotes?.identity, m.quotes?.eligible, m.quotes?.deadline, ...Object.values(j.criteria || {}).map((c) => c.quote), ...((j.dates?.judge) || []).map((d) => d.quote)].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(' || ').slice(0, 1500);
  rows.push({ id: `p${String(rows.length + 1).padStart(3, '0')}`, corrida: run, origen, url: x.url, titulo: x.title || '', host: host(x.url),
    decision_sistema: x.drop || x.verdict || '', juez_estado: j.state || '', juez_cierre: j.deadline || '', lector_tipo_pagina: m.page_type || '', lector_kind: m.kind || '',
    texto_chars: x.textChars ?? '', texto_en_cache_firecrawl: inCache(x.url) ? 'si' : 'no', resumen_lector: (m.summary || '').slice(0, 600), citas_guardadas: citas });
};
const r2 = load('2026-10-13-23-09-v13-jefe-2'); const r1 = load('2026-10-13-22-44-v13-jefe'); const r0 = load('2026-10-13-19-37-repro-jefe');
for (const x of r2.audits[0].traces) if (x.judge) add('2026-10-13-23-09-v13-jefe-2', x, 'leida_v13');
for (const f of r0.findings || []) add('2026-10-13-19-37-repro-jefe', { ...f.trace, url: f.url, title: f.title, verdict: f.verdict }, 'verificada_linea_base');
const aggs = [...r2.audits[0].traces, ...r1.audits[0].traces, ...r0.audits[0].traces].filter((x) => x.drop === 'aggregator' && !x.read?.out);
for (const x of aggs.filter((x) => FUND.test(x.title || ''))) if (rows.length < 100) add('agregador_sin_leer', x, 'agregador_con_senal_de_financiacion');
for (const x of aggs) if (rows.length < 100) add('agregador_sin_leer', x, 'agregador_sin_leer');
const LABELS = ['et_es_convocatoria', 'et_tipo_pagina', 'et_fecha_cierre', 'et_cita_fecha', 'et_estado_hoy', 'et_elegible_entidad', 'et_region', 'et_etapa', 'et_encaje', 'et_oficial', 'et_no_dilutivo', 'et_es_pista', 'et_financiador_pista', 'et_veredicto', 'et_nota', 'et_quien', 'et_fecha_etiquetado'];
// Archivo para etiquetar: a ciegas (sin la decisión del sistema). Archivo del sistema: mismas filas por id, para medir después.
const BLIND = ['id', 'url', 'titulo', 'host', 'texto_chars', 'texto_en_cache_firecrawl', 'citas_guardadas'];
const SYS = ['id', 'corrida', 'origen', 'url', 'decision_sistema', 'juez_estado', 'juez_cierre', 'lector_tipo_pagina', 'lector_kind', 'resumen_lector'];
const q = (v) => `"${String(v ?? '').replace(/"/g, '""').replace(/\s+/g, ' ').trim()}"`;
const order = rows.map((r, i) => [r, (i * 37) % rows.length]).sort((a, b) => a[1] - b[1]).map(([r]) => r);   // orden mezclado y fijo
writeFileSync(outPath, [[...BLIND, ...LABELS].join(','), ...order.map((r) => [...BLIND.map((c) => q(r[c])), ...LABELS.map(() => '""')].join(','))].join('\n') + '\n');
const sysPath = process.argv[4] || outPath.replace(/\.csv$/, '.sistema.csv');
writeFileSync(sysPath, [SYS.join(','), ...rows.map((r) => SYS.map((c) => q(r[c])).join(','))].join('\n') + '\n');
const c = {}; for (const r of rows) c[r.origen] = (c[r.origen] || 0) + 1;
console.log('filas', rows.length, JSON.stringify(c), 'en caché firecrawl', rows.filter((r) => r.texto_en_cache_firecrawl === 'si').length, '→', outPath, sysPath);
