// Compara dos modelos del asesor sobre el conjunto de test (backend/ml/data/advisor_test.jsonl).
//   node --env-file-if-exists=.env scripts/advisor-eval.mjs --a chat --b advisor-lora
// --a / --b: un rol de la flota (chat, small, reasoning) o el id de un adaptador LoRA (se sirve en el puerto de ADVISOR_ROLE o 'small').
// Métricas automáticas (las mismas reglas que corren en la app):
//   · cifras inventadas: números que no están en el input → la salida se descarta en producción
//   · refs inválidas (memos): párrafos que citan hallazgos que no existen
//   · longitud media
// Además escribe un CSV ciego (A/B barajado) para que Gisel elija la mejor salida por fila.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { chatJSON, fleetConfig } from '../server/analysis/fleet.mjs';
import { unsupportedNumbers, MEMO_SCHEMA, UPDATE_SCHEMA } from '../server/analysis/advisor.mjs';

const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const A = arg('--a', 'chat'), B = arg('--b', 'advisor-lora');
const file = resolve(arg('--data', '../backend/ml/data/advisor_test.jsonl'));
if (!existsSync(file)) { console.error(`No existe ${file}. Corre primero scripts/advisor-trainset.mjs.`); process.exit(1); }
const rows = readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const cfg = fleetConfig();
const target = (x) => (cfg.roles[x] ? { role: x } : { role: process.env.ADVISOR_ROLE || 'small', model: x });

async function run(x, r) {
  const t = target(x);
  const schema = r.kind === 'memo' ? MEMO_SCHEMA : UPDATE_SCHEMA;
  const { json } = await chatJSON({ system: r.messages[0].content, user: r.messages[1].content, schema, name: r.kind, temperature: 0, ...t });
  const text = r.kind === 'memo' ? `${json.headline}\n${(json.paragraphs || []).map((p) => p.text).join('\n')}` : `${json.subject}\n${json.body}`;
  const ids = new Set((r.messages[1].content.match(/\b[FP]\d+\b/g) || []));
  const badRefs = r.kind === 'memo' ? (json.paragraphs || []).filter((p) => !p.refs?.length || p.refs.some((id) => !ids.has(id))).length : 0;
  return { text, invented: unsupportedNumbers(text, r.messages[1].content).length > 0, badRefs, words: text.split(/\s+/).length };
}
const agg = { [A]: { n: 0, invented: 0, badRefs: 0, words: 0, errors: 0 }, [B]: { n: 0, invented: 0, badRefs: 0, words: 0, errors: 0 } };
const blind = [['id', 'kind', 'input', 'salida_1', 'salida_2', 'mejor (1/2/empate)', '_clave']];
for (const r of rows) {
  const out = {};
  for (const x of [A, B]) {
    try { const o = await run(x, r); out[x] = o; const g = agg[x]; g.n++; g.invented += o.invented; g.badRefs += o.badRefs; g.words += o.words; }
    catch (e) { agg[x].errors++; out[x] = { text: `ERROR: ${e.message}` }; }
  }
  const flip = Math.random() < 0.5;
  const [s1, s2] = flip ? [out[B], out[A]] : [out[A], out[B]];
  blind.push([r.id, r.kind, r.messages[1].content.slice(0, 3000), s1.text, s2.text, '', flip ? `1=${B}` : `1=${A}`]);
}
const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
const dir = resolve('../backend/eval/results'); mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().slice(0, 10);
writeFileSync(resolve(dir, `advisor_blind_${stamp}.csv`), blind.map((r) => r.map(q).join(',')).join('\n'));
console.log(`n = ${rows.length}`);
for (const [x, g] of Object.entries(agg)) console.log(`${x}: cifras inventadas ${g.invented}/${g.n} · refs inválidas ${g.badRefs} · palabras medias ${g.n ? Math.round(g.words / g.n) : '—'} · errores ${g.errors}`);
console.log(`Criterio: adoptar ${B} solo si inventa cifras en ≤ lo mismo que ${A} y gana (o empata) en la revisión ciega de ${dir}/advisor_blind_${stamp}.csv.`);
