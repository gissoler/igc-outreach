// V9 (solo relectura): páginas de listas de los 12 casos desde las cachés existentes, sin red.
//  - diag: resultados Exa de las 2 consultas de listas del diagnóstico v8 (10 resultados, texto ≤ 10.000 caracteres), p01–p12.
//  - full: páginas completas que abrió la fase de listas de la corrida v8 (p01–p06), de la caché de la corrida.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openReadOnlyCache } from '../../cache-layers.v7.mjs';
import { exaKey } from '../../exa-direct.v8.mjs';
import { normalizeUrl } from '../../../../agent/docs.mjs';
import { loadCase, listQueries, nameIn, host, sameSite, CASES_A, CASES_B, GOLD_ALIASES } from '../v8/queries.v8.mjs';
export { loadCase, nameIn, host, sameSite, CASES_A, CASES_B, GOLD_ALIASES, listQueries };
export const OUT = resolve(import.meta.dirname, '../../out');
export const DIAG = resolve(OUT, 'v8-diagnostico-2026-10-12'), V8 = resolve(OUT, 'investors-internal-2026-10-12-v8'), V7 = resolve(OUT, 'investors-internal-2026-10-12-v7');
export const readEvents = dir => readFileSync(resolve(dir, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
let _diag = null, _v8 = null, _v8ev = null;
const diag = () => (_diag ??= openReadOnlyCache({ path: resolve(DIAG, 'cache.sqlite'), namespace: 'v8-diagnostico' }));
export const v8cache = () => (_v8 ??= openReadOnlyCache({ path: resolve(V8, 'cache.sqlite'), namespace: 'investors-investors-internal-2026-10-12-v8' }));
export const v8events = () => (_v8ev ??= readEvents(V8));
/** Resultados Exa de las 2 consultas de listas del diagnóstico: [{query, rank, url, title, text}] */
export function diagListRows(c) {
  const k = loadCase(c);
  return listQueries(k.fields).flatMap(query => (diag().get('exa_v8', exaKey({ query, numResults: 10, textChars: 10000 }))?.value ?? []).map(r => ({ query, ...r })));
}
/** Páginas completas de lista abiertas en v8 para el caso (únicas), con texto. */
export function v8ListPages(c) {
  const tag = `syn-${c}__`, ev = v8events();
  const opened = ev.filter(e => e.event === 'search_opened' && e.origin === 'list_discovery' && e.run_id.includes(tag));
  const urls = [...new Set(opened.flatMap(o => o.opened.map(i => o.urls[i])))];
  return urls.map(url => ({ url, text: v8cache().get('fetch', normalizeUrl(url))?.value?.text ?? '' })).filter(p => p.text.length >= 200);
}
/** Todos los URL de resultados de las consultas de listas en v8 (10 por consulta). */
export function v8ListResultUrls(c) {
  const tag = `syn-${c}__`;
  return [...new Set(v8events().filter(e => e.event === 'search_opened' && e.origin === 'list_discovery' && e.run_id.includes(tag)).flatMap(o => o.urls))];
}
export function closeAll() { _diag?.close(); _v8?.close(); _diag = _v8 = null; }
