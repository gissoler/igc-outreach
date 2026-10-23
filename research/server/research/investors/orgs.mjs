/* ─────────────────────────────────────────────────────────────────────────────
   V15 · Inversionistas · Identidad de organización y candidatos (sin modelo).
   La unidad de decisión es la ORGANIZACIÓN (dominio registrable), no la página: 8VC salía dos veces (8vc.com y
   8vc.com/our-thesis) y una nota de prensa de Chugai (2023) contaba como el fondo.
     · orgKey: dominio registrable (sanofiventures.com, abbvie.com…).
     · sitios de terceros (prensa, directorios, redes, plataformas de sindicatos) nunca son candidatos: son FUENTES de nombres.
     · listas («Drug Discovery Investors», «top VC firms»): sus enlaces externos dan candidatos con dominio sin resolver nombres.
     · noticias de rondas («led by X, with participation from Y»): los nombres salen por regla y se resuelven por búsqueda,
       aceptando un dominio solo si coincide con el nombre (sin sufijos «Capital», «Ventures», «VC Fund»; siglas).
   Funciones puras.
   ───────────────────────────────────────────────────────────────────────────── */
import { hostKind, hostOf } from '../verify.mjs';

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const SECOND_LEVEL = /^(co|com|org|net|ac|gov|edu|ne|or)\.[a-z]{2}$/i;
/** Dominio registrable: «www.abbvie.com» → abbvie.com; «news.novonordisk.co.uk» → novonordisk.co.uk. */
export function orgKey(url) {
  const h = hostOf(url); if (!h) return ''; const parts = h.split('.');
  if (parts.length >= 3 && SECOND_LEVEL.test(parts.slice(-2).join('.'))) return parts.slice(-3).join('.');
  return parts.slice(-2).join('.');
}

/** Prensa, medios y blogs de terceros: fuentes de nombres, nunca candidatos. Lista heurística (ampliarla con lo que aparezca). */
export const NEWSHOST = /(^|\.)(prnewswire\.com|businesswire\.com|globenewswire\.com|prweb\.com|accesswire\.com|newswire\.ca|techcrunch\.com|venturebeat\.com|fiercebiotech\.com|fiercepharma\.com|fiercehealthcare\.com|endpts\.com|statnews\.com|biospace\.com|bioworld\.com|biopharmadive\.com|medcitynews\.com|mobihealthnews\.com|finsmes\.com|axios\.com|forbes\.com|reuters\.com|bloomberg\.com|wsj\.com|ft\.com|cnbc\.com|businessinsider\.com|genengnews\.com|labiotech\.eu|sifted\.eu|siliconangle\.com|healthcaredive\.com|beckershospitalreview\.com|nature\.com|science\.org|sciencedirect\.com|pubmed\.ncbi\.nlm\.nih\.gov|ncbi\.nlm\.nih\.gov|wikipedia\.org|drugdiscoverytrends\.com|pharmaceutical-technology\.com|pharmaphorum\.com|contractpharma\.com|biopharmatrend\.com|drughunter\.com|news-medical\.net|eurekalert\.org|thepharmaletter\.com|outsourcing-pharma\.com|startupnationcentral\.org)$/i;
/** Plataformas de sindicatos, bases de datos de inversión y marketplaces. */
export const PLATFORM = /(^|\.)(angellist\.com|wellfound\.com|republic\.co|republic\.com|seedinvest\.com|wefunder\.com|crowdcube\.com|seedrs\.com|gust\.com|f6s\.com|dealroom\.co|tracxn\.com|cbinsights\.com|openvc\.app|signal\.nfx\.com|vcsheet\.com|visible\.vc|crunchbase\.com|pitchbook\.com|privco\.com|owler\.com|zoominfo\.com|preqin\.com|apollo\.io|rocketreach\.co|growjo\.com|seedtable\.com|failory\.com|vcstack\.com|shizune\.co|inven\.ai|ycombinator\.com|producthunt\.com|github\.com|google\.com|bing\.com|amazon\.com|apple\.com)$/i;
/** Medios y plataformas también por etiqueta, para sus variantes por país (prnewswire.co.uk, businesswire.de…). */
const THIRD_LABELS = new Set(['prnewswire', 'businesswire', 'globenewswire', 'einpresswire', 'newswire', 'accesswire', 'reuters', 'bloomberg', 'forbes', 'techcrunch', 'crunchbase', 'pitchbook', 'linkedin', 'wikipedia', 'medium', 'substack', 'youtube']);
/** Medios generales, consultoras y plataformas de captación: también fuentes de nombres, nunca candidatos (se amplía con lo que aparezca en corridas reales). */
export const MEDIA = /(^|\.)(yahoo\.com|nytimes\.com|fortune\.com|endpoints\.news|washingtonpost\.com|theguardian\.com|bbc\.com|bbc\.co\.uk|cnn\.com|economist\.com|hbr\.org|mckinsey\.com|accenture\.com|deloitte\.com|pwc\.com|kpmg\.com|bcg\.com|bain\.com|rootsanalysis\.com|qubit\.capital|therealpreneur\.com|pharmanow\.live|wired\.com|theverge\.com|inc\.com|entrepreneur\.com|fastcompany\.com|time\.com|marketwatch\.com|investopedia\.com|seekingalpha\.com|msn\.com|news\.google\.com|globaldata\.com|grandviewresearch\.com|marketsandmarkets\.com|precedenceresearch\.com|mordorintelligence\.com|fiercebiotech\.com|biobucks\.co|clinicaltrials\.gov|fda\.gov|nih\.gov|sec\.gov)$/i;
/** Agencias públicas (nsf.gov, nih.gov, ukri.gov.uk…): financian por convocatorias — es el brazo de grants, no un inversionista. */
export const GOV = /(^|\.)(gov|mil)$|\.gov\.[a-z]{2}$|\.gob\.[a-z]{2}$/i;
export const isThirdParty = (url) => hostKind(url) !== 'other' || NEWSHOST.test(hostOf(url)) || PLATFORM.test(hostOf(url)) || MEDIA.test(hostOf(url)) || GOV.test(hostOf(url)) || THIRD_LABELS.has(orgKey(url).split('.')[0]);

