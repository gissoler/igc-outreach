/* Nombres neutros para las herramientas de terceros: el usuario nunca ve con qué proveedor trabajamos.
   `maskBrands` se aplica a todo texto de interfaz que llega del servidor (ver legacyDeep) y a los textos de demo.
   Para saber qué herramienta hay detrás de cada nombre (administración), ver research/.env.example. */
export const BRAND = {
  decision: 'Decision Agent',
  semantic: 'Semantic Search',
  web: 'Web Search',
  deep: 'Deep Search',
  news: 'News Search',
  answer: 'Answer Search',
  pages: 'Page Reader',
  reader: 'Web Reader',
  contacts: 'Contact Finder',
  people: 'People Search',
  model: 'AI model',
} as const;

const HOSTS: [RegExp, string][] = [
  [/\b(?:api\.)?exa\.ai\b/gi, 'api.semantic-search'], [/\b(?:google\.)?serper\.dev\b/gi, 'api.web-search'],
  [/\b(?:api\.)?apify\.com\b/gi, 'api.people-search'], [/\b(?:api\.)?firecrawl\.dev\b/gi, 'api.web-reader'],
  [/\bapi\.hunter\.io\b/gi, 'api.contact-finder'], [/\b(?:api\.)?openjev\.sh\b/gi, 'api.decision-agent'],
  [/\b(?:api\.)?tavily\.com\b/gi, 'api.answer-search'], [/\bapi\.you\.com\b|\bydc-index\.io\b/gi, 'api.news-search'],
  [/\b(?:api\.)?linkup\.so\b/gi, 'api.deep-search'], [/\b[rs]\.jina\.ai\b|\bjina\.ai\b/gi, 'api.page-reader'],
];
const ENV: [RegExp, string][] = [
  [/\b(?:EXA)_[A-Z_]+\b/g, `${BRAND.semantic} key`], [/\bSERPER_[A-Z_]+\b/g, `${BRAND.web} key`],
  [/\b(?:FIRECRAWL|SGAI)_[A-Z_]+\b/g, `${BRAND.reader} key`], [/\bAPIFY_[A-Z_]+\b/g, `${BRAND.people} key`],
  [/\bHUNTER_[A-Z_]+\b/g, `${BRAND.contacts} key`], [/\b(?:OPENJEV|JEV)_[A-Z_]+\b/g, `${BRAND.decision} key`],
  [/\bLINKUP_[A-Z_]+\b/g, `${BRAND.deep} key`], [/\bYOU_API_KEY\b/g, `${BRAND.news} key`], [/\bTAVILY_[A-Z_]+\b/g, `${BRAND.answer} key`],
  [/\bJINA_[A-Z_]+\b/g, `${BRAND.pages} key`], [/\b(?:VLLM|INTAKE_LLM|ENGINE_LLM)_[A-Z_]+\b/g, `${BRAND.model} settings`],
];
const NAMES: [RegExp, string][] = [
  [/Firecrawl\s*\+\s*ScrapeGraph|ScrapeGraph\s*\+\s*Firecrawl/gi, BRAND.reader],
  [/Open\s?Jev\s*\/\s*Jev|OpenJev|\bJev\b/gi, BRAND.decision],
  [/Firecrawl|ScrapeGraph/gi, BRAND.reader], [/\bApify\b/gi, BRAND.people], [/\bSerper\b/gi, BRAND.web], [/\bLinkup\b/gi, BRAND.deep],
  [/\bTavily\b/gi, BRAND.answer], [/\bSearXNG\b/gi, BRAND.web], [/\bHunter\.io\b/gi, BRAND.contacts], [/\bYou\.com\b/gi, BRAND.news],
  [/\bBrave Search\b/gi, BRAND.web], [/\bJina(?:\s+Reader)?(?=\s*(?:[:·)(,.]|$|key|API|Search|Reader))/g, BRAND.pages],
  // Nombres que también son palabras o apellidos: solo cuando aparecen como proveedor (no tocar «Hunter College»).
  [/\bExa(?=\s*(?:[:·)(,.]|$|HTTP|search|semantic|news|agentic))|(?<=\b(?:by|via|with|from)\s)Exa\b|(?<=\()Exa(?=\))/g, BRAND.semantic],
  [/\bHunter(?=\s*(?:[:·)(,]|$|HTTP|API|key|found))|(?<=\b(?:by|via|with|from)\s)Hunter\b(?!\s+[A-Z])/g, BRAND.contacts],
  [/\bvLLM\b|\bQwen[\w.\-]*|\bg355\b/gi, BRAND.model],
  [/\bPlaywright\b/g, 'browser automation'], [/\b(?:harvestapi|data_link_miner|dev_fusion|apimaestro)\b/g, 'people-search'],
];

export function maskBrands(s: string): string {
  if (!s) return s;
  let out = s;
  for (const [re, to] of HOSTS) out = out.replace(re, to);
  for (const [re, to] of ENV) out = out.replace(re, to);
  for (const [re, to] of NAMES) out = out.replace(re, to);
  out = out.replace(/\bChromium\b/g, (m, off: number) => (off === 0 ? 'Browser' : 'browser'));
  // «Web Reader key and Web Reader key» → una sola vez.
  out = out.replace(/(AI model)(\s+(?:via|on|and|\+|\/)\s+)\1/g, '$1').replace(/(AI model)(\s+(?:via|on|and|\+|\/)\s+)\1/g, '$1');
  out = out.replace(/\b((?:[A-Za-z]+ )*[A-Za-z]+) \(\1\)/gi, '$1');
  return out.replace(/(\b[A-Z][\w ]+ key)(\s*(?:,|\/|and|y|\+)\s*)\1/g, '$1').replace(/(Web Reader)(\s*\+\s*)\1/g, '$1');
}

/** Campos de texto de interfaz en los que se aplica la máscara (nunca url ni quote). */
export const BRAND_KEYS = new Set(['message', 'title', 'provider', 'summary', 'label', 'note', 'reason', 'why', 'headline', 'items', 'decision', 'error', 'kind_label',
  'stageLabel', 'detailText', 'source', 'provenance', 'host', 'model', 'missing', 'risks', 'hits', 'discard', 'hint', 'tech', 'fix', 'endpoint', 'relation', 'publicUrl', 'subtitle', 'sources']);

export function maskDeep<T>(value: T, key = ''): T {
  if (typeof value === 'string') return (BRAND_KEYS.has(key) ? maskBrands(value) : value) as T;
  if (Array.isArray(value)) return value.map((v) => maskDeep(v, key)) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = k === 'quote' || k === 'url' ? v : maskDeep(v, k);
    return out as T;
  }
  return value;
}
