// V5-2 — Triage previo al fetch (config.triage.enabled). Heurística determinista sobre lo que ya trae el buscador
// (URL, título, highlights/snippet): descarta listas, rankings, directorios, perfiles de agregador y enciclopedias;
// baja de prioridad noticias, blogs y notas de prensa; sube páginas propias de firma (about/strategy/focus/portfolio).
// Un host que ya es firma conocida en la corrida nunca se descarta ni se baja. No cambia la métrica: un descartado no es fetch.
import { investorHostname as host, sameDomain } from './extractor.mjs';

export const TRIAGE_VERSION = 'triage.v1';
const FIRMISH = /\b(ventures?|capital|partners|fund|vc|investments?|invest|equity|holdings)\b|\.vc$|\.fund$|\.capital$|\.ventures$|\.partners$/i;
const PORTFOLIO_ITEM = /\/(?:portfolio|portafolio|company|companies|investments?|inversiones|startups?)\/[^/]+/i;
const FIRMISH_HOST = /ventures?|capital|partners|invest|equity|fonden|fonds|fondo|fundo|\.vc$|\.fund$|(?:^|[.-])vc[.-]|fund(?:s)?\.(?!net)/i;
// Hosts que publican perfiles o listas de terceros, nunca la tesis de primera parte de una firma.
const AGGREGATOR_HOSTS = ['wikipedia.org', 'linkedin.com', 'tracxn.com', 'cbinsights.com', 'dealroom.co', 'crunchbase.com', 'pitchbook.com', 'f6s.com', 'wellfound.com', 'angel.co', 'signal.nfx.com', 'openvc.app', 'shizune.co', 'vcsheet.com', 'seedtable.com', 'failory.com', 'parsers.vc', 'vcbacked.co', 'gritt.io', 'fundz.net', 'startupintros.com', 'connectsafely.ai', 'descubre.vc', 'mergr.com', 'zoominfo.com', 'golden.com', 'owler.com', 'growjo.com', 'rocketreach.co', 'apollo.io', 'craft.co', 'globaldatabase.com', 'dnb.com', 'bloomberg.com/profile', 'privco.com', 'ycombinator.com/companies', 'producthunt.com', 'medium.com', 'reddit.com', 'quora.com', 'youtube.com', 'facebook.com', 'instagram.com', 'x.com', 'twitter.com'];
const LIST_TITLE = /\b(?:top|best|leading|most active)\s+\d*\s*(?:vc|venture|investors?|funds?|firms?|startups?|accelerators?|angel)|\b\d+\s+(?:best|top|leading|most active|vc|venture|investors?|funds?|firms?)\b|\blist of\b|\bdirectory\b|\branking\b|\brankings\b|\bdatabase of\b|\b(?:los|las)\s+(?:mejores|principales)\b|\blista de\b|\bdirectorio\b|\bos melhores\b|\bmaiores\b/i;
const LIST_PATH = /\/(?:lists?|rankings?|directory|directorio|database|top-\d+|best-[a-z-]*|investors\/[a-z-]*-(?:vc|funds?|investors)[a-z-]*)(?:\/|$|[-_])/i;
const PROFILE_PATH = /\/(?:company|companies|startup|startups|orgs?|organization|organizations|profile|profiles|fund-profile)\//i;
const NEWS_PATH = /\/(?:news|blog|blogs|press|press-releases?|pressreleases|newsroom|noticias|prensa|articles?|article|stories|story|insights|media|posts|post|magazine|podcasts?|events?|\d{4}\/\d{2})(?:\/|$)/i;
const NEWS_TITLE = /\b(?:raises?|raised|secures?|secured|closes?|closed|lands?|bags?|announces?|funding round|series [a-e]\b|seed round|recibe|levanta|cierra|capta|rodada)\b/i;
const NEWS_HOST = /(?:news|noticias|times|post|journal|magazine|wire|daily|insider|review|weekly|tech\.eu|techcrunch|crunchbase news|sifted|eu-startups|latamlist|contxto|bloomberglinea|businesswire|prnewswire|cision|globenewswire)/i;
const FIRM_PATH = /\/(?:about|about-us|who-we-are|strategy|investment-strategy|investment-focus|investment-criteria|focus|thesis|approach|portfolio|team|what-we-do|invest|investing|funds?|nosotros|quienes-somos|qui[eé]nes-somos|estrategia|enfoque|tesis|portafolio|portfolio|sobre|sobre-nos|sobre-n[oó]s|estrat[eé]gia|foco)(?:\/|$|[-_.])/i;