const ARTICLE_PATH = /\/(news|newsroom|press|press-releases?|media|blogs?|insights?|stories|articles?|posts?|podcasts?|events?|webinars?|resources|guides?|learn|glossary)(\/|$)|\/20\d{2}\/\d{2}\//i;
const ARTICLE_TEXT = /\b(press release|for immediate release|today announced|announced today|raises? \$?\d|closes? \$?\d[\d.,]* ?(?:m|million|b|billion)|series [a-e] (?:round|financing)|seed (?:round|financing) led by)\b/i;
export const LISTISH = /\b(\d{1,3} (?:best |top |leading |largest |most active )?[a-z ]{0,35}(?:venture capital (?:firms|companies)|investors|vcs|vc firms)\b|the \d{1,3} (?:best|top|leading|largest|most active)\b|ranking of|market map|most active (?:venture|vc|investors?|firms)|directory of|database of|top \d+ [a-z ]{0,30}(?:investors|vcs|venture capital firms|funds|firms)|list of [a-z ]{0,30}(?:investors|vcs|venture capital firms|funds|firms)|(?:investors|vcs|venture capital firms) (?:to know|to watch|list|directory|database))\b/i;
const LIST_TEXT = /\b(ranking of|market map|most active (?:venture|vc|investors?|firms)|top \d+|\d+ (?:best|top|leading|most active)|list of|best [a-z ]{0,30}(?:investors|vcs|venture capital firms|funds)|(?:investors|vcs|venture capital firms|funds) (?:to know|to watch|list|directory|database))\b/i;
const FUNDED_HEADLINE = /\b(?:raises?|raised|secures?|secured|lands?|closes?|announces?)\s+(?:a\s+)?(?:an\s+)?\$?€?£?\d[\d.,]*\s?(?:k|m|mm|b|million|billion)?\b[^.]{0,60}\b(?:seed|pre-?seed|series\s+[a-e]|funding|financing|round)\b/i;
/** Papel de un resultado o página: 'list' (fuente de candidatos), 'news' (fuente de nombres), 'org' (posible candidato), 'skip'. */
export function roleOf({ url = '', title = '', snippet = '', text = '' } = {}) {
  const head = `${title} ${snippet} ${String(text).slice(0, 1200)}`;
  if (hostKind(url) === 'social' || PLATFORM.test(hostOf(url))) return 'skip';
  if (LIST_TEXT.test(`${title} ${snippet}`)) return 'list';
  if (isThirdParty(url)) return ARTICLE_TEXT.test(head) || ARTICLE_PATH.test(url) ? 'news' : LIST_TEXT.test(head) ? 'list' : 'news';
  // Resultado del sitio de una empresa que ANUNCIA su ronda («Acme raises $5M seed round»): la financiada no es el inversor; solo aporta los nombres de quienes la lideraron.
  if (FUNDED_HEADLINE.test(`${title} ${snippet}`)) return 'news';
  return 'org';
}
/** ¿Esta URL del sitio propio es un artículo (noticia/blog) y no una página institucional? */
export const isArticleUrl = (url) => ARTICLE_PATH.test(String(url));

