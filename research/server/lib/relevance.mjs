import { rerank, embed, cosine, fleetConfig } from '../analysis/fleet.mjs';

export const clipText = (value, max = 1400) => {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
};

export function focusText(text, terms, { window = 500, max = 3 } = {}) {
  const source = String(text || '').replace(/\s+/g, ' ');
  const lower = source.toLowerCase();
  const hits = [];
  for (const term of terms.map((x) => String(x || '').toLowerCase()).filter((x) => x.length > 2)) {
    let at = lower.indexOf(term);
    while (at >= 0 && hits.length < max * 3) {
      hits.push(at);
      at = lower.indexOf(term, at + term.length);
    }
  }
  if (!hits.length) return clipText(source, window * 2);
  hits.sort((a, b) => a - b);
  const spans = [];
  for (const hit of hits) {
    const start = Math.max(0, hit - window / 2);
    const end = Math.min(source.length, hit + window / 2);
    if (spans.length && start <= spans.at(-1)[1]) spans.at(-1)[1] = end;
    else spans.push([start, end]);
  }
  return spans.slice(0, max).map(([start, end]) => source.slice(start, end)).join(' … ');
}

export function chunkText(text, size = 700, overlap = 120) {
  const source = String(text || '').replace(/\s+/g, ' ').trim();
  if (!source) return [];
  if (source.length <= size) return [source];
  const out = [];
  for (let at = 0; at < source.length; at += size - overlap) {
    out.push(source.slice(at, at + size));
    if (at + size >= source.length) break;
  }
  return out;
}

export async function rankByRelevance(query, texts, { env = process.env, fetcher = fetch, signal } = {}) {
  if (!query || texts.length < 2) return null;
  const cfg = fleetConfig(env);
  if (cfg.roles.rerank.ready) {
    try {
      const rows = await rerank(query, texts, { env, fetcher, signal });
      if (rows.length) return rows.map((row) => row.index);
    } catch { /* embeddings remain available as a fallback */ }
  }
  if (cfg.roles.embed.ready) {
    try {
      const [needle, ...vectors] = await embed([query, ...texts], { env, fetcher, signal });
      return vectors.map((vector, index) => ({ index, score: cosine(needle, vector) }))
        .sort((a, b) => b.score - a.score).map((row) => row.index);
    } catch { /* deterministic lexical fallback below */ }
  }
  return null;
}

export async function relevantText(query, text, terms = [], { env = process.env, fetcher = fetch, signal, window = 500, max = 3 } = {}) {
  if (query) {
    const chunks = chunkText(text, window + 200);
    if (chunks.length > 1) {
      const order = await rankByRelevance(query, chunks, { env, fetcher, signal });
      if (order) return order.slice(0, max).map((index) => chunks[index]).join(' … ');
    } else if (chunks.length === 1) return chunks[0];
  }
  return focusText(text, terms, { window, max });
}

export async function rankItems(query, items, textOf, { env = process.env, fetcher = fetch, signal, k = 8 } = {}) {
  if (!query || items.length <= 1) return items.slice(0, k);
  const order = await rankByRelevance(query, items.map(textOf), { env, fetcher, signal });
  return order ? order.slice(0, k).map((index) => items[index]) : items.slice(0, k);
}
