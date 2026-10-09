// Construye los casos de la variante B (case_id con sufijo -ib; el esquema exige minúsculas y perfiles bajo cases/profiles/) (reescritura del brief) para p01–p06 en cases-pairs/. Solo cambian description y product;
// el resto del perfil y el oro (anchors) quedan idénticos. Uso, desde research/:  node bench/investors/analysis/make_intent_pairs.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
const inv = resolve(import.meta.dirname, '..'), repo = resolve(inv, '../../..');
const briefs = JSON.parse(readFileSync(resolve(inv, 'intent-pairs/briefs-B.json'), 'utf8'));
mkdirSync(resolve(inv, 'cases-pairs'), { recursive: true });
const sha = b => createHash('sha256').update(b).digest('hex');
for (const [id, b] of Object.entries(briefs.pairs)) {
  const base = `inv-case-syn-${id}`, caseA = JSON.parse(readFileSync(resolve(inv, `cases/${base}.json`), 'utf8'));
  const profA = JSON.parse(readFileSync(resolve(repo, caseA.profile_path), 'utf8'));
  const profB = structuredClone(profA);
  profB.profile_id = `${profA.profile_id}-ib`;
  profB.provenance = { ...profB.provenance, builder_id: 'claude-v6-intent-rewrite', builder_saw_investors: false };
  for (const k of ['description', 'product']) profB.fields[k] = { ...profB.fields[k], value: b[k] };
  const profBytes = `${JSON.stringify(profB, null, 2)}\n`, profRel = `research/bench/investors/cases/profiles/${base}-ib.json`;
  writeFileSync(resolve(repo, profRel), profBytes);
  const caseB = { ...caseA, case_id: `${base}-ib`, profile_path: profRel, profile_sha256: sha(profBytes) };
  writeFileSync(resolve(inv, `cases-pairs/${base}-ib.json`), `${JSON.stringify(caseB, null, 2)}\n`);
  console.log(`${caseB.case_id} ← ${caseA.case_id}`);
}