/* ── Nombres de organización ── */
const LEGAL = /\b(inc|llc|l\.l\.c|ltd|limited|corp|corporation|co|lp|l\.p|llp|plc|gmbh|ag|sa|sas|bv|nv|ab|as|kk|oy)\b\.?/gi;
const NAME_SUFFIX = /\b(venture capital|ventures?|capital|partners?|management|investments?|investors?|advisors?|advisers?|holdings?|group|fund(?:s)?(?: [ivx]+)?|vc|equity|labs?|the)\b/gi;
export const nameCore = (name) => clean(String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(LEGAL, ' ').replace(/&/g, ' and ').replace(NAME_SUFFIX, ' ').replace(/[^A-Za-z0-9 ]+/g, ' ')).toLowerCase();
const compact = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const initialsOf = (name) => { const w = clean(String(name || '').replace(LEGAL, ' ')).split(/[^A-Za-z0-9]+/).filter((x) => x && !/^(and|of|the|for|de|la)$/i.test(x)); return w.length >= 2 ? w.map((x) => x[0]).join('').toLowerCase() : ''; };
/** ¿El dominio es de esta organización? Compara la etiqueta del dominio con el nombre sin sufijos (y con siglas). */
export function nameMatchesDomain(name, url) {
  const key = orgKey(url); if (!key) return false;
  const label = compact(key.split('.')[0]); const full = compact(String(name || '').replace(LEGAL, ' ')); const core = compact(nameCore(name));
  if (!label || label.length < 2) return false;
  const REST = /^(ventures?|capital|partners?|holdings?|vc|fund|funds|group|bio|biotech|health|labs?|investments?|invest|management|equity|advisors?|asset|growth|life|sciences?|therapeutics|pharma)+$/;
  if (core.length >= 3 && (label === core || (label.startsWith(core) && REST.test(label.slice(core.length))) || (label.length >= 4 && core.startsWith(label)))) return true;
  if (full.length >= 3 && (label === full || (label.startsWith(full) && REST.test(label.slice(full.length))) || (label.length >= 5 && full.startsWith(label)))) return true;
  const ini = initialsOf(name); if (ini.length >= 2 && (label === ini || label === `${ini}vc` || label === `${ini}capital` || label === `${ini}ventures`)) return true;
  return false;
}

/** Enlaces externos de una página de lista → candidatos (nombre = texto del enlace, dominio = el del enlace). */
export function candidatesFromList(page, { max = 120 } = {}) {
  const own = orgKey(page.url); const out = []; const seen = new Set();
  for (const l of page.links || []) {
    const key = orgKey(l.url); const name = clean(l.text);
    if (!key || key === own || seen.has(key) || isThirdParty(l.url) || !name || name.length > 60 || /^(read more|learn more|here|website|link|visit|home|contact us|about|login|sign ?up|subscribe|privacy|terms|cookie)/i.test(name)) continue;
    if (!/^[A-Z0-9]/.test(name)) continue;
    // Contexto de la fila (p. ej. «| [8VC](…) | Vir, Hexagon Bio |»): sirve para ordenar por términos del brief, nunca como evidencia.
    const text = String(page.text || ''); let at = text.indexOf(`[${l.text}](`); if (at < 0) at = text.indexOf(`](${l.url}`); const row = at >= 0 ? text.slice(text.lastIndexOf('\n', at) + 1, (text.indexOf('\n', at) + 1 || text.length + 1) - 1).slice(0, 300) : '';
    seen.add(key); out.push({ key, name, url: l.url, ref: l.ref || null, context: clean(row.replace(/\]\([^)]*\)/g, ']').replace(/[[\]|]/g, ' ')) }); if (out.length >= max) break;
  }
  return out;
}

