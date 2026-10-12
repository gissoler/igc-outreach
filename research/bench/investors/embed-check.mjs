// Comprobación del embedder local (correr en el Mac; necesita red a huggingface.co la primera vez).
//   cd research && npm install @xenova/transformers@2.17.2 && node bench/investors/embed-check.mjs
import { createTransformersEmbedder, cosine } from './relevance-embeddings.mjs';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const cfg = JSON.parse(readFileSync(resolve(import.meta.dirname, 'config/v6-2026-10-09.json'), 'utf8'));
const model = process.argv[2] ?? cfg.relevance.embeddings.model, emb = createTransformersEmbedder({ model });
const t0 = Date.now();
const [q, a, b] = await emb.embed(['app that reduces carbon emissions'], 'query').then(async x => [x[0], ...(await emb.embed(['Fund invests in carbon-reduction startups', 'Battery factory opens in Australia'], 'passage'))]);
console.log(JSON.stringify({ model, ok: true, dims: q.length, load_ms: emb.load_ms, total_ms: Date.now() - t0, cos_investment_text: Number(cosine(q, a).toFixed(4)), cos_unrelated_text: Number(cosine(q, b).toFixed(4)) }));
// Falla (exit 1) si el texto de inversión no queda por encima del no relacionado: run-overnight.sh omite entonces las etapas B2E.
if (!(cosine(q, a) > cosine(q, b))) { console.error('EMBED_CHECK_FALLA: coseno(inversión) <= coseno(no relacionado)'); process.exit(1); }
