// Herramientas que el agente analista puede usar. Cada resultado entra a la libreta con un id citable.
// Nada de LinkedIn (dominio bloqueado por política del proyecto). Sin claves, la herramienta lo dice y el agente sigue.
//
// Recuperación por relevancia real (no por palabra exacta): search_web/read_page/person_voice/fund_deals priorizan
// los fragmentos/ítems más relevantes a la pregunta del analista. Se prueba en orden: 1) reranker cross-encoder
// (VLLM_RERANK_MODEL) si hay uno de verdad — 2) embeddings + similitud de coseno (VLLM_EMBED_MODEL) — 3) respaldo
// anterior por palabras clave (focusText) / los primeros N, si no hay flota para esto o falla.
import { firecrawlSearch, FIRECRAWL_URL } from '../../research/webscrape.mjs';
import { fundId, personKey, normText } from '../entities.mjs';
import { focusText, relevantText, rankItems } from '../../lib/relevance.mjs';

const BLOCKED = /(^|\.)linkedin\.com$/i;
const hostOf = (u) => { try { return new URL(u).hostname; } catch { return ''; } };

async function readPage(url, { env, fetcher, signal }) {
  if (!/^https?:\/\//.test(url) || BLOCKED.test(hostOf(url))) throw new Error('URL not allowed.');
  if (env.FIRECRAWL_API_KEY) {
    const r = await fetcher(`${FIRECRAWL_URL}/scrape`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.FIRECRAWL_API_KEY}` }, body: JSON.stringify({ url, formats: ['markdown'], onlyMainContent: true }), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(45_000)]) : AbortSignal.timeout(45_000) });
    if (!r.ok) throw new Error(`Firecrawl HTTP ${r.status}`);
    const d = await r.json();
    return { title: d?.data?.metadata?.title || '', text: d?.data?.markdown || '', date: d?.data?.metadata?.publishedTime || null };
  }
  const r = await fetcher(url, { headers: { 'User-Agent': env.RESEARCH_USER_AGENT || 'IGC-Outreach/0.3' }, signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const html = await r.text();
  return { title: (html.match(/<title>([^<]*)<\/title>/i) || [])[1] || '', text: html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' '), date: null };
}

export { focusText };

export const TOOL_SPECS = {
  search_web: 'search_web {query}: search the web (news and pages). Use for: recent investments, current role, interviews, relationship between two people.',
  read_page: 'read_page {url, focus}: read a found page; "focus" = what to look for (names, topics) to prioritize the most relevant fragments.',
  fund_deals: 'fund_deals {fund, query?}: dated, quoted deals for that fund in our base. "query" (optional) prioritizes the most relevant, e.g. "digital health Series A LatAm".',
  person_voice: 'person_voice {person, query?}: what this person has said publicly (podcasts, blogs) in our index. "query" (optional) prioritizes the most relevant, e.g. "longevity and biotech thesis".',
  network: 'network {name}: whether this person or org appears in the founder\'s network (Connections.csv, public pages) and with whom.',
  outreach_history: 'outreach_history {name}: the founder\'s previous outreach to this person or fund and its result.',
};

export function createTools({ store, userId, network = [], env = process.env, fetcher = fetch, signal, budget = { web: 12 } }) {
  const A = store?.analysis;
  let webCalls = 0;
  return {
    async search_web({ query }, nb) {
      if (!query) return 'Missing query.';
      if (!env.FIRECRAWL_API_KEY) return 'Web search unavailable (missing FIRECRAWL_API_KEY). Work with the evidence you have.';
      if (webCalls++ >= budget.web) return 'Search budget used up for this run.';
      const rows = (await firecrawlSearch(query, { limit: 5, markdown: true, sources: ['web', 'news'], env, fetcher, signal })).filter((r) => !BLOCKED.test(hostOf(r.url)));
      if (!rows.length) return 'No results.';
      const terms = query.split(/\s+/).filter((w) => w.length > 3);
      const out = [];
      for (const r of rows) {
        const text = r.markdown ? await relevantText(query, r.markdown, terms, { env, fetcher, signal, window: 400, max: 2 }) : r.description;
        const id = nb.add({ source: 'web', url: r.url, title: r.title, text, date: r.date || null });
        if (id) out.push(`[${id}] ${r.title} — ${r.url}`);
      }
      return out.join('\n') || 'No results.';
    },
    async read_page({ url, focus = '' }, nb) {
      if (webCalls++ >= budget.web) return 'Read budget used up.';
      const p = await readPage(String(url || ''), { env, fetcher, signal });
      const terms = String(focus || '').split(/[,;]|\s{2,}/).map((x) => x.trim()).filter(Boolean);
      const text = await relevantText(focus, p.text, terms.length ? terms : String(focus).split(/\s+/), { env, fetcher, signal, window: 600, max: 3 });
      const id = nb.add({ source: 'página', url, title: p.title, text, date: p.date });
      return id ? `[${id}] read: ${p.title || url}` : 'Empty page.';
    },
    async fund_deals({ fund, query }, nb) {
      if (!A || !fund) return 'No deals base.';
      const all = A.dealsByFund(fundId(fund));
      if (!all.length) return `No deals for ${fund} in our base.`;
      const deals = await rankItems(query, all, (d) => `${d.startup} ${d.stage || ''} ${d.quote}`, { env, fetcher, signal, k: 8 });
      return deals.map((d) => `[${nb.add({ source: 'deal', url: d.url, title: `${d.startup} · ${d.stage || ''} · ${d.date}`, text: d.quote, date: d.date })}] ${d.startup} (${d.date})`).join('\n');
    },
    async person_voice({ person, query }, nb) {
      if (!A || !person) return 'No voice index.';
      const all = A.chunks(personKey(person));
      if (!all.length) return `No indexed sources for ${person}.`;
      const chunks = await rankItems(query, all, (c) => c.text, { env, fetcher, signal, k: 6 });
      return chunks.map((c) => `[${nb.add({ source: c.kind || 'voz', url: c.url, title: c.title || '', text: c.text, date: c.published })}] ${c.title || c.url}`).join('\n');
    },
    async network({ name }, nb) {
      const k = normText(name);
      if (!k) return 'Missing name.';
      const rows = network.filter((c) => normText(c.name).includes(k) || normText(c.org).includes(k)).slice(0, 8);
      if (!rows.length) return `${name} isn't in the founder's network.`;
      return rows.map((c) => `[${nb.add({ source: c.source === 'web_public_relation' ? 'network (public page)' : 'red (Connections.csv)', url: c.url, title: c.name, text: `${c.name} · ${c.role || 'role not stated'} · ${c.org || 'organization not stated'}${c.connectedOn ? ` · connected since ${c.connectedOn}` : ''}${c.evidence ? ` · ${c.evidence}` : ''}`, kind: 'network' })}] ${c.name}`).join('\n');
    },
    async outreach_history({ name }, nb) {
      if (!A) return 'No history.';
      const k = normText(name);
      const rows = A.outreachFor(userId).filter((e) => normText(e.person).includes(k) || normText(e.fundName).includes(k)).slice(0, 10);
      if (!rows.length) return `No outreach logged with ${name}.`;
      return rows.map((e) => `[${nb.add({ source: 'tu historial', text: `${e.sentAt}: ${e.channel} a ${e.person || e.fundName} → ${e.outcome}${e.note ? ` (${e.note})` : ''}`, kind: 'outreach' })}] ${e.sentAt} ${e.outcome}`).join('\n');
    },
  };
}
