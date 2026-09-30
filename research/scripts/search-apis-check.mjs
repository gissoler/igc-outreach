// Comprueba cada API de búsqueda con UNA consulta real y el lector de Jina. No usa modelo.
// Uso: node --env-file-if-exists=.env scripts/search-apis-check.mjs ["consulta"]
import { PROVIDER_FN, PROVIDER_KEYS, searchProviders, jinaRead } from '../server/research/searchApis.mjs';

const query = process.argv[2] || 'MIT Solve Global Health Challenge 2027 apply';
const env = process.env;
let ok = 0;
console.log(`Consulta: "${query}"\n`);
for (const p of Object.keys(PROVIDER_KEYS)) {
  if (!searchProviders(env).includes(p)) { console.log(`- ${p.padEnd(7)} SIN CLAVE (${PROVIDER_KEYS[p]}) o excluido por ENGINE_SEARCH_PROVIDERS`); continue; }
  const at = Date.now();
  try {
    const rows = await PROVIDER_FN[p](query, { env, limit: 5 });
    ok++;
    const full = rows.filter((r) => r.markdown).length;
    console.log(`✔ ${p.padEnd(7)} ${rows.length} resultados (${full} con texto completo) · ${Date.now() - at} ms${rows.costUsd ? ` · US$${rows.costUsd}` : ''}`);
    for (const r of rows.slice(0, 3)) console.log(`     ${r.url}`);
  } catch (error) { console.log(`✖ ${p.padEnd(7)} ${error.message}`); }
}
if (env.JINA_API_KEY) {
  const page = await jinaRead('https://solve.mit.edu/challenges', { env });
  console.log(page ? `✔ jina reader  ${page.text.length} caracteres de ${page.url}` : '✖ jina reader  sin contenido');
}
console.log(`\n${ok} proveedor(es) respondieron.`);
process.exit(ok ? 0 : 1);