const inList = (h, list) => list.some(d => d.includes('/') ? false : (h === d || h.endsWith(`.${d}`)));
const inPathList = (url, list) => list.some(d => d.includes('/') && String(url).toLowerCase().includes(d));

/** Clasifica un resultado. @returns {{action:'keep'|'demote'|'discard', score:number, reason:string|null}} */
export function triageResult(result, { knownFirmHosts = [] } = {}) {
  const url = String(result?.url ?? ''), h = host(url);
  let path = '/'; try { path = new URL(url).pathname.toLowerCase(); } catch { /* sin URL válida */ }
  const title = String(result?.title ?? ''), lead = `${title} ${String(result?.highlights ?? result?.snippet ?? '').slice(0, 300)}`;
  const known = Boolean(h) && knownFirmHosts.some(d => sameDomain(h, d));
  const firmHost = FIRMISH_HOST.test(h ?? ''), firmTitle = FIRMISH.test(title), firmish = firmHost || firmTitle;
  if (known) return { action: 'keep', score: 4 + (FIRM_PATH.test(path) ? 1 : 0), reason: 'known_firm_host' };
  if (!h) return { action: 'discard', score: -9, reason: 'invalid_url' };
  if (inList(h, AGGREGATOR_HOSTS) || inPathList(url, AGGREGATOR_HOSTS)) return { action: 'discard', score: -9, reason: 'aggregator_host' };
  if (LIST_TITLE.test(title) || LIST_PATH.test(path)) return { action: 'discard', score: -9, reason: 'list_or_directory' };
  if (PROFILE_PATH.test(path) && !firmHost) return { action: 'discard', score: -9, reason: 'aggregator_profile' };
  let score = (firmHost ? 2 : firmTitle ? 1 : 0), reason = null;
  const segs = path.split('/').filter(Boolean);
  if (segs.length === 0) score += firmHost ? 1 : 0;
  // Página de una participada dentro del sitio de la firma (/portfolio/<empresa>, /company/<empresa>): habla de la startup.
  if (firmHost && segs.length >= 2 && PORTFOLIO_ITEM.test(path)) return { action: 'demote', score: -1, reason: 'portfolio_item' };
  if (FIRM_PATH.test(path) && segs.length <= 2) score += 1;
  const newsy = NEWS_PATH.test(path) || NEWS_HOST.test(h) || (NEWS_TITLE.test(title) && !firmHost);
  // En un host con aspecto de firma la noticia suele ser propia (anuncio de inversión): se baja menos.
  if (newsy) { score -= firmHost ? 2 : 3; reason = NEWS_PATH.test(path) ? 'news_or_blog_path' : NEWS_HOST.test(h) ? 'news_host' : 'news_title'; }
  else if (NEWS_TITLE.test(lead) && !firmHost) { score -= 1; reason = 'round_announcement'; }
  return { action: score < 0 ? 'demote' : 'keep', score, reason };
}

/** Triage de una lista de resultados (índices de la respuesta original). */
export function triageSearchResults(results, ctx = {}) {
  const rows = (results ?? []).map((r, i) => ({ i, url: r.url, ...triageResult(r, ctx) }));
  return {
    version: TRIAGE_VERSION,
    discarded: rows.filter(r => r.action === 'discard').map(({ i, url, reason }) => ({ i, url, reason })),
    demoted: rows.filter(r => r.action === 'demote').map(({ i, url, reason, score }) => ({ i, url, reason, score })),
    scores: Object.fromEntries(rows.map(r => [r.i, r.score]))
  };
}
