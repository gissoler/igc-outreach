// Filtro de relevancia por embeddings (config v6, condición B2E; ablación exploratoria, apagado por defecto).
// Por consulta: embedding de la intención y de «título + primer párrafo» de cada resultado → coseno → los k más altos →
// un LLM conserva solo los que hablan de INVERSIÓN → si ninguno, pasa al siguiente bloque. No cuenta como fetch ni como rechazo.
const render = (tpl, vars) => tpl.replace(/\{\{([a-z_]+)\}\}/g, (_, k) => String(vars[k] ?? ''));
const clean = s => String(s ?? '').replace(/\s+/g, ' ').trim();
export const cosine = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }; // vectores normalizados

export function intentText(profile) {
  const f = profile.fields, v = k => f[k]?.value;
  const arr = k => (Array.isArray(v(k)) ? v(k) : v(k) == null ? [] : [v(k)]).join(', ');
  return clean([v('product'), v('description'), v('sector') && `Sector: ${v('sector')}`, arr('subsectors') && `Subsectors: ${arr('subsectors')}`, arr('target_markets') && `Markets: ${arr('target_markets')}`].filter(Boolean).join('. '));
}

export function resultDocument(r, maxChars = 600) {
  const raw = String(r.text ?? r.snippet ?? '').replace(/\r/g, '');
  const paragraphs = raw.split(/\n\s*\n/).map(clean).filter(Boolean);
  const first = paragraphs.find(p => p.length >= 40) ?? clean(raw);
  return clean(`${r.title ?? ''}. ${first}`).slice(0, maxChars);
}

// Embedder real: @xenova/transformers (sin Python). Se importa solo si se usa; el modelo se descarga una vez y queda en caché local.
export function createTransformersEmbedder({ model, importer = () => import('@xenova/transformers') }) {
  let extractor = null, loadMs = 0; const e5 = /e5/i.test(model);
  const load = async () => { if (extractor) return extractor; const t0 = Date.now(); const { pipeline } = await importer(); extractor = await pipeline('feature-extraction', model); loadMs = Date.now() - t0; return extractor; };
  return {
    model, get load_ms() { return loadMs; },
    async embed(texts, kind = 'passage') {
      const pipe = await load(), prefix = e5 ? `${kind === 'query' ? 'query' : 'passage'}: ` : '';
      const out = [];
      for (const text of texts) { const t = await pipe(`${prefix}${text}`, { pooling: 'mean', normalize: true }); out.push(Array.from(t.data)); }
      return out;
    }
  };
}

export function createRelevanceFilter({ embedder, llm, prompt, config, profile, seed = 0, log = () => {} }) {
  const { top_k: topK, block_size: blockSize } = config.relevance.embeddings, intent = intentText(profile);
  const stats = { queries: 0, results_in: 0, results_kept: 0, empty_queries: 0, embedded_texts: 0, embed_ms: 0, llm_calls: 0, llm_tokens: 0, llm_ms: 0, blocks_read: 0 };
  let intentVec = null;
  return {
    intent, stats,
    async filter(results, { query = null } = {}) {
      stats.queries++; stats.results_in += results.length;
      if (!results.length) { stats.empty_queries++; return []; }
      const docs = results.map(r => resultDocument(r));
      const t0 = Date.now();
      if (!intentVec) { [intentVec] = await embedder.embed([intent], 'query'); stats.embedded_texts++; }
      const vecs = await embedder.embed(docs, 'passage'); stats.embedded_texts += docs.length;
      const ranked = results.map((_, i) => ({ i, sim: cosine(intentVec, vecs[i]) })).sort((a, b) => b.sim - a.sim || a.i - b.i);
      stats.embed_ms += Date.now() - t0;
      const blocks = [];
      let kept = [], pos = 0;
      while (pos < ranked.length && !kept.length) {
        const size = pos === 0 ? topK : blockSize, block = ranked.slice(pos, pos + size); pos += size;
        const user = render(prompt.user, { intent, results: block.map((x, j) => `[${j}] ${docs[x.i]}`).join('\n') });
        const out = await llm.call({ prompt, user, schemaName: 'investor_relevance.v1', temperature: 0, seed, maxTokens: 2000 });
        stats.llm_calls++; stats.blocks_read++; stats.llm_tokens += out.tokens_nominal ?? 0; stats.llm_ms += out.latency?.actual_ms ?? 0;
        const yes = new Set((out.json.items ?? []).filter(x => x.about_investment === true && Number.isInteger(x.i) && x.i >= 0 && x.i < block.length).map(x => x.i));
        blocks.push({ indices: block.map(x => x.i), kept: block.filter((_, j) => yes.has(j)).map(x => x.i) });
        kept = block.filter((_, j) => yes.has(j));
      }
      if (!kept.length) stats.empty_queries++;
      stats.results_kept += kept.length;
      log({ event: 'relevance_filter', query, results_in: results.length, urls: results.map(r => r.url), similarity: ranked.map(x => ({ i: x.i, sim: Number(x.sim.toFixed(4)) })), blocks, kept: kept.map(x => x.i) });
      return kept.map(x => results[x.i]);
    }
  };
}

// B2E: envuelve las deps de un run. search → filtra la respuesta (antes del triage y de abrir páginas); plan → cuenta rondas.
// Ronda 1 = lote inicial, ronda 2 = primer paso adaptativo; al empezar la 3.ª llamada del planner el estado ya refleja la ronda 2.
export function withRelevance(base, rel, round = { plan_calls: 0, accepted_at_round_3_start: null }) {
  return {
    round,
    deps: {
      ...base,
      async search(query, options) { const value = await base.search(query, options); const results = value.results ?? []; const kept = await rel.filter(results, { query }); return { ...value, results: kept, relevance: { results_in: results.length, kept: kept.length } }; },
      async plan(input) { round.plan_calls++; if (round.plan_calls === 3) round.accepted_at_round_3_start = input.state.entities.length; return base.plan(input); }
    }
  };
}
export const sparseAfterRound2 = (round, finalEntityCount) => (round.accepted_at_round_3_start ?? finalEntityCount) < 3;
