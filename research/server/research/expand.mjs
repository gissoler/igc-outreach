/* ─────────────────────────────────────────────────────────────────────────────
   Query expansion (feedback 28/09, David): a user names the need in one way
   ("data harmonization") and a single keyword hides the funders who call it
   something else ("data standardization", "data integration"…). We expand the
   need into adjacent terms and run ONE SEPARATE QUERY PER TERM, starting from
   "who is funding this today".

   Order of terms: the user's own words first, then an optional local model
   (same OpenAI-compatible endpoint as the intake agent), then a small curated
   lexicon so it still works with no model. Output is capped and de-duplicated.
   ───────────────────────────────────────────────────────────────────────────── */
import { norm } from './core.mjs';

/** Curated adjacent terms. Each rule: pattern over the brief text → industry phrasings (English, as queried). */
export const LEXICON = [
  [/harmoni[sz]|armoniz|interoperab|data (integration|standardi[sz]ation)|estandariz/, ['data harmonization', 'data standardization', 'data integration', 'data interoperability', 'AI data cleaning']],
  [/real world (evidence|data)|\brwe\b|\brwd\b|claims data/, ['real-world evidence', 'real-world data', 'health outcomes research']],
  [/alzheimer|dementia|demencia|adrd/, ["Alzheimer's disease", 'dementia care', 'neurodegenerative disease', 'cognitive decline']],
  [/agitation|agitacion/, ['neuropsychiatric symptoms of dementia', 'behavioral symptoms of dementia']],
  [/mental health|salud mental|wellbeing|bienestar|stress|estres|anxiety|ansiedad|depress/, ['mental health', 'behavioral health', 'digital mental health', 'emotional wellbeing']],
  [/digital health|salud digital|healthtech|mhealth/, ['digital health', 'digital therapeutics', 'healthtech']],
  [/wearable|sensor|remote monitoring|monitoreo remoto/, ['wearables', 'remote patient monitoring', 'medical sensors']],
  [/drug|molecule|molecula|therapeutic|farmaco|small molecule|biotech/, ['drug discovery', 'therapeutics', 'small molecule drugs', 'biotech']],
  [/cannabin|cannabis/, ['cannabinoid therapeutics', 'cannabinoid drug development']],
  [/machine learning|artificial intelligence|inteligencia artificial|\bai\b|\bia\b/, ['AI in healthcare', 'machine learning']],
  [/clinical trial|ensayo clinico/, ['clinical research', 'decentralized clinical trials']],
];

const clean = (t) => String(t || '').replace(/["“”]/g, '').replace(/\s+/g, ' ').trim();
const valid = (t) => t.length >= 3 && t.length <= 60 && !/[{}<>]/.test(t);

/** The user's own words for the need: first sector tags, else the product. */
export function primaryTerms(b) {
  const tags = String(b.industry || '').split(/[,;|]/).map(clean).filter(valid);
  return (tags.length ? tags.slice(0, 2) : [clean(b.product)]).filter(valid);
}

export function lexiconTerms(b) {
  const text = norm(`${b.industry} ${b.product} ${b.oneLiner || ''} ${b.description}`);
  return LEXICON.filter(([rx]) => rx.test(text)).flatMap(([, terms]) => terms);
}

/** Optional: ask the local model for how the industry names the same need. Never throws. */
export async function modelTerms(b, env = {}, fetchImpl = fetch) {
  if (!env.INTAKE_LLM_BASE_URL || env.QUERY_EXPAND_LLM === '0') return [];
  const base = String(env.INTAKE_LLM_BASE_URL).replace(/\/+$/, '');
  const need = primaryTerms(b)[0] || b.product;
  const prompt = `A founder needs funding for: "${need}" (${clean(b.oneLiner || b.description).slice(0, 200)}). ` +
    'List up to 4 other phrases funders, grant programs and investors use for the SAME need. ' +
    'Short noun phrases in English, no explanations. Answer only JSON: {"terms": ["..."]}';
  try {
    const r = await fetchImpl(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(env.INTAKE_LLM_API_KEY ? { Authorization: `Bearer ${env.INTAKE_LLM_API_KEY}` } : {}) },
      body: JSON.stringify({ model: env.INTAKE_LLM_MODEL || 'qwen3-4b', temperature: 0.2, max_tokens: 200, messages: [{ role: 'user', content: prompt }] }),
      signal: AbortSignal.timeout(Number(env.QUERY_EXPAND_TIMEOUT_MS) || 15_000),
    });
    if (!r.ok) return [];
    const text = String((await r.json())?.choices?.[0]?.message?.content || '').replace(/<think>[\s\S]*?<\/think>/g, '');
    const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    return (Array.isArray(json.terms) ? json.terms : []).map(clean).filter(valid).slice(0, 4);
  } catch {
    return [];
  }
}

/**
 * Terms to search, each as a separate query. [{ term, source: 'yours' | 'model' | 'lexicon' }]
 * max: total terms including the user's own (default 4, env QUERY_EXPAND_MAX).
 */
export async function expandTerms(b, env = {}, fetchImpl = fetch) {
  const max = Math.min(6, Math.max(1, Number(env.QUERY_EXPAND_MAX) || 4));
  const out = [];
  const seen = new Set();
  const add = (term, source) => { const k = norm(term); if (!k || seen.has(k) || out.length >= max) return; seen.add(k); out.push({ term, source }); };
  for (const t of primaryTerms(b)) add(t, 'yours');
  for (const t of await modelTerms(b, env, fetchImpl)) add(t, 'model');
  for (const t of lexiconTerms(b)) add(t, 'lexicon');
  return out;
}

/** "Who is funding X today" — the first question David asks, per term and funding type. */
const ASK = {
  investment: (t, b) => `Venture capital funds and angel investors currently investing in ${t} startups${b.round ? ` at ${b.round}` : ''}`,
  grant: (t) => `Open grant programs and non-dilutive funding calls for ${t}`,
  partnering: (t) => `Companies looking for partnerships or licensing in ${t}`,
  sponsorship: (t) => `Foundations and corporate sponsors funding ${t} initiatives`,
  debt: (t) => `Venture debt and loan programs for ${t} companies`,
};
export function fundingQuery(term, objective, b, year = new Date().getFullYear()) {
  const ask = (ASK[objective] || ASK.investment)(term, b);
  return `Who is funding ${term} in ${year}? ${ask}${b.geography ? ` in ${b.geography}` : ''}.`.replace(/\s+/g, ' ').slice(0, 480);
}
/** Extra (non-primary) terms, the ones that get their own queries next to the full-profile query. */
export const adjacent = (plan) => (plan?.terms || []).slice(1).map((t) => t.term);
