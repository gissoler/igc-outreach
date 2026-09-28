// Exporta los juicios (aprobado/rechazado en fondos, fragmentos y mensajes) para learning-to-rank.
//   node scripts/ltr-export.mjs → ../backend/ml/data/judgments.jsonl
// El entrenamiento (backend/ml/train_ltr.py) se niega a correr con menos de 200 juicios.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createStore } from '../server/research/store.mjs';
const store = createStore(resolve(process.env.RESEARCH_DB || 'data/research.sqlite')).analysis;
const rows = store.judgments();
mkdirSync(resolve('../backend/ml/data'), { recursive: true });
writeFileSync(resolve('../backend/ml/data/judgments.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n'));
const byKind = rows.reduce((a, r) => ({ ...a, [r.kind]: (a[r.kind] || 0) + 1 }), {});
console.log(`${rows.length} juicios`, byKind, rows.length < 200 ? '\nAún no alcanza para learning-to-rank (mínimo 200).' : '');
