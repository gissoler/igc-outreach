// Línea base (b) del backtest: LLM con el mismo perfil ex ante, anonimizado ("Startup A").
// También corre la prueba de memorización: "¿quién lideró la ronda de {startup}?" sin contexto.
//   ANTHROPIC_API_KEY=... BASELINE_LLM_MODEL=... node scripts/baseline-llm.mjs [--model <modelo>] [--search]
// --search activa la herramienta de búsqueda web de la API (no filtra por fecha: se reporta aparte).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { matchFunds } from '../server/analysis/entities.mjs';

const args = process.argv.slice(2);
const opt = (n, f = null) => { const i = args.indexOf(`--${n}`); return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : f; };
const key = process.env.ANTHROPIC_API_KEY;
if (!key) { console.error('Falta ANTHROPIC_API_KEY.'); process.exit(1); }
const model = opt('model', process.env.BASELINE_LLM_MODEL);
if (!model) { console.error('Falta --model o BASELINE_LLM_MODEL.'); process.exit(1); }
const search = Boolean(opt('search'));
const data = JSON.parse(readFileSync(resolve('../backend/eval/backtest_rounds.json'), 'utf8'));

async function ask(content, { tools = false } = {}) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: 1500, temperature: 0, messages: [{ role: 'user', content }], ...(tools ? { tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }] } : {}) }),
  });
  if (!r.ok) throw new Error(`Anthropic HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  return j.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
}

const out = { model, search, at: new Date().toISOString(), rounds: {} };
for (const r of data.rounds.filter((x) => x.include !== false)) {
  const profile = r.profile_ex_ante || r.profile_hint;
  const prompt = `Eres asesor de fundraising. Fecha de hoy: ${r.announced} menos un día. Esta es una startup ("Startup A"):\n\n${profile}\n\nEtapa buscada: ${r.stage}. Lista los 10 fondos o inversionistas institucionales más probables para LIDERAR esta ronda. Responde solo un JSON: {"names": ["...", ...]} con 10 nombres de firmas, sin explicaciones.`;
  let names = [];
  try { const text = await ask(prompt, { tools: search }); names = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || '{}').names || []; } catch (e) { console.error(r.id, e.message); }
  let contaminated = null;
  try {
    const probe = await ask(`¿Qué firma lideró la ronda ${r.stage} de ${r.company} (anunciada alrededor de ${String(r.announced).slice(0, 7)})? Responde solo el nombre de la firma o "no sé".`);
    contaminated = r.leads.some((l) => probe.split(/[,\n;]| and | y /).some((p) => matchFunds(p.trim(), l).decision === 'auto'));
  } catch (e) { console.error(r.id, 'prueba de memorización:', e.message); }
  out.rounds[r.id] = { names: names.slice(0, 10), contaminated };
  console.log(r.id, r.company, names.slice(0, 3).join(' | '), contaminated ? '(contaminada)' : '');
}
mkdirSync(resolve('../backend/eval/results'), { recursive: true });
writeFileSync(resolve('../backend/eval/results/llm_baseline.json'), JSON.stringify(out, null, 2));
console.log('→ ../backend/eval/results/llm_baseline.json');
