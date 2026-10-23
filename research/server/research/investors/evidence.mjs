/* ─────────────────────────────────────────────────────────────────────────────
   V15 · Inversionistas · Evidencia por código, con cita LITERAL y URL.
   El modelo no decide si un fondo sirve. Cada comprobación sale de una frase de las páginas del propio inversor:
     · investor   — la organización se presenta como inversora (no una empresa operativa, ni una página de partnering);
     · thesis     — una frase une invertir con el sector del brief (específica o amplia, ver sector.mjs);
     · stage      — etapas en las que dice invertir, comparadas con la del brief;
     · geography  — dónde dice invertir, comparado con el país CONFIRMADO del solicitante;
     · contact    — una vía para presentar o contactar (frase con verbo de acción o enlace del propio sitio);
     · recent     — actividad con un año reciente (respecto de `today`, no del reloj).
   Toda cita sale de `plain(texto)`, así `literalIn(cita, texto)` siempre la encuentra.
   Funciones puras.
   ───────────────────────────────────────────────────────────────────────────── */
import { plain } from '../verify.mjs';
import { sectorMatch } from './sector.mjs';
import { isArticleUrl, LISTISH, nameMatchesDomain, orgKey } from './orgs.mjs';

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
/** Frases de una página tal como las compara literalIn (sin markdown). */
export function sentencesOf(text) {
  return plain(text).split(/(?<=[.!?])\s+(?=[A-Z0-9“"'(])|\s{2,}|\s[•·▪|｜]\s|[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u).map((x) => x.trim()).filter(proseLike);
}
/** Frase de prosa, no un menú ni una fila de tabla: largo razonable y mayoría de palabras en minúscula. */
export function proseLike(x) {
  if (x.length < 25 || x.length > 420 || /https?:\/\//.test(x)) return false;
  const words = x.split(/\s+/).filter((w) => /[A-Za-z]/.test(w)); if (words.length < 5) return false;
  const caps = words.filter((w) => /^[A-Z]/.test(w)).length; return caps / words.length <= 0.5;
}

const SELF_INVEST = /\b(?:we|our (?:team|firm|fund|mission|strategy|approach|focus))\b[^.]{0,80}?\b(?:invest(?:s|ed|ing)?|back(?:s|ed|ing)?|partner(?:s|ed|ing)? with (?:founders|entrepreneurs|scientists|inventors|management teams|startups)|build (?:them|new companies|companies)|co-?found(?:s|ed|ing)? (?:companies|startups)|create(?:s|d)? (?:new )?companies|provide(?:s|d)? (?:venture |risk |seed |early[- ]stage )?capital)\b/i;
/** ¿La frase habla de la propia organización? (primera persona, o su nombre/etiqueta de dominio). Una nota de un medio habla de otros. */
const firstPerson = (s) => /\b(we|our|us)\b/i.test(s);
const compactOf = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
export function aboutSelf(s, org = {}) {
  if (firstPerson(s)) return true; const c = compactOf(s);
  const label = compactOf(String(org.key || '').split('.')[0]); if (label.length >= 4 && c.includes(label)) return true;
  if ((org.tokens || []).some((k) => c.includes(k))) return true;
  return (org.names || []).some((n) => { const k = compactOf(String(n).split(/[|｜–—:]/)[0]); return k.length >= 4 && c.includes(k); });
}
const NAME_INVEST = /\b(?:invests?|investing|funds|founds|co-?founds|backs|scales|builds|incubates|finances)\b[^.]{0,80}\b(?:companies|startups|founders|entrepreneurs|scientists|researchers|teams|biotechs?|innovators|healthcare|life sciences|technology)\b/i;
/** ¿La frase nombra a la propia organización (etiqueta del dominio o nombre), sin contar «we/our»? */
const namesOrg = (s, org = {}) => { const c = compactOf(s); const label = compactOf(String(org.key || '').split('.')[0]); if (label.length >= 4 && c.includes(label)) return true; return (org.names || []).some((n) => { const k = compactOf(String(n).split(/[|｜–—:]/)[0]); return k.length >= 4 && c.includes(k); }); };
const NOT_THESIS = /^[“"']|\bas an? (?:principal|partner|associate|analyst|investor|managing director|general partner|venture partner|vice president|director)\b|\b(?:he|she|they) (?:focus(?:es)?|invests?|leads?|works?|joined|serves?|sits?)\b|\b(years of experience|prior to joining|previously (?:served|worked|was)|joined (?:the firm|us)|he (?:is|was|has)|she (?:is|was|has)|his |her |is developing|helps (?:surgeons|patients|companies)|announc\w+|today|press release)\b/i;
const THESIS_CUE = /\b(invest(?:s|ed|ing|ment|ments)?\s+(?:(?:only|primarily|mainly|exclusively|globally|actively|early|broadly)\s+)?(?:in|into|across|behind|at|on)|we (?:back|support|partner with|build|create|co-?found|seek|look for|target|focus)|our (?:focus|thesis|investments?|investment (?:focus|strategy|thesis)|portfolio (?:spans|includes|focuses|covers)|strategy)|focus(?:es|ed)? (?:on|exclusively on)|(?:areas?|sectors?) of (?:focus|interest|investment)|backs?\s+(?:founders|companies|startups|entrepreneurs|teams|scientists)|venture capital (?:for|in)|(?:investor|investors|venture (?:capital )?(?:firm|fund)|fund) (?:focused|dedicated|investing|specializ\w+) (?:on|in|to))\b/i;
const INVESTOR_NOUN = /\b((?:the )?(?:first|lead|seed|early|venture) investor|(?:[\w-]+-(?:focused|first|native) )(?:fund|firm|investor|venture firm)|venture partners|(?:the )?(?:\w+ )?fund built for|venture capital (?:firm|fund|investor|arm|group)|venture (?:arm|fund|firm|investment(?:s)? (?:arm|group|team|unit))|corporate venture(?: capital)?(?: arm| fund| group)?|strategic (?:venture|investment) (?:fund|arm|group)|investment (?:firm|fund|arm|platform|company|manager)|life sciences? (?:investor|investment firm|venture)|evergreen fund|(?:single|multi)[- ]family office|family (?:office|investment office|capital)|private investment office|seed fund|early[- ]stage (?:fund|investor|venture)|venture creation|company creation|biotech (?:investor|venture firm|fund)|healthcare (?:investor|investment firm|venture))\b/i;
const PORTFOLIO = /\b(our portfolio(?: companies)?|portfolio companies|we have invested in|investments? (?:include|to date)|funds? under management|assets under management|AUM|fund [IVX]+\b|\$\s?\d[\d.,]*\s?(?:m|mm|million|b|bn|billion) (?:fund|under management|in commitments))\b/i;
const PARTNERING = /\b(partnering|business development|licens(?:e|ing) (?:opportunities|deals)|in-?licensing|search (?:and|&) evaluation|collaborat(?:e|ion) (?:opportunities|with us)|submit (?:a|your) (?:partnering|licensing) (?:proposal|opportunity))\b/i;

const INVEST_CUE = /\b(invest\w*|back(?:s|ed|ing)?|fund(?:s|ed|ing)?|financ\w*|portfolio|venture|capital|company creation|build(?:s|ing)? (?:new )?companies|seed|series [a-d]|startups?|founders?|entrepreneurs?|focus(?:es|ed)? on|our focus|areas? of (?:focus|interest)|sectors?|thesis)\b/i;

const STAGE_EARLY = /\b(pre-?seed|seed(?:[- ]stage)?|early[- ]stage|earliest stages?|series a|startups?|inception|formation|company creation|venture creation|incubat\w*|first[- ]check|first institutional|pre-?clinical|discovery[- ]stage)\b/i;
const STAGE_LATE = /\b(series [b-f]|growth(?:[- ]stage| equity)?|late[- ]stage|later[- ]stage|crossover|pre-?ipo|public (?:equities|companies)|commercial[- ]stage|buyouts?|mezzanine)\b/i;
const STAGE_ONLY = /\b(only|exclusively|solely|do not invest in (?:seed|early)|not (?:at|in) the seed)\b/i;

const REGIONS = [
  ['global', /\b(invest(?:s|ing)? (?:globally|worldwide|internationally|around the world|across the globe)|(?:global|international) (?:investor|investment firm|venture (?:capital )?(?:firm|fund)|life sciences? (?:investor|venture))|(?:companies|founders|startups|teams|entrepreneurs) (?:globally|worldwide|around the world|across the globe|from anywhere|in any country|across (?:the )?(?:us|u\.s\.|north america),? europe and asia)|without geographic (?:restrictions?|limits?)|geography[- ]agnostic|borderless)\b/i],
  ['us', /\b(united states|u\.s\.|usa|us-based|north americ\w*|american companies)\b/i],
  ['canada', /\bcanad\w*\b/i], ['latam', /\b(latin americ\w*|latam|south americ\w*|brazil\w*|mexic\w*|colombi\w*|argentin\w*|chile\w*)\b/i],
  ['europe', /\b(europe\w*|emea|dach)\b/i], ['uk', /\b(uk|united kingdom|britain|british)\b/i],
  ['nordics', /\b(nordic\w*|scandinavi\w*|denmark|danish|sweden|swedish|norway|norwegian|finland|finnish)\b/i],
  ['israel', /\b(israel\w*)\b/i], ['asia', /\b(asia\w*|apac|asia-pacific)\b/i], ['china', /\b(china|chinese|greater china)\b/i],
  ['japan', /\b(japan\w*)\b/i], ['india', /\bindia\w*\b/i], ['australia', /\b(australia\w*|new zealand|anz)\b/i], ['germany', /\bgerman\w*\b/i],
  ['france', /\bfrench|\bfrance\b/i], ['switzerland', /\b(switzerland|swiss)\b/i], ['africa', /\bafrica\w*\b/i], ['mena', /\b(middle east|mena|gulf)\b/i],
];
/** País del solicitante → regiones que lo incluyen. */
export const COUNTRY_REGIONS = {
  'united states': ['us'], usa: ['us'], us: ['us'], canada: ['canada'], colombia: ['latam'], mexico: ['latam'], brazil: ['latam'], argentina: ['latam'], chile: ['latam'],
  'united kingdom': ['uk', 'europe'], uk: ['uk', 'europe'], germany: ['germany', 'europe'], france: ['france', 'europe'], switzerland: ['switzerland', 'europe'], spain: ['europe'], italy: ['europe'], netherlands: ['europe'], ireland: ['europe'],
  denmark: ['nordics', 'europe'], sweden: ['nordics', 'europe'], norway: ['nordics', 'europe'], finland: ['nordics', 'europe'], israel: ['israel'], india: ['india', 'asia'], china: ['china', 'asia'], japan: ['japan', 'asia'], australia: ['australia'],
};
const LOCATION_ONLY = /\b(headquartered|offices? (?:in|located)|located in|based in [A-Z][a-z]+,|our (?:team|offices?) (?:in|across))\b/i;

const ACTION = /\b(pitch us|submit (?:a |your |an )?(?:pitch|deck|company|startup|business plan|plan|application|proposal|idea|opportunity)|apply (?:for funding|to (?:us|our)|now|here|today)|get in touch|contact us|reach out|send (?:us )?(?:your )?(?:deck|pitch|plan|business plan)|email (?:us|your (?:deck|pitch))|how to (?:pitch|apply|reach)|we (?:welcome|review) (?:pitches|proposals|business plans|inbound)|(?:pitch|invest|info|hello|contact|founders|submissions|deals|bd|ventures)@[\w.-]+\.[a-z]{2,})\b/i;
const CONTACT_LINK = /\b(pitch|submit|apply|founders?|get in touch|contact|connect|work with us|partner with us|start a conversation|talk to us)\b/i;
const ACTIVITY = /\b(invest\w*|portfolio|raised|led|co-led|closed|announc\w*|fund\w*|round|financing|backed|joins?|new|launch\w*|participat\w*|acquired|ipo)\b/i;

/** Una comprobación: { ok, value, quote, url } (quote literal de la página `url`). */
const hit = (ok, value, s, url) => ({ ok, value, quote: s ? clean(s).slice(0, 400) : null, url: s ? url : null });
const miss = (value = null) => ({ ok: false, value, quote: null, url: null });

/** Etapa que busca el brief: 'early' | 'growth' | null (no dicho). */
export function briefStage(brief = {}) {
  const t = `${brief.stage || ''} ${brief.round || ''} ${brief.oneLiner || ''}`.toLowerCase();
  if (/\b(series [b-e]|growth|scale-?up|revenue[- ]stage|commercial[- ]stage)\b/.test(t)) return 'growth';
  if (/\b(pre-?seed|seed|idea|concept|experimental|prototype|pre-?revenue|early|discovery|pre-?clinical|research[- ]stage|series a|mvp|capability|unknown candidate|no candidate)\b/.test(t)) return 'early';
  return null;
}

/**
 * Evidencia de un expediente de organización. pages: [{url, title, text, links}] del MISMO dominio registrable.
 * facts: { country: string|null } (solo lo que el brief confirma). sector: sectorOf(brief).
 */
export function orgEvidence({ pages = [], sector, brief = {}, facts = { country: null }, today, org: org0 = {} }) {
  // Los nombres vienen de títulos de búsqueda: el título de un artículo sobre «EQT Life Sciences» o de un perfil de «Angelini Ventures» no es el nombre del sitio.
  // Solo cuenta como nombre propio el que coincide con el dominio; así una frase sobre OTRO fondo en un medio, directorio o conferencia no pasa por «habla de sí misma».
  const org = { ...org0, names: (org0.names || []).flatMap((n) => String(n).split(/[|｜–—:]/)).map((n) => n.trim()).filter((n) => n && org0.key && (nameMatchesDomain(n, `https://${org0.key}`) || compactOf(n).includes(compactOf(String(org0.key).split('.')[0])))) };
  // Primera palabra del nombre propio (≥6 letras, no genérica): «Amplify Bio» es Amplify Partners.
  org.tokens = [...new Set(org.names.map((n) => compactOf(n.split(/\s+/)[0])).filter((k) => k.length >= 6 && !/^(venture|ventures|capital|partners|global|holdings|healthcare|medical|life|sciences|science|biotech|investments?|fund)$/.test(k)))];
  const year = Number(String(today || '').slice(0, 4)) || null;
  const rows = []; for (const p of pages) for (const s of sentencesOf(p.text)) rows.push({ s, url: p.url, article: isArticleUrl(p.url) });
  const inst = rows.filter((r) => !r.article);   // las frases institucionales mandan; las de noticias propias solo cuentan como actividad
  const pick = (list, fn) => { for (const r of list) { const v = fn(r.s); if (v) return { r, v }; } return null; };

  // investor
  const own = (s) => aboutSelf(s, org);
  const selfInv = pick(inst, (s) => SELF_INVEST.test(s) || (INVESTOR_NOUN.test(s) && own(s)) || (NAME_INVEST.test(s) && namesOrg(s, org) && !NOT_THESIS.test(s))) || pick(rows, (s) => INVESTOR_NOUN.test(s) && own(s));
  const port = pick(inst, (s) => PORTFOLIO.test(s) && own(s));
  const partnering = pick(inst, (s) => PARTNERING.test(s));
  const investor = selfInv ? hit(true, 'investor', selfInv.r.s, selfInv.r.url) : port ? hit(true, 'portfolio', port.r.s, port.r.url) : partnering ? hit(false, 'partnering', partnering.r.s, partnering.r.url) : miss('none');

  // thesis: frase con señal de inversión + sector; se prefiere la específica, luego la que más términos nombra
  const thesisRows = [];
  // El nombre del propio fondo no cuenta como sector («Chemistry VC invests in…» no es una tesis de química).
  const nameRx = [...new Set([String(org.key || '').split('.')[0], ...(org.names || []).map((n) => String(n).split(/[|｜–—:]/)[0].trim())].filter((n) => n.length >= 3))].map((n) => new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'));
  const unnamed = (x) => nameRx.reduce((t, rx) => t.replace(rx, ' '), x);
  for (const r of inst) { if (!(THESIS_CUE.test(r.s) || (NAME_INVEST.test(r.s) && namesOrg(r.s, org)) || /\b(?:first|lead|seed|early|venture) investor (?:for|in)\b/i.test(r.s)) || NOT_THESIS.test(r.s) || !(own(r.s) || /^(?:invest|backing|focus|we|our)/i.test(r.s))) continue; const m = sectorMatch(unnamed(r.s), sector); if (m.level) thesisRows.push({ ...r, m }); }
  thesisRows.sort((a, b) => (a.m.level === 'specific' ? 0 : 1) - (b.m.level === 'specific' ? 0 : 1) || b.m.terms.length - a.m.terms.length);
  const tBest = thesisRows[0];
  const thesis = tBest ? { ...hit(true, tBest.m.level, tBest.s, tBest.url), terms: tBest.m.terms, all_terms: [...new Set(thesisRows.flatMap((x) => x.m.terms))].slice(0, 12), sentences: thesisRows.length } : { ...miss(null), terms: [], all_terms: [], sentences: 0 };

  // stage
  const want = briefStage(brief);
  const stageOk = (s) => own(s) && !NOT_THESIS.test(s) && /\b(invest\w*|back\w*|lead\w*|partner\w*|stage|rounds?|checks?|capital)\b/i.test(s);
  // Se prefiere la frase con verbo de inversión («we invest only in late-stage…») sobre un nombre («Late Stage Fund is…»).
  const verbFirst = (list) => [...list.filter((r) => /\b(invest\w*|back\w*|lead\w*)\b/i.test(r.s)), ...list.filter((r) => !/\b(invest\w*|back\w*|lead\w*)\b/i.test(r.s))];
  const early = pick(verbFirst(inst), (s) => stageOk(s) && STAGE_EARLY.test(s));
  const lates = inst.filter((r) => stageOk(r.s) && STAGE_LATE.test(r.s));
  const late = pick([...lates.filter((r) => STAGE_ONLY.test(r.s)), ...verbFirst(lates.filter((r) => !STAGE_ONLY.test(r.s)))], () => true);
  const lateOnly = Boolean(late) && !early && lates.some((r) => STAGE_ONLY.test(r.s));
  const investorStages = [early ? 'early' : null, late ? 'late' : null].filter(Boolean);
  let stageFit = 'unknown';
  if (!investorStages.length) stageFit = 'not_stated';
  else if (!want) stageFit = 'brief_unknown';
  else if (want === 'early') stageFit = early ? 'yes' : lateOnly ? 'no' : 'doubtful';
  else stageFit = late ? 'yes' : 'doubtful';
  const st = early || late;
  const stage = { ...(st ? hit(stageFit === 'yes', stageFit, (early || late).r.s, (early || late).r.url) : miss(stageFit)), investor_stages: investorStages, brief_stage: want };

  // geography
  // «ayudamos a escalar empresas globalmente» no dice dónde invierte: «global» exige un verbo de inversión en la misma frase.
  const INVEST_VERB = /\b(invest\w*|back(?:s|ed|ing)?|fund(?:s|ed|ing)?|portfolio)\b/i;
  const regionsIn = (s) => REGIONS.filter(([k, rx]) => rx.test(s) && (k !== 'global' || INVEST_VERB.test(s))).map(([k]) => k);
  const geoRow = pick(inst, (s) => own(s) && !NOT_THESIS.test(s) && /\b(invest\w*|back\w*|portfolio|founders|companies|startups|entrepreneurs)\b/i.test(s) && !LOCATION_ONLY.test(s) && regionsIn(s).length > 0);
  const regions = geoRow ? regionsIn(geoRow.r.s) : [];
  const exclusive = geoRow && /\b(only|exclusively|solely|must be (?:based|headquartered|incorporated))\b/i.test(geoRow.r.s);
  const want2 = facts.country ? (COUNTRY_REGIONS[String(facts.country).toLowerCase().trim()] || []) : null;
  let geoFit;
  if (!geoRow) geoFit = 'not_stated';
  else if (regions.includes('global')) geoFit = 'yes';
  else if (!want2) geoFit = 'applicant_unknown';
  else if (regions.some((r) => want2.includes(r))) geoFit = 'yes';
  else geoFit = exclusive ? 'no' : 'doubtful';
  const geography = { ...(geoRow ? hit(geoFit === 'yes', geoFit, geoRow.r.s, geoRow.r.url) : miss(geoFit)), regions, exclusive: Boolean(exclusive) };

  // contact
  const act = pick(rows, (s) => ACTION.test(s));
  let contact;
  if (act) contact = { ...hit(true, /pitch|deck|submit|apply|business plan|founders@|submissions@|deals@/i.test(act.r.s) ? 'pitch' : 'contact', act.r.s, act.r.url), link: null };
  // sin frase: un enlace del propio sitio (URL verificable) a contacto/pitch
  else {
    let link = null;
    for (const p of pages) for (const l of p.links || []) { if (!link && orgKey(l.url) === orgKey(p.url) && CONTACT_LINK.test(`${l.text || ''} ${l.url}`) && !/linkedin|twitter|facebook/i.test(l.url)) link = { text: clean(l.text).slice(0, 80), url: l.url, from: p.url }; }
    for (const p of pages) for (const l of p.links || []) { if (!link && /^mailto:/i.test(l.url)) link = { text: clean(l.text).slice(0, 80), url: l.url, from: p.url }; }
    contact = link ? { ok: true, value: /pitch|submit|apply|founder/i.test(`${link.text} ${link.url}`) ? 'pitch' : 'contact', quote: null, url: link.from, link } : { ...miss('none'), link: null };
  }

  // recent
  const recentYears = year ? [year, year - 1] : [];
  const rec = recentYears.length ? pick(rows, (s) => recentYears.some((y) => new RegExp(`\\b${y}\\b`).test(s)) && ACTIVITY.test(s)) : null;
  const recent = rec ? hit(true, Number((rec.r.s.match(/\b20\d{2}\b/g) || []).filter((y) => recentYears.includes(Number(y)))[0]), rec.r.s, rec.r.url) : miss(null);

  // Firma de servicios (asesoría M&A, agencia de marketing, base de datos de contactos): habla de fondos, no invierte. Una frase propia «we invest…» la salva.
  const SERVICE_FIRM = /\b(we advis(?:ed|e)|advis(?:ed|es|ing) (?:on|the|\w+ on)|m&a advisory|sell-side|buy-side|fundraising advisory|vc fundraising for|placement agent|marketing agency|lead generation|contacts tracked|smartsearch|consulting firm|investment bank)\b/i;
  const strongSelf = inst.some((r) => /\bwe (?:primarily |actively |only |exclusively |mainly |also )?(?:invest|back|co-?invest)\b|\bour (?:funds?|portfolio(?!-)(?: companies)?)\b|\bwe are (?:a|an) [\w\s-]{0,30}(?:venture|investor|investment firm|fund)\b/i.test(r.s));
  // Basta una mención suelta («selective M&A advisory work» en un fondo de verdad) NO: hace falta que lo diga en el título o al comienzo de una página, o que aparezcan al menos dos señales distintas.
  const svcSet = new Set(); let svcNear = false;
  for (const p of pages) { const t = plain(p.text); for (const m of t.slice(0, 4000).matchAll(new RegExp(SERVICE_FIRM.source, 'gi'))) svcSet.add(m[0].toLowerCase()); if (SERVICE_FIRM.test(`${p.title || ''} ${t.slice(0, 300)}`)) svcNear = true; }
  const service = !strongSelf && (svcSet.size >= 2 || svcNear);
  // Directorio/conferencia/medio con perfiles de VARIOS fondos en primera persona («5AM Ventures is a leading venture capital firm…», «Angelini Ventures invests…»):
  // si el sitio no suena a fondo y al menos tres frases empiezan con el nombre de OTRO fondo, es un directorio.
  const foreign = new Set(); const FUND_NAME = /^([A-Z0-9][\w&.'’-]*(?:\s+[A-Z][\w&.'’-]*){0,3}\s+(?:Ventures?|Capital|Partners|Fund|VC|Bio\w*|Life Sciences|Healthcare))\b/;
  for (const r of rows) { const m = FUND_NAME.exec(r.s); if (m && !aboutSelf(m[1], org) && /\b(is|are|invests?|focus\w*|backs?|builds?|creates?|partners?|seeks?|provides?|helps?|supports?)\b/i.test(r.s)) foreign.add(m[1].toLowerCase()); }
  const labelFundy = /(venture|capital|invest|fund|vc|partners|holdings|equity|angel|seed)/i.test(String(org.key || '').split('.')[0]);
  const aggregator = !labelFundy && foreign.size >= 3;
  const directory = aggregator || pages.some((p) => LISTISH.test(`${p.title || ''} ${plain(p.text).slice(0, 700)}`));
  return { investor, thesis, stage, geography, contact, recent, directory, service, chars: pages.reduce((n, p) => n + String(p.text || '').length, 0), pages: pages.map((p) => p.url) };
}
