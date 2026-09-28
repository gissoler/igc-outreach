// Exporta lo que aprobaste, editaste o rechazaste en el Asesor como datos de entrenamiento para la flota.
//   node --env-file-if-exists=.env scripts/advisor-trainset.mjs            → backend/ml/data/advisor_{sft,dpo,test}.jsonl
//   node scripts/advisor-trainset.mjs --stats                              → solo conteos
// SFT: (system, input, salida aprobada o tu edición). DPO: (input, elegida = tu edición, rechazada = salida del modelo).
// El 15 % de los inputs (división estable por hash) queda como test y nunca entra al entrenamiento.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { createStore } from '../server/research/store.mjs';

createStore(resolve(process.env.RESEARCH_DB || 'data/research.sqlite')).close?.(); // crea las tablas si faltan
const db = new DatabaseSync(resolve(process.env.RESEARCH_DB || 'data/research.sqlite'), { readOnly: true });
const rows = db.prepare("SELECT * FROM advisor_generations WHERE label IS NOT NULL ORDER BY created_at").all().filter((r) => r.kind !== 'dossier' || r.label);
const outDir = resolve(process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : '../backend/ml/data');
const split = (input) => (parseInt(createHash('sha1').update(input).digest('hex').slice(0, 6), 16) % 100 < 15 ? 'test' : 'train');

// Las salidas del modelo son JSON (esquema de la app); las ediciones llegan como texto. Se llevan al mismo formato.
function editedToJson(r, text) {
  if (r.kind === 'update') {
    const m = text.match(/^Asunto:\s*(.*)\n+([\s\S]*)$/);
    return JSON.stringify(m ? { subject: m[1].trim(), body: m[2].trim() } : { subject: JSON.parse(r.output).subject, body: text.trim() });
  }
  const orig = JSON.parse(r.output);
  const [headline, ...paras] = text.split(/\n{2,}/).map((x) => x.trim()).filter(Boolean);
  return JSON.stringify({ headline, paragraphs: paras.map((t, i) => ({ text: t, refs: orig.paragraphs?.[i]?.refs || [] })) });
}
const sft = [], dpo = [], test = [];
const count = { aprobado: 0, editado: 0, rechazado: 0 };
for (const r of rows) {
  count[r.label] = (count[r.label] || 0) + 1;
  const prompt = [{ role: 'system', content: r.system || '' }, { role: 'user', content: r.input }];
  if (split(r.input) === 'test') { test.push({ id: r.id, kind: r.kind, messages: prompt, reference: r.label === 'editado' ? editedToJson(r, r.final) : r.label === 'aprobado' ? r.output : null, label: r.label }); continue; }
  if (r.label === 'aprobado') sft.push({ kind: r.kind, messages: [...prompt, { role: 'assistant', content: r.output }] });
  if (r.label === 'editado' && r.final) {
    r.final = editedToJson(r, r.final);
    sft.push({ kind: r.kind, messages: [...prompt, { role: 'assistant', content: r.final }] });
    dpo.push({ kind: r.kind, prompt, chosen: [{ role: 'assistant', content: r.final }], rejected: [{ role: 'assistant', content: r.output }] });
  }
}
console.log(`Revisados: ${rows.length} · aprobados ${count.aprobado} · editados ${count.editado} · rechazados ${count.rechazado}`);
console.log(`SFT ${sft.length} · DPO ${dpo.length} · test ${test.length}`);
if (process.argv.includes('--stats')) process.exit(0);
if (sft.length < 200) console.log('Aviso: con menos de 200 ejemplos SFT no vale la pena entrenar; sigue revisando en la app (el prompt + verificación ya funciona).');
mkdirSync(outDir, { recursive: true });
const jl = (xs) => xs.map((x) => JSON.stringify(x)).join('\n') + (xs.length ? '\n' : '');
writeFileSync(resolve(outDir, 'advisor_sft.jsonl'), jl(sft));
writeFileSync(resolve(outDir, 'advisor_dpo.jsonl'), jl(dpo));
writeFileSync(resolve(outDir, 'advisor_test.jsonl'), jl(test));
// Modelo propio de fuerza de relación (warm path): juicio del agente + tu corrección con el slider.
const edges = db.prepare('SELECT body, human FROM edge_judgments WHERE human IS NOT NULL').all().map((r) => { const j = JSON.parse(r.body); const h = JSON.parse(r.human); return { from: j.from, to: j.to, evidence: (j.evidence || []).map((e) => `${e.source}: ${e.text}`).join('\n'), agent: j.judgment, label: h }; });
writeFileSync(resolve(outDir, 'edges_labeled.jsonl'), jl(edges));
// Fichas con tu opinión: 'util' = positivo; 'corregir'/'equivocada' + nota = negativo (para DPO cuando reescribas la ficha).
const fb = db.prepare("SELECT key, body, feedback FROM dossiers WHERE feedback IS NOT NULL").all().map((r) => { const b = JSON.parse(r.body); return { key: r.key, person: b.person, feedback: JSON.parse(r.feedback), input: b.training?.input, output: b.training?.output, system: b.training?.system }; });
writeFileSync(resolve(outDir, 'dossier_feedback.jsonl'), jl(fb));
const extraSft = fb.filter((x) => x.feedback.verdict === 'util' && x.input && split(x.input) === 'train').map((x) => ({ kind: 'dossier', messages: [{ role: 'system', content: x.system }, { role: 'user', content: x.input }, { role: 'assistant', content: x.output }] }));
if (extraSft.length) { writeFileSync(resolve(outDir, 'advisor_sft.jsonl'), jl([...sft, ...extraSft])); console.log(`+${extraSft.length} fichas marcadas útiles añadidas al SFT`); }
console.log(`Relaciones etiquetadas: ${edges.length} · fichas con opinión: ${fb.length}`);
console.log(`Escrito en ${outDir}`);