/** Nombres de inversionistas en una noticia de ronda: «led by X», «with participation from Y and Z», «investors include …». */
const NAME = "[A-Z][A-Za-z0-9&.'’-]*(?:\\s+(?:[A-Z][A-Za-z0-9&.'’-]*|&|of|de|and))*";
export function namesFromNews(text, { max = 12 } = {}) {
  const t = clean(String(text || '').replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/\]\([^)]*\)/g, ']').replace(/[[\]*_#>|]/g, ' '));
  const out = []; const add = (s) => { for (const part of String(s).split(/,\s*|\s+and\s+|\s*;\s*/)) { const n = clean(part.replace(/^(?:the|existing investors?|new investors?|investors?|including|such as)\s+/i, '').split(/\.\s+(?=[A-Z])/)[0].replace(/\s+(?:and|or|the|with|in|of|for|at)$/i, '').replace(/[.,;:]+$/, '')); if (/\b(?:CEO|CTO|CFO|COO|founder|co-?founder|chief|president|professor|Dr|Mr|Ms)\b\.?/i.test(n)) continue; if (n.length >= 3 && n.length <= 50 && /^[A-Z0-9]/.test(n) && !/^(The|This|Series|Seed|Inc|LLC|It|Its|In|With|And|Other|Several|Undisclosed|Existing|New)$/i.test(n) && !out.includes(n)) out.push(n); } };
  const rx = [new RegExp(`\\b(?:led|co-led) by\\s+(${NAME}(?:,\\s*${NAME})*(?:,?\\s+and\\s+${NAME})?)`, 'g'), new RegExp(`\\bparticipation (?:from|of|by)\\s+(${NAME}(?:,\\s*${NAME})*(?:,?\\s+and\\s+${NAME})?)`, 'g'), new RegExp(`\\binvestors? (?:include|including|such as)\\s+(${NAME}(?:,\\s*${NAME})*(?:,?\\s+and\\s+${NAME})?)`, 'g')];
  for (const r of rx) for (const m of t.matchAll(r)) { add(m[1]); if (out.length >= max) return out.slice(0, max); }
  return out.slice(0, max);
}

/** ¿El dominio/nombre suena a inversor? Sin límites de palabra: «archventure», «aixventures», «amplitudevc» son una sola etiqueta. */
export const INVESTORISH_LABEL = /(venture|capital|invest|fund|vc$|vc\b|partners|holdings|equity|angel|seed|bio.?ventures|labs?$|family.?offices?)/i;

/** Nombre legible de la organización. El título de la página puede ser «Home» o un titular; se prefiere un nombre que coincida con el dominio. */
const GENERIC_TITLE = /^(home|homepage|welcome|index|main|about|about us|untitled|portfolio|team|contact|\W*)$/i;
export function orgDisplayName(cand = {}, pages = []) {
  const key = cand.key || ''; const label = compact(key.split('.')[0]); const pool = [];
  const push = (s) => { const t = clean(s); if (t && !GENERIC_TITLE.test(t)) pool.push(t); };
  for (const n of cand.names || []) for (const part of String(n).split(/\s[|｜–—:·-]\s|\s[|｜]\s/)) push(part);
  for (const p of pages) for (const part of String(p.title || '').split(/\s[|｜–—:·-]\s/)) push(part);
  const short = pool.filter((n) => n.length <= 40 && n.split(/\s+/).length <= 5);
  const match = short.find((n) => label.length >= 3 && (compact(n).includes(label) || label.includes(compact(nameCore(n)) || '~')));
  if (match) return match;
  // Un nombre que el sitio escribe en su texto: 1–4 palabras con mayúscula inicial cuya unión coincide con la etiqueta del dominio («Sanofi Ventures»).
  if (label.length >= 4) {
    const counts = new Map();
    for (const p of pages) for (const m of String(p.text || '').matchAll(/\b([A-Z][A-Za-z0-9&'’-]*(?:\s+[A-Z][A-Za-z0-9&'’-]*){0,3})\b/g)) { const n = m[1]; if (compact(n) === label || (compact(n).length >= label.length - 2 && compact(n).startsWith(label))) counts.set(n, (counts.get(n) || 0) + 1); }
    const best = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0];
    if (best) return best[0];
  }
  return key || short[0] || 'Organización';
}

/** Nombres de organizaciones que una lista en prosa pone como títulos («## Novo Holdings»), sin enlace: BioSpace «top 5 corporate VCs» no enlaza a ninguno. */
const HEAD_SKIP = /^(introduction|overview|conclusion|summary|methodology|faq|frequently|related|about|contact|share|subscribe|more|table of contents|key takeaways|why|how|what|when|where|top|best|our|final|next|read|see|sources?|references|footnotes?|comments?|disclaimer|assets|dry powder|portfolio|latest|recent|investments?|background|history|highlights?|takeaways?)\b/i;
export function namesFromHeadings(text, { max = 20 } = {}) {
  const out = []; const INV = /\b(ventures?|capital|partners|vc|fund|funds|invest\w*|holdings|equity|seed|angels?|bio|labs?)\b/i;
  for (const m of String(text || '').matchAll(/^#{2,4}[ \t]+(?:\d{1,2}[.)][ \t]*)?([^\n#]{3,70}?)[ \t]*$/gm)) {
    const n = clean(m[1].replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*_`]/g, '')).replace(/^\d{1,2}[.)]\s*/, '').replace(/\s*[\u2013\u2014|]\s.*$/, '');
    if (/\b(?:19|20)\d{2}\b|\b(?:tracker|report|market|trends?|guide|ranking|list|index|database)\b/i.test(n)) continue;
    const words = n.split(/\s+/);
    if (!n || words.length > 6 || /[.?!:]$/.test(n) || HEAD_SKIP.test(n) || !words.every((w) => /^[A-Z0-9]/.test(w) || /^(of|and|&|de|la)$/i.test(w)) || /[a-z][A-Z]/.test(n) || /^(featured|tier|authors?|market map|the market|geographic|acquisition|collaborations?|digital|report)\b/i.test(n)) continue;
    if (!out.some((x) => x.toLowerCase() === n.toLowerCase())) out.push(n);
  }
  // Los que suenan a fondo primero; el resto (puede ser una empresa o una persona) como mucho 3 por página, para no gastar búsquedas de resolución.
  const inv = out.filter((x) => INV.test(x)); const rest = out.filter((x) => !INV.test(x)).slice(0, 3);
  return [...inv, ...rest].slice(0, max);
}

/** Inversionistas enlazados en una frase de artículo: «include firms like: [Novo Holdings](https://novoholdings.dk)», «led by [X](…)». Nombre = texto del enlace, dominio = el del enlace. */
const CUE_BEFORE = /(?:firms?|investors?|funds?|vcs?|backers?|backed by|led by|co-led by|participation from|such as|including|include|like)(?:(?![.!?]\s)[\s\S]){0,160}$/i;   // sin fin de oración entre la señal y el enlace
export function linkedInvestors(page, { max = 20 } = {}) {
  const text = String(page?.text || ''); const own = orgKey(page?.url); const out = []; const seen = new Set();
  for (const l of page?.links || []) {
    const key = orgKey(l.url); const name = clean(l.text);
    if (!key || key === own || seen.has(key) || isThirdParty(l.url) || !name || name.length > 60 || !/^[A-Z0-9]/.test(name)) continue;
    const at = text.indexOf(`[${l.text}](`); if (at < 0) continue;
    const before = text.slice(Math.max(0, at - 260), at).replace(/\]\([^)]*\)/g, ']').replace(/[\s*•·-]+/g, ' ');   // viñetas y saltos de línea: «include firms like:\n\n* [A](…)\n* [B](…)»
    if (!CUE_BEFORE.test(before)) continue;
    seen.add(key); out.push({ key, name, url: l.url, ref: l.ref || null }); if (out.length >= max) break;
  }
  return out;
}
