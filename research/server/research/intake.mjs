// Agente de prerregistro: conversación + documentos -> perfil estructurado que el usuario confirma
// antes de investigar. El modelo (Qwen u otro vía endpoint OpenAI-compatible) es OPCIONAL: sin él,
// la extracción heurística y las preguntas guiadas mantienen el flujo. Principio: el modelo propone,
// el código valida rutas, enums y citas. Nada de lo extraído se usa hasta que el usuario confirma.
import { parseWindow, windowLabel } from './window.mjs';
import { randomUUID } from 'node:crypto';
import { norm } from './core.mjs';
import { fleetConfig } from '../analysis/fleet.mjs';

export const OBJECTIVES = ['investment', 'grant', 'partnering', 'sponsorship', 'debt'];
export const ENTITY_TYPES = ['for_profit', 'nonprofit', 'academic'];
export const RELATIONS = ['same', 'subsidiary', 'spinout', 'sponsored', 'portfolio', 'client', 'other'];
export const MATURITY = ['idea', 'prototype', 'preclinical', 'clinical_phase_1', 'clinical_phase_2', 'clinical_phase_3', 'marketed', 'other'];
export const ROUNDS = ['pre-seed', 'seed', 'series-a', 'series-b', 'series-c', 'growth', 'public'];
export const SECTORS = ['AI', 'biotech', 'digital health', 'pharma', 'medtech', 'neuro', 'mental health', 'diagnostics', 'climate', 'fintech', 'enterprise', 'consumer'];

/* Ontología del perfil. `ask` = pregunta guiada; `required` = necesario para investigar. */
export const FIELDS = [
  { path: 'company.name', label: 'Company or project to fund', kind: 'text', required: true, ask: 'What\'s the name of the company or project you want to fund?' },
  { path: 'product.name', label: 'Product or project', kind: 'text', required: true, ask: 'Which product or project do you want to fund? If there are several, let\'s start with one.' },
  { path: 'funding.objectives', label: 'What you\'re looking for', kind: 'enumList', options: OBJECTIVES, required: true, ask: 'What are you looking for: investment (VC or angels), non-dilutive grants, partnering, sponsorship or debt? Can be more than one.' },
  { path: 'product.one_liner', label: 'What it does', kind: 'text', required: true, ask: 'In one sentence: what does the product do, and for whom?' },
  { path: 'industry.sectors', label: 'Sector', kind: 'list', required: true, ask: 'Which sector or therapeutic area do you work in?' },
  { path: 'product.maturity', label: 'Stage', kind: 'enum', options: MATURITY, required: true, ask: 'Where is it: idea, prototype, preclinical, clinical or on the market?' },
  { path: 'geography', label: 'Geography', kind: 'list', required: true, ask: 'Where do you operate and which countries do you want funding from?' },
  { path: 'funding.amount_usd', label: 'Amount (USD)', kind: 'number', ask: 'Roughly how much do you need, in USD?' },
  { path: 'funding.round', label: 'Round', kind: 'enum', options: ROUNDS, ask: 'What kind of financing is this: pre-seed, seed, Series A/B/C, growth, or — if the company is listed — a public offering or PIPE? The type decides which investors can take it.' },
  { path: 'company.traction', label: 'Proof it works so far', kind: 'text', investor: true, ask: 'What proof do you have so far that people want this or that it works? For example: 200 users, 3 pilots, $10k in revenue, a signed letter of intent or study results. Numbers help.' },
  { path: 'funding.use_of_funds', label: 'Use of funds', kind: 'text', investor: true, ask: 'What will this money get you to, concretely: which milestone, and by when?' },
  { path: 'product.differentiation', label: 'Why you win', kind: 'text', investor: true, ask: 'Why will you win against the alternatives people use today?' },
  { path: 'product.business_model', label: 'Business model', kind: 'text', investor: true, ask: 'Who pays, how much, and how do you reach them?' },
  { path: 'company.team', label: 'Team', kind: 'text', investor: true, ask: 'Who is on the team, and why are you the right people to build this?' },
  { path: 'competitors', label: 'Competitors', kind: 'list', ask: 'Which named companies or products are direct competitors? We use them to avoid conflicts.' },
  { path: 'constraints', label: 'Constraints', kind: 'list', ask: 'Anything to avoid: investor types, countries, conflicts or terms?' },
  { path: 'organization.name', label: 'Organization you represent', kind: 'text', ask: 'Are you raising for that company directly or from another organization? e.g. IGC seeking sponsorship for Mentiva.' },
  { path: 'company.entity_type', label: 'Type of organization', kind: 'enum', options: ENTITY_TYPES, grant: true, ask: 'Who would receive the grant: a for-profit company, a nonprofit, or a university or research institute? Many calls only accept one of these.' },
  { path: 'company.country', label: 'Country of the applicant', kind: 'text', grant: true, ask: 'In which country is the applicant based? Many calls only fund local applicants.' },
  { path: 'company.state', label: 'State or region of the applicant', kind: 'text', grant: true, ask: 'In which state or region (and city) is the applicant based? State and regional programs fund only local applicants.' },
  { path: 'company.city', label: 'City of the applicant', kind: 'text' },
  { path: 'company.relation', label: 'Relationship to the company', kind: 'enum', options: RELATIONS },
  { path: 'criteria', label: 'Criteria', kind: 'list' },
  { path: 'founder.title', label: 'Your role', kind: 'text' },
  { path: 'product.description', label: 'Description', kind: 'text' },
  { path: 'funding.timeline', label: 'Timeline', kind: 'text' },
  { path: 'funding.apply_window', label: 'When you can apply', kind: 'window', grant: true, ask: 'In which dates can you apply: for example November to December 2026, or before the end of the year? Calls closing outside that window are set aside.' },
  { path: 'company.website', label: 'Website', kind: 'text' },
];
const FIELD = Object.fromEntries(FIELDS.map((f) => [f.path, f]));
const LONG_TEXT = new Set(['company.traction', 'funding.use_of_funds', 'product.differentiation', 'product.business_model', 'company.team']);
const ASK = FIELDS.filter((f) => f.ask);
export const LIMITS = { docChars: 60_000, docs: 8, messageChars: 4000, history: 60 };

const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const uniq = (list) => { const seen = new Set(); return list.filter((x) => { const k = norm(x); if (!k || seen.has(k)) return false; seen.add(k); return true; }); };
const sentences = (text) => String(text || '').split(/(?<=[.!?;])\s+|\n+/).map((s) => s.trim()).filter((s) => s.length > 1).slice(0, 5000);
export const fieldValue = (s, path) => s.fields[path]?.value;
const filled = (s, path) => { const v = fieldValue(s, path); return Array.isArray(v) ? v.length > 0 : v !== undefined && v !== null && v !== ''; };

/* ───────── Normalizadores de dominio ───────── */
const SECTOR_RX = {
  AI: /\b(ai|ia|inteligencia artificial|artificial intelligence|machine learning|aprendizaje automatico|deep learning|llms?|modelos? de lenguaje)\b/,
  biotech: /\b(biotech\w*|biotecnolog\w*|biologics?|terapia genica|gene therapy|anticuerpos?|antibod\w*|celulas madre|cell therapy)\b/,
  'digital health': /\b(digital health|salud digital|telemedicin\w*|telehealth|telesalud|remote monitoring|monitoreo remoto|historia clinica electronica)\b/,
  pharma: /\b(pharma\w*|farmaceutic\w*|drugs?|medicamentos?|small molecules?)\b/,
  medtech: /\b(medtech|medical devices?|dispositivos? medicos?|wearables?|implantes?|sensores? medicos?)\b/,
  neuro: /\b(neuro\w*|alzheimer\w*|dementia|demencia|parkinson\w*|cerebr\w*|brain|cognitiv\w*)\b/,
  'mental health': /\b(mental health|salud mental|depresion|depression|ansiedad|anxiety|estres|stress|psiquiatr\w*|psychiatr\w*)\b/,
  diagnostics: /\b(diagnostic\w*|diagnostico\w*|biomarcador\w*|biomarkers?|screening|tamizaje)\b/,
  climate: /\b(climate|cambio climatico|carbon\w*|carbono|energia renovable|renewable|sostenib\w*|sustainab\w*)\b/,
  fintech: /\b(fintech|pagos digitales|payments?|banca|banking|credito digital|lending|insurtech)\b/,
  enterprise: /\b(b2b|saas|enterprise|software empresarial)\b/,
  consumer: /\b(consumer|b2c|consumidor\w*|retail|ecommerce|e commerce)\b/,
};
export const mapSectors = (text) => { const t = norm(text); return Object.entries(SECTOR_RX).filter(([, rx]) => rx.test(t)).map(([k]) => k); };

const GEO_RX = [
  ['US', /\b(estados unidos|united states|norteamerica|eeuu|ee uu)\b/, /\b(US|USA|U\.S\.A?\.?|EE\.? ?UU\.?)(?![a-z])/],
  ['CA', /\b(canada)\b/], ['UK', /\b(reino unido|united kingdom|inglaterra|england|londres|london)\b/, /\bUK\b/],
  ['EU', /\b(europa|europe|union europea|european union)\b/, /\bEU\b/], ['ES', /\b(espana|spain|madrid|barcelona)\b/],
  ['DE', /\b(alemania|germany)\b/], ['FR', /\b(francia|france)\b/], ['CO', /\b(colombia|bogota|medellin|barranquilla)\b/],
  ['MX', /\b(mexico|cdmx|monterrey|guadalajara)\b/], ['BR', /\b(brasil|brazil|sao paulo)\b/], ['CL', /\b(chile|santiago de chile)\b/],
  ['AR', /\b(argentina|buenos aires)\b/], ['PE', /\b(peru)\b/], ['LATAM', /\b(latam|latinoamerica|latin america|america latina|iberoamerica)\b/],
  ['GLOBAL', /\b(worldwide|a nivel mundial|todo el mundo)\b/],
];
export function mapGeo(text) {
  const t = norm(text);
  return GEO_RX.filter(([, rx, cs]) => rx.test(t) || (cs && cs.test(String(text)))).map(([code]) => code);
}
const OBJ_RX = {
  grant: /\b(grants?|subvencion\w*|becas?|no dilutiv\w*|non dilutive|nih|sbir|sttr|convocatorias?|fundaciones|foundations?|horizon europe|minciencias|innovate uk|darpa|barda|cdmrp)\b/,
  investment: /\b(inversion|inversiones|inversionistas?|inversores?|investors?|investment|venture|vc|vcs|capital de riesgo|angel\w*|angeles|equity|ronda|round|pre seed|seed|semilla|serie a|series a)\b/,
  partnering: /\b(partnering|partners?hip\w*|socios? estrategicos?|alianzas?|licencia\w*|licensing|licenciar|co desarrollo|codesarrollo|co development|strategic partners?|business development)\b/,
  debt: /\b(deuda|creditos?|prestamos?|loans?|debt|venture debt)\b/,
  sponsorship: /\b(patrocin\w*|sponsor\w*|mecenazgo|responsabilidad social|csr)\b/,
};
export const mapObjectives = (text) => { const t = norm(text); return OBJECTIVES.filter((o) => OBJ_RX[o].test(t)); };
// Un documento puede MENCIONAR "inversionistas" o "grants" sin que el usuario los esté pidiendo
// (p. ej. la documentación técnica de este mismo producto). En la extracción por frase exigimos
// además una intención en primera persona; interpretAnswer() no usa este filtro porque ahí la
// frase completa YA es la respuesta directa a "¿qué buscas?".
const INTENT_CTX = /\b(buscamos|buscando|busco|estamos buscando|necesitamos|necesito|queremos|quiero|nos interesa|nos gustaria|levant\w*|recaudar|solicitamos|solicitar|aplicar(?:emos)? a|aplicando a|postular\w* a|we are (?:seeking|raising|looking)|seeking|raising a|looking for|apply(?:ing)? for)\b/;
const NEG_INTENT = /\bno\s+(?:queremos|buscamos|necesitamos|quiero|aceptamos)\b|\b(?:not interested|don'?t want|do not want)\b/;
export function mapRound(text) {
  const t = norm(text);
  if (/\bpre ?seed\b|\bpre semilla\b|\bpresemilla\b/.test(t)) return 'pre-seed';
  // Empresa cotizada: su «ronda» es una oferta pública, PIPE, follow-on o línea ATM; no es seed ni Serie A.
  if (/\b(public|publica|publico|publicly|listed|cotiza\w*|ipo|follow ?on|pipe|private placement|registered direct|atm|at the market|nyse|nasdaq|otc|bolsa|oferta publica)\b/.test(t)) return 'public';
  if (/\bseries? b\b|\bserie b\b/.test(t)) return 'series-b';
  if (/\bseries? a\b|\bserie a\b/.test(t)) return 'series-a';
  if (/\bseries? c\b|\bserie c\b/.test(t)) return 'series-c';
  if (/\bgrowth\b|\bcrecimiento\b|\bseries? [d-z]\b|\bserie [d-z]\b|\bpre ?ipo\b|\bcrossover\b|\blate stage\b/.test(t)) return 'growth';
  if (/\bseed\b|\bsemilla\b/.test(t)) return 'seed';
  return null;
}
export function mapMaturity(text) {
  const t = norm(text);
  if (/\b(fase|phase) (3|iii)\b/.test(t)) return 'clinical_phase_3';
  if (/\b(fase|phase) (2|ii)\b/.test(t)) return 'clinical_phase_2';
  if (/\b(fase|phase) (1|i)\b|\bfirst in human\b/.test(t)) return 'clinical_phase_1';
  if (/\bpre ?clinic\w*\b|\bin vivo\b|\bmodelos? animal\w*\b|\banimal models?\b/.test(t)) return 'preclinical';
  if (/\ben el mercado\b|\bcomercializ\w*\b|\bon the market\b|\bclientes que pagan\b|\bpaying customers\b|\bingresos recurrentes\b|\blanzad[oa] al mercado\b|\blaunched\b/.test(t)) return 'marketed';
  if (/\bprototip\w*\b|\bprototypes?\b|\bmvp\b|\bpilotos?\b|\bpilots?\b|\bbeta\b/.test(t)) return 'prototype';
  if (/\bidea\b|\bconcepto\b|\bconcept\b/.test(t)) return 'idea';
  return null;
}
export function parseAmount(raw, unit = '') {
  let n = String(raw).trim().replace(/[.,]+$/, '');
  if (/^\d{1,3}([.,]\d{3})+$/.test(n)) n = n.replace(/[.,]/g, ''); else n = n.replace(',', '.');
  let v = Number(n);
  if (!Number.isFinite(v)) return null;
  const u = norm(unit);
  if (/^(m|mm|mill|million|millions|millon|millones)$/.test(u)) v *= 1e6;
  else if (/^(k|mil|thousand)$/.test(u)) v *= 1e3;
  else if (/^(b|bn|billion)$/.test(u)) v *= 1e9;
  return v >= 1000 && v < 1e12 ? Math.round(v) : null;
}
const MONEY = /(?:US\$|USD|U\$S|\$)\s?(\d[\d.,]*)\s?(millones|millón|millon|million|mm|m|mil|k|bn|b)?\b|(\d[\d.,]*)\s?(millones|millón|millon|million|mm|m|mil|k)\s?(?:de\s)?(?:USD|US\$|d[oó]lares)/gi;
const RAISE_CTX = /\b(levant\w*|buscamos|necesitamos|ronda|raise|raising|funding|financiacion|financiamiento|ask|solicitamos|recaudar|objetivo)\b/;
const NOT_RAISE = /\b(tam|sam|som|mercado|market|valoracion|valuation|ingresos|revenue|ventas|arr|mrr|facturacion)\b/;
const AMOUNT_RX = /(\d[\d.,]*)\s*(millones|millón|millon|million|mm|m|mil|k|bn|b)?\b/gi;
// «$500,000 to $3 million», «500k-3M», «entre 500 mil y 3 millones»: un rango se guarda por su tope (no se descarta lo grande).
const looseAmount = (text) => {
  const t = String(text);
  const found = [...t.matchAll(AMOUNT_RX)].map((m) => ({ v: parseAmount(m[1], m[2] || ''), at: m.index, end: m.index + m[0].length })).filter((x) => x.v);
  if (!found.length) return null;
  const [a, b] = found;
  if (b && /^\s*(?:to|a|y|and|-|–|—|hasta|up to)\s*(?:US\$|USD|U\$S|\$)?\s*$/i.test(t.slice(a.end, b.at))) return Math.max(a.v, b.v);
  return a.v;
};

const NAME = /^([A-ZÁÉÍÓÚÑ0-9][\wÁÉÍÓÚÑáéíóúñ&.+-]*(?:\s+(?:[A-ZÁÉÍÓÚÑ0-9][\wÁÉÍÓÚÑáéíóúñ&.+-]*|de|del|&)){0,4})/;
const STOP_NAMES = /^(Una?|The|El|La|Los|Las|Un|Nuestro|Nuestra|Este|Esta|Es|Is|A|An)$/;
function nameAfter(sentence, trigger) {
  for (const m of sentence.matchAll(trigger)) {
    const n = sentence.slice(m.index + m[0].length).trim().match(NAME);
    if (n) { const v = n[1].replace(/[.,;:]+$/, '').replace(/\s+(de|del|&)$/, ''); if (v.length > 1 && !STOP_NAMES.test(v)) return v; }
  }
  return null;
}
const COMPANY_TRIG = /\b(?:somos|we are|we're|we’re|our company is|my company is|nuestra empresa(?:\s+(?:se llama|es))?|mi empresa(?:\s+(?:se llama|es))?|la empresa|company|compañía|empresa|startup)\s*:?\s+/gi;
const PRODUCT_TRIG = /\b(?:nuestro producto(?:\s+(?:se llama|es))?|producto|proyecto|plataforma|product|project|platform|dispositivo|device)(?:\s+(?:se llama|llamad[oa]|called|named))?\s*:?\s+|\b(?:llamad[oa]|called|named)\s+/gi;
const listSplit = (text) => uniq(String(text).split(/,|;|\n|\s+y\s+|\s+and\s+|\s*\/\s*/).map((x) => clip(x.replace(/^[-•*\s]+|[.\s]+$/g, ''), 80)).filter((x) => x.length > 1)).slice(0, 12);

/* Extracción determinista: siempre corre y deja una cita literal por campo. */
export function heuristicExtract(text) {
  const out = [];
  const push = (path, value, quote) => { if (value !== null && value !== undefined && !(Array.isArray(value) && !value.length)) out.push({ path, value, quote: clip(quote, 240) }); };
  const found = new Set();
  const once = (path, value, quote) => { if (found.has(path) || value === null || value === undefined) return; found.add(path); push(path, value, quote); };
  for (const s of sentences(text)) {
    const n = norm(s);
    const sectors = mapSectors(s); if (sectors.length) push('industry.sectors', sectors, s);
    const geo = mapGeo(s); if (geo.length) push('geography', geo, s);
    const objectives = (INTENT_CTX.test(n) && !NEG_INTENT.test(n)) ? mapObjectives(s) : []; if (objectives.length) push('funding.objectives', objectives, s);
    { const r = mapRound(s); if (r !== 'public' || /\b(round|ronda|offering|oferta|raise|raising|financing|financiaci\w*|placement|follow.?on|pipe)\b/i.test(s)) once('funding.round', r, s); }
    const maturity = mapMaturity(s); if (maturity) once('product.maturity', maturity, s);
    if (RAISE_CTX.test(n) && !NOT_RAISE.test(n)) for (const m of s.matchAll(MONEY)) once('funding.amount_usd', parseAmount(m[1] || m[3], m[2] || m[4] || ''), s);
    const comp = s.match(/\b(?:competidores|competencia|competitors|competition)\s*(?:principales|main|directos|directa)?\s*(?:son|are|incluyen|include|:|-|—)\s*(.{3,200})/i);
    if (comp) push('competitors', listSplit(comp[1]).filter((x) => /[A-ZÁÉÍÓÚÑ0-9]/.test(x[0])), s);
    let company = nameAfter(s, COMPANY_TRIG);
    const lead = s.match(/^([A-ZÁÉÍÓÚÑ][\w&.+-]*(?:\s+[A-ZÁÉÍÓÚÑ][\w&.+-]*){0,3})\s+(?:es una|es un|is a|is an)\s+(?:startup|empresa|compañía|company|spin-?off|biotech|organizaci)/);
    if (!company && lead) company = lead[1];
    once('company.name', company, s);
    const org = nameAfter(s, /\b(?:en nombre de|desde|represento a|trabajo en|on behalf of)\s+/gi);
    if (org && /\b(para|for|patrocin\w*|sponsor\w*|financiar)\b/.test(n)) once('organization.name', org, s);
    const titled = s.match(/^([A-ZÁÉÍÓÚÑ][\w+-]{2,30}(?:\s[A-ZÁÉÍÓÚÑ][\w+-]+)?)\s*[:—–]\s+(?:(?:un|una|a|an|the|el|la)\s+)?(?:plataforma|wearable|app|aplicaci\w*|dispositivo|software|sistema|terapia|herramienta|platform|device|tool|system|therapy|kit|prueba|test|vacuna|f[aá]rmaco|drug)\b/i);
    once('product.name', nameAfter(s, PRODUCT_TRIG) || titled?.[1] || null, s);
    const title = s.match(/\b(?:soy|i am|i'm)\s+(?:el |la |the |a |an )?((?:co-?)?(?:ceo|cto|coo|cso|cmo|founder|fundador\w*|cofundador\w*|director\w*|presidente|investigador\w*)(?:\s+(?:y|and|&)\s+(?:co-?)?\w+)?)/i);
    if (title) once('founder.title', clip(title[1], 80), s);
    if (/\b(?:apply|aplicar|postular|presentar|submit|applying|aplicaci[oó]n|plazo|ventana|window|deadline|cierre)\b/i.test(s)) { const wl = windowLabel(s); if (wl && /\b(?:grant|convocatoria|call|subvenci|apply|aplicar|postular|ventana|window)\b/i.test(s)) once('funding.apply_window', wl, s); }
    const timeline = s.match(/\b(?:en|en los|within|in the next|next|pr[oó]ximos)\s+(\d{1,2})\s+(meses|months|semanas|weeks)\b/i);
    if (timeline) once('funding.timeline', `${timeline[1]} ${timeline[2].toLowerCase()}`, s);
    const use = s.match(/\b(?:uso de (?:los )?fondos|use of funds|para financiar|to fund|los fondos se usar[aá]n para)\s*:?\s*(.{8,220})/i);
    if (use) once('funding.use_of_funds', clip(use[1], 220), s);
    if (/\b(no queremos|no buscamos|no aceptamos|evitar|evitamos|excluir|excluimos|avoid|exclude|not interested|no trabajamos con)\b/.test(n)) push('constraints', [clip(s, 200)], s);
    if (/\b(preferimos|prefer\w*|idealmente|ideally|que lideren|lead investor|que inviertan en|investors who|smart money)\b/.test(n)) push('criteria', [clip(s, 200)], s);
    // No es el sitio de la empresa: enlaces internos de este mismo producto, no del negocio del usuario.
    const web = s.match(/\bhttps?:\/\/(?!(?:www\.)?linkedin\.com|localhost|127\.0\.0\.1|(?:www\.)?github\.com)[^\s)>\]]+|\bwww\.[^\s)>\]]+/i);
    if (web) once('company.website', web[0].replace(/[.,]+$/, ''), s);
  }
  return out;
}

/* Interpreta la respuesta directa a la pregunta pendiente (modo sin modelo). */
export function interpretAnswer(path, text) {
  const raw = clip(text, 1500);
  if (/^(no|none|nothing|not yet|not applicable|ninguno|ninguna|nada|no se|no lo se|paso|skip|n a|na|todavia no|aun no|prefiero no decir|no aplica|ninguno por ahora|no tengo|i dont know|i don t know|dont know|don t know|idk|not sure|unknown|n a|none yet|no idea)$/.test(norm(raw))) return { skip: true };
  const f = FIELD[path];
  if (!f || !raw) return null;
  if (path === 'funding.amount_usd') return { value: looseAmount(raw) };
  if (path === 'product.maturity') return { value: mapMaturity(raw) || (MATURITY.includes(norm(raw)) ? norm(raw) : null) };
  if (path === 'funding.round') return { value: mapRound(raw) };
  if (path === 'funding.apply_window') return { value: windowLabel(raw) };
  if (path === 'funding.objectives') return { value: mapObjectives(raw) };
  if (path === 'industry.sectors') { const m = mapSectors(raw); return { value: m.length ? m : listSplit(raw).slice(0, 5) }; }
  if (path === 'geography') { const m = mapGeo(raw); return { value: m.length ? m : listSplit(raw).slice(0, 6) }; }
  if (f.kind === 'list') return { value: listSplit(raw) };
  const cleaned = raw.replace(/^(se llama|somos|soy|es|we're|we are|it's|our company is|our product is|nuestra empresa es|nuestro producto es|mi empresa es|el producto es|la empresa es)\s+/i, '').replace(/[.\s]+$/, '');
  return { value: clip(cleaned, path === 'product.description' ? 1500 : LONG_TEXT.has(path) ? 600 : 200) || null };
}

/* ───────── Estado de la sesión ───────── */
export function newIntake({ user, profile } = {}) {
  const s = { id: randomUUID(), messages: [], documents: [], fields: {}, asked: [], skipped: [], pending: null, confirmedAt: null, updatedAt: new Date().toISOString() };
  if (profile) seedFromProfile(s, profile);
  const first = clip(user?.name || profile?.founder?.name || '', 60).split(' ')[0];
  s.messages.push({ role: 'assistant', at: s.updatedAt, text: `Hi${first ? ` ${first}` : ''}. Tell me what you're raising for, or drop your deck, one-pager or any document. I'll read it first and only ask what's still missing, the way an investor would.` });
  return s;
}
function seedFromProfile(s, p) {
  const set = (path, value) => { if (value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length)) return; s.fields[path] = { value, origin: 'profile', confidence: 'user', quote: '', at: s.updatedAt }; };
  const i = p.intake || {};
  const venture = p.project?.venture;
  set('company.name', venture || p.founder?.org);
  if (venture && norm(venture) !== norm(p.founder?.org)) set('organization.name', p.founder?.org);
  set('company.relation', p.project?.relation); set('founder.title', p.founder?.title); set('product.name', p.project?.name);
  set('product.one_liner', p.project?.one_liner); set('product.description', p.project?.description);
  set('industry.sectors', p.project?.sectors); set('geography', p.project?.geo); set('funding.amount_usd', p.project?.raise_usd);
  set('funding.objectives', i.objectives); set('product.maturity', i.maturity); set('competitors', i.competitors);
  set('constraints', i.constraints); set('criteria', i.criteria);
  set('funding.use_of_funds', i.use_of_funds); set('funding.timeline', i.timeline); set('funding.apply_window', i.apply_window); set('company.website', i.website);
  set('company.traction', i.traction); set('company.team', i.team); set('product.business_model', i.business_model); set('product.differentiation', i.differentiation);
  if (i.objectives && ROUNDS.includes(p.project?.stage)) set('funding.round', p.project.stage);
}

function sanitize(path, value) {
  const f = FIELD[path];
  if (!f || value === undefined || value === null) return null;
  if (f.kind === 'window') return windowLabel(Array.isArray(value) ? value.join(' ') : value);
  if (f.kind === 'number') { const v = typeof value === 'number' ? Math.round(value) : looseAmount(value); return v && v > 0 && v < 1e12 ? v : null; }
  if (path === 'company.entity_type') { const t = norm(value); return /non.?profit|not.for.profit|charit|foundation|\bngo\b|\bong\b|sin (?:animo|fines)/.test(t) ? 'nonprofit' : /universit|academic|college|research (?:institut|lab|cent)/.test(t) ? 'academic' : /for.?profit|compan|start.?up|corporat|\bllc\b|\binc\b|\bltd\b|\bsas\b|\bs\.?l\b/.test(t) ? 'for_profit' : null; }
  if (f.kind === 'enum') { const v = norm(value).replace(/ /g, f.path === 'funding.round' ? '-' : '_'); return f.options.includes(v) ? v : null; }
  if (f.kind === 'enumList') { const v = (Array.isArray(value) ? value : [value]).map((x) => norm(x)).filter((x) => f.options.includes(x)); return v.length ? [...new Set(v)] : null; }
  if (f.kind === 'list') { const v = uniq((Array.isArray(value) ? value : listSplit(value)).map((x) => clip(x, path === 'constraints' || path === 'criteria' ? 200 : 80)).filter(Boolean)).slice(0, 12); return v.length ? v : null; }
  const v = clip(value, path === 'product.description' ? 1500 : LONG_TEXT.has(path) ? 600 : 220);
  return v || null;
}

/* Aplica una propuesta respetando lo que el usuario editó a mano. Devuelve true si cambió algo. */
export function applyUpdate(s, { path, value, quote = '' }, origin, corpus) {
  const clean = sanitize(path, value);
  if (clean === null) return false;
  const prev = s.fields[path];
  if (prev && prev.origin === 'user') return false;
  const f = FIELD[path];
  const q = clip(quote, 240);
  const confidence = q.length >= 6 && norm(corpus).includes(norm(q)) ? 'source' : 'inferred';
  let next = clean;
  if (prev && prev.origin !== 'profile' && (f.kind === 'list' || f.kind === 'enumList')) next = uniq([...(prev.value || []), ...clean]).slice(0, 12);
  else if (prev && prev.origin !== 'profile' && prev.confidence === 'source' && confidence === 'inferred') return false;
  if (JSON.stringify(prev?.value) === JSON.stringify(next)) return false;
  s.fields[path] = { value: next, origin, confidence, quote: q, at: new Date().toISOString() };
  s.skipped = s.skipped.filter((p) => p !== path);
  return true;
}

export function editField(s, path, value) {
  if (!FIELD[path]) throw new Error('Unknown field.');
  if (value === null || value === '' || (Array.isArray(value) && !value.length)) {
    delete s.fields[path];
    if (!s.skipped.includes(path)) s.skipped.push(path);
  } else {
    const clean = sanitize(path, value);
    if (clean === null) throw new Error(`Invalid value for ${FIELD[path].label}.`);
    s.fields[path] = { value: clean, origin: 'user', confidence: 'user', quote: '', at: new Date().toISOString() };
    s.skipped = s.skipped.filter((p) => p !== path);
  }
  if (s.pending === path) s.pending = null;
  s.confirmedAt = null;
  s.updatedAt = new Date().toISOString();
  return s;
}

/* What the plan needs depends on the goal (feedback 29/09). The engine uses the amount in the
   score (ticket / ceiling fit), the round in every investor query, use of funds in semantic search,
   and traction is the proof point investors and the drafts rely on. Progress bar, questions and
   review all use this same list, so 100% means "the search has what it needs". */
export const GOAL_FIELDS = {
  investment: ['funding.round', 'funding.amount_usd', 'company.traction'],
  grant: ['funding.amount_usd', 'funding.use_of_funds', 'company.entity_type', 'company.state', 'funding.apply_window'],
  partnering: ['company.traction', 'product.differentiation'],
  sponsorship: ['funding.amount_usd', 'funding.use_of_funds'],
  debt: ['funding.amount_usd', 'company.traction'],
};
export function planFields(s) {
  const base = FIELDS.filter((f) => f.required).map((f) => f.path);
  const goals = fieldValue(s, 'funding.objectives') || [];
  const extra = goals.flatMap((g) => GOAL_FIELDS[g] || []);
  return [...new Set([...base, ...extra])];
}
const inPlan = (s, path) => planFields(s).includes(path);
/** Plan fields still empty. A skipped ("I don't know") field stays missing: 100% only when everything is there. */
export function missingRequired(s) { return planFields(s).filter((p) => !filled(s, p)); }
/** Open questions, in order: the plan fields first. Never something already filled or skipped. */
export function openQuestions(s) {
  const objectives = fieldValue(s, 'funding.objectives') || [];
  return ASK.filter((f) => {
    if (f.path === 'funding.round' && objectives.length && !objectives.includes('investment')) return false;
    if (f.grant && !objectives.includes('grant')) return false;
    const times = s.asked.filter((p) => p === f.path).length;
    return !filled(s, f.path) && !s.skipped.includes(f.path) && times < (inPlan(s, f.path) ? 2 : 1);
  });
}
/** The assistant asks only what the plan needs, in the order the list defines. */
export function nextQuestion(s) {
  const open = openQuestions(s);
  const order = planFields(s);
  return open.filter((f) => order.includes(f.path)).sort((a, b) => order.indexOf(a.path) - order.indexOf(b.path))[0] || null;
}
export const isPlanQuestion = inPlan;
/** Closing message when nothing is left to ask: either the plan is complete, or what is still missing and why. */
/* Por qué cada dato cambia la búsqueda: se dice UNA vez, con UNA pregunta (antes: lista genérica «To build your plan I still need: …»). */
const WHY_IT_MATTERS = {
  'funding.amount_usd': 'it filters out calls and funds whose size does not fit',
  'funding.round': 'investors are matched by the round they invest in',
  'company.traction': 'investors and the drafts lean on it',
  'funding.use_of_funds': 'it decides which programs fund this kind of work',
  'company.entity_type': 'many calls accept only one type of applicant',
  'company.state': 'state and regional programs fund only local applicants',
  'funding.apply_window': 'it keeps only calls that close when you can actually apply',
  'company.country': 'most calls fund only applicants from their country',
  'product.differentiation': 'partners screen on it',
};
export function closingLine(s) {
  const missing = missingRequired(s);
  if (!missing.length) return 'Your plan is complete. Press “Review and run” to start the search.';
  const p = missing[0]; const f = FIELD[p] || {};
  const ask = String(f.ask || `What is your ${String(f.label || p).toLowerCase()}?`).trim();
  return `${ask} It changes the search: ${WHY_IT_MATTERS[p] || 'it narrows what we look for'}. A rough answer is fine — or press “Review and run” and I will search without it.`;
}

/* ───────── Modelo (opcional) ───────── */
/** Modelos del asistente, en orden: el modelo grande del motor (ENGINE_LLM_*) si está configurado y el asistente no pidió el suyo (INTAKE_LLM_ROLE=own), y después INTAKE_LLM_*. Si el primero falla se prueba el siguiente. */
export function intakeTargets(env = {}) {
  const out = [];
  const big = fleetConfig(env).roles.engine;
  if (env.INTAKE_LLM_ROLE !== 'own' && env.INTAKE_LLM_ROLE !== 'small' && big?.ready && !big.alias) out.push({ name: 'engine', base: big.url, model: big.model, apiKey: big.apiKey || env.VLLM_API_KEY || '', reasoningEffort: String(env.INTAKE_LLM_REASONING_EFFORT || big.reasoningEffort || 'low'), jsonMode: big.jsonMode !== false, maxTokens: Number(env.INTAKE_LLM_MAX_TOKENS) || Math.max(big.maxTokens || 0, 4000) });
  if (env.INTAKE_LLM_BASE_URL) out.push({ name: 'intake', base: String(env.INTAKE_LLM_BASE_URL).replace(/\/+$/, ''), model: env.INTAKE_LLM_MODEL || 'qwen3-4b', apiKey: env.INTAKE_LLM_API_KEY || '', jsonMode: true, ...(env.INTAKE_LLM_REASONING_EFFORT ? { reasoningEffort: String(env.INTAKE_LLM_REASONING_EFFORT) } : {}), ...(Number(env.INTAKE_LLM_MAX_TOKENS) ? { maxTokens: Number(env.INTAKE_LLM_MAX_TOKENS) } : {}) });
  return out;
}
export function modelInfo(env = {}) {
  const t = intakeTargets(env)[0];
  return { configured: Boolean(t), model: t ? t.model : null, reasoning: env.INTAKE_LLM_THINK === 'true' || Boolean(t?.reasoningEffort) };
}
const SYSTEM = `You run the intake for IGC Outreach, and you think like a seasoned early-stage investor on a first screening call. The goal: build an accurate profile of what the founder wants to fund so investors, grants or partners can be researched.
Reply ONLY with a JSON object: {"ack": string, "question": string, "asking": string|null, "skipped": string|null, "updates": [{"path": string, "value": any, "quote": string}]}
Allowed fields (path → type):
${FIELDS.map((f) => `- ${f.path}: ${f.kind}${f.options ? ` ∈ {${f.options.join(', ')}}` : ''} — ${f.label}`).join('\n')}
How to extract:
1. Read the new message AND every document (new and previous). Extract every field they support, not just the one you asked about. Don't invent; if something isn't there, leave it out.
2. "quote" is a LITERAL fragment from the message or a document that supports the value. If you inferred it, leave quote empty.
3. funding.amount_usd is a USD number (1.5M → 1500000). geography uses codes (US, CO, MX, UK, EU, LATAM, GLOBAL...) or names.
4. company.name is the company or project that RECEIVES the funding (e.g. Mentiva). organization.name is the organization the user represents, only if different (e.g. IGC seeking sponsorship for Mentiva); company.relation describes that relationship.
5. Text fields (traction, use of funds, why you win, business model, team) should be short, specific summaries with numbers when available.
5b. competitors contains only NAMED companies or products. Generic alternatives such as classes, professionals, apps, tests or events belong in differentiation, never competitors or constraints.
How to reply:
6. English only. No filler ("Great!", "Thanks for sharing"), no lists, never restate the whole profile.
7. "ack": ONE short sentence (max 20 words) naming only what is NEW in this turn (a number, a date, a milestone). If they sent a document, name it. If nothing new was learned, "ack" is "".
8a. Write for a founder who has never raised money. Use plain words; never use jargon such as "traction", "runway", "LOI" or "key data" without saying what it means in the same sentence. End with a short example answer in parentheses, e.g. (for example: "about 2 million dollars").
8b. If the founder's last reply shows they did not understand the previous question ("what do you mean?", a confused or off-topic answer), ask the SAME open question again in simpler words with a concrete example, instead of moving on.
8. "question": exactly ONE question, the one a sharp investor would ask next, chosen ONLY from "open_questions". Put its path in "asking". Make it specific to this company (use their product name and facts), max 30 words, ending with "?".
9. NEVER ask for anything in "current_profile", "already_asked" or "skipped", or answered in any document. If a document answers an open question, extract it instead of asking.
10. If the founder doesn't know, wants to skip, or answers vaguely ("no sé", "not sure", "I don't know which"), set "skipped" to the path of "pending_question", don't press, and ask a DIFFERENT open question.
11. If the founder asks "what's your question?" or seems lost, just ask the next open question clearly.
11b. If "open_questions" is empty, set "asking" and "question" to null/"" and say the profile is ready to review in "ack".
12. Don't promise results, don't give legal or financial advice, and don't invent investors.`;

async function askTarget(t, { env, system, user, fetchImpl }) {
  const think = env.INTAKE_LLM_THINK === 'true';
  // Solo los Qwen3 "híbridos" (nombre sin -Instruct-/-Thinking-) responden al interruptor /no_think.
  // Los releases 2507 (Instruct-2507, Thinking-2507) ya son modelos separados: el interruptor no
  // aplica y añadirlo solo ensucia el prompt.
  const hybridQwen = /qwen3/i.test(t.model) && !/instruct|thinking/i.test(t.model);
  // gpt-oss a veces gasta todo el presupuesto razonando y devuelve el contenido vacío (finish_reason=length), o texto sin JSON:
  // un reintento con más presupuesto y la orden explícita casi siempre lo resuelve (15-10: «The model didn't return JSON»).
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const base = hybridQwen && !think ? `${user}\n/no_think` : user;
    const content = attempt ? `${base}\n\nReply with ONLY the JSON object, no other text.` : base;
    const maxTokens = t.maxTokens ? (attempt ? t.maxTokens * 2 : t.maxTokens) : (attempt ? 8000 : undefined);
    try {
      const response = await fetchImpl(`${t.base}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(t.apiKey ? { Authorization: `Bearer ${t.apiKey}` } : {}) },
        body: JSON.stringify({
          model: t.model, temperature: attempt ? 0 : 0.2, stream: false, ...(t.jsonMode === false ? {} : { response_format: { type: 'json_object' } }),
          ...(t.reasoningEffort ? { reasoning_effort: t.reasoningEffort } : {}), ...(maxTokens ? { max_tokens: maxTokens } : {}),
          messages: [{ role: 'system', content: `${system}\n\nLANGUAGE: Always reply in English, even if the founder writes in Spanish. Field values you extract should also be in English, except proper names.` }, { role: 'user', content }],
        }),
        signal: AbortSignal.timeout(Number(env.INTAKE_LLM_TIMEOUT_MS) || 90_000),
      });
      if (!response.ok) throw new Error(`The model returned ${response.status}.`);
      const data = await response.json();
      const text = String(data?.choices?.[0]?.message?.content || '').replace(/<think>[\s\S]*?<\/think>/g, '');
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) throw new Error(`The model didn't return JSON (finish_reason=${data?.choices?.[0]?.finish_reason || '?'}, ${text.length} chars).`);
      return JSON.parse(match[0]);
    } catch (e) {
      lastError = e;
      if (/returned 4\d\d/.test(e.message) || e.name === 'TimeoutError') break;   // un 4xx o un timeout no se arregla reintentando
      if (attempt === 0) console.error(`[intake] ${t.name} model (${t.model}) attempt 1 failed: ${e.message}; retrying once`);
    }
  }
  throw lastError;
}
export async function callModel({ env, system, user, fetchImpl = fetch }) {
  let parsed = null; let lastError = null;
  for (const t of intakeTargets(env)) {
    try { parsed = await askTarget(t, { env, system, user, fetchImpl }); break; } catch (e) { lastError = e; console.error(`[intake] ${t.name} model (${t.model}) failed: ${e.message}`); }
  }
  if (!parsed) throw lastError || new Error('No model configured.');
  const ack = clip(parsed.ack ?? '', 400).split(/(?<=[.!])\s+/)[0] || '';
  const question = clip(parsed.question ?? '', 300);
  return { reply: clip(parsed.reply ?? '', 800), ack, question, asking: typeof parsed.asking === 'string' ? parsed.asking : null, skipped: typeof parsed.skipped === 'string' ? parsed.skipped : null, updates: Array.isArray(parsed.updates) ? parsed.updates.slice(0, 40) : [] };
}

const SKIP_RX = /\b(no s[eé]|no lo s[eé]|no tengo|ni idea|no sabr[ií]a|paso|skip|pass|not sure|no idea|idk|i don'?t know|dont know|don'?t have|not yet|n\/a|none|ninguno|ninguna|todav[ií]a no|a[uú]n no|prefer not)\b/i;
const isSkip = (text) => String(text).length <= 60 && SKIP_RX.test(String(text));
const words = (t) => new Set(norm(t).split(' ').filter((w) => w.length > 3));
/** El acuse repite lo mismo que el mensaje anterior (evita el loop de resúmenes). */
const sameGist = (a, b) => { const A = words(a), B = words(b); if (!A.size || !B.size) return false; let n = 0; for (const w of A) if (B.has(w)) n++; return n / A.size > 0.6; };
/** Presupuesto para documentos nuevos; el resto va para los previos (así no se vuelve a preguntar lo que ya decían). */
const previousDocsBudget = (budget, added) => (added ? Math.floor(budget * 0.7) : 0);
const compact = (s) => Object.fromEntries(Object.entries(s.fields).map(([k, v]) => [k, v.value]));

/* Un turno: mensaje y/o documentos nuevos -> (modelo) -> pregunta siguiente.
   El modelo, cuando está configurado, es quien interpreta: NO se corren las reglas de patrones
   en paralelo (evita que un regex y el modelo se pisen o que un documento técnico se lea con
   reglas ciegas). Las reglas de patrones quedan solo como red de seguridad: se activan cuando no
   hay modelo configurado o cuando la llamada al modelo falla en este turno. */
export async function runTurn(s, { text = '', documents = [], env = {}, fetchImpl = fetch }) {
  const now = new Date().toISOString();
  const message = clip(text, LIMITS.messageChars);
  const added = [];
  for (const d of documents) {
    if (s.documents.length + added.length >= LIMITS.docs) break;
    const body = String(d?.text || '').slice(0, LIMITS.docChars);
    if (!body.trim()) continue;
    added.push({ id: randomUUID(), name: clip(d.name, 160) || 'document', type: clip(d.type, 80), size: Number(d.size) || 0, chars: body.length, text: body, at: now, pages: Number(d.pages) || null });
  }
  s.documents.push(...added);
  if (message || added.length) s.messages.push({ role: 'user', at: now, text: message, files: added.map((d) => d.name) });
  const changed = new Set();
  const pending = s.pending;
  const hasModel = modelInfo(env).configured;
  let modelReply = '';
  let modelAsking = null;
  let modelAck = '';
  let modelQuestion = '';
  let model = { used: false, error: null };

  // "No sé", "not sure", "skip"…: la pregunta pendiente se da por saltada (con o sin modelo).
  if (pending && message && !added.length && isSkip(message)) { if (!s.skipped.includes(pending)) s.skipped.push(pending); }

  if (hasModel && (message || added.length)) {
    const budget = Number(env.INTAKE_LLM_DOC_CHARS) || 12_000;
    const newBudget = previousDocsBudget(budget, added.length);
    const docs = added.map((d) => `### ${d.name}\n${d.text.slice(0, Math.floor(newBudget / Math.max(1, added.length)))}`).join('\n\n');
    const previous = s.documents.filter((d) => !added.includes(d));
    const prevDocs = previous.length ? previous.map((d) => `### ${d.name}\n${d.text.slice(0, Math.floor((budget - newBudget) / previous.length))}`).join('\n\n') : null;
    const corpus = `${message}\n${s.documents.map((d) => d.text).join('\n')}`;
    const open = openQuestions(s);
    const user = JSON.stringify({
      current_profile: compact(s),
      open_questions: open.map((f) => ({ path: f.path, label: f.label, required: inPlan(s, f.path) })),
      already_asked: [...new Set(s.asked)].map((p) => FIELD[p]?.label).filter(Boolean),
      skipped: s.skipped.map((p) => FIELD[p]?.label).filter(Boolean),
      pending_question: pending ? FIELD[pending]?.label : null,
      history: s.messages.slice(-8, -1).map((m) => `${m.role === 'user' ? 'Founder' : 'You'}: ${clip(m.text, 400)}`),
      new_message: message, new_documents: docs || null, previous_documents: prevDocs,
    });
    try {
      const out = await callModel({ env, system: SYSTEM, user, fetchImpl });
      for (const u of out.updates) if (u && typeof u.path === 'string' && applyUpdate(s, u, 'model', corpus)) changed.add(u.path);
      if (out.skipped && FIELD[out.skipped] && !filled(s, out.skipped) && !s.skipped.includes(out.skipped)) s.skipped.push(out.skipped);
      modelAck = out.ack || '';
      modelQuestion = out.question || '';
      modelReply = out.ack || out.question ? '' : out.reply;
      modelAsking = out.asking;
      model = { used: true, error: null };
    } catch (error) {
      const message = error?.message || 'Model unavailable.';
      console.error(`[intake] model call failed (${env.INTAKE_LLM_BASE_URL}, ${env.INTAKE_LLM_MODEL}): ${message}`);
      model = { used: false, error: message };
    }
  }

  if (!model.used) {
    // Red de seguridad por patrones: sin modelo configurado, o el modelo falló este turno.
    for (const d of added) for (const u of heuristicExtract(d.text)) if (applyUpdate(s, u, `document:${d.name}`, d.text)) changed.add(u.path);
    if (message) {
      // Respuesta corta a una pregunta pendiente: se interpreta solo como respuesta (evita que
      // "IGC Pharma" como nombre de empresa se convierta también en sector).
      const proposals = pending && message.length < 60 ? [] : heuristicExtract(message);
      for (const u of proposals) if (applyUpdate(s, u, 'conversation', message)) changed.add(u.path);
      // Si llegan documentos, el mensaje los acompaña ("te paso el deck"): no es una respuesta.
      if (pending && !added.length && !s.skipped.includes(pending) && !changed.has(pending) && !proposals.some((u) => u.path === pending)) {
        const answer = interpretAnswer(pending, message);
        if (answer?.skip) { if (!s.skipped.includes(pending)) s.skipped.push(pending); }
        else if (answer && applyUpdate(s, { path: pending, value: answer.value, quote: message }, 'conversation', message)) changed.add(pending);
      }
      // Out-of-order answers (feedback 29/09): "seed" while asked for the amount, or "about 500k USD"
      // after the closing line. Only unambiguous, strongly typed fields; an amount needs money units.
      for (const path of ['funding.round', 'funding.amount_usd', 'product.maturity']) {
        if (path === pending || changed.has(path) || filled(s, path) || !planFields(s).includes(path)) continue;
        if (path === 'funding.amount_usd' && !/\$|\busd\b|d[oó]lar|dollar|\d\s*(k|m|mm|million|millones|millon|mil)\b/i.test(message)) continue;
        const hit = interpretAnswer(path, message);
        if (path === 'funding.round' && hit?.value === 'public' && !/\b(round|ronda|offering|oferta|raise|raising|financing|financiaci\w*|placement|follow.?on|pipe)\b/i.test(message)) continue;
        if (hit?.value && applyUpdate(s, { path, value: hit.value, quote: message }, 'conversation', message)) changed.add(path);
      }
      if (!filled(s, 'product.description') && message.length >= 120 && applyUpdate(s, { path: 'product.description', value: message, quote: '' }, 'conversation', message)) changed.add('product.description');
    }
  }

  // Con modelo: si el turno contestaba un campo tipado (monto, ronda, madurez) y el modelo no lo devolvió, el código lo lee de la respuesta.
  // (Sin esto el modelo podía acusar recibo —«range $500k-$3M»— sin guardar el número y el plan volvía a pedirlo.)
  if (model.used && message && pending && !added.length && ['funding.amount_usd', 'funding.round', 'product.maturity'].includes(pending) && !filled(s, pending) && !s.skipped.includes(pending)) {
    const answer = interpretAnswer(pending, message);
    if (answer?.value && applyUpdate(s, { path: pending, value: answer.value, quote: message }, 'conversation', message)) changed.add(pending);
  }

  // La pregunta la elige el modelo entre las abiertas; si elige algo ya lleno, saltado o repetido, se usa la regla.
  // Siempre hay pregunta mientras queden abiertas: la respuesta = acuse corto (lo nuevo) + UNA pregunta.
  const open = openQuestions(s);
  const chosen = model.used && modelAsking ? open.find((f) => f.path === modelAsking && inPlan(s, f.path)) : null;
  const q = chosen || nextQuestion(s);
  if (model.used && !modelAck && !modelQuestion && modelReply) {
    // Formato antiguo (solo "reply"): se respeta, pero siempre termina en una pregunta abierta.
    if (modelAsking && !chosen) modelReply = `${modelReply.replace(/[^.!?]*\?\s*$/, '').trim()} ${q ? q.ask : closingLine(s)}`.trim();
    else if (q && !/\?/.test(modelReply)) modelReply = `${modelReply} ${q.ask}`;
  } else if (model.used) {
    const lastAck = [...s.messages].reverse().find((m) => m.role === 'assistant')?.text || '';
    const ack = modelAck && !sameGist(modelAck, lastAck) ? modelAck : '';
    const question = !q ? closingLine(s)
      : chosen && /\?\s*$/.test(modelQuestion) ? modelQuestion : q.ask;
    modelReply = [ack || (modelReply && !q ? modelReply : ''), question].filter(Boolean).join(' ');
  }
  s.pending = q?.path || null;
  if (q) s.asked.push(q.path);
  let reply = modelReply;
  if (!reply) {
    const parts = [];
    // Feedback 29/09: no field names in the chat; the progress bar shows how far along we are.
    if (added.length) parts.push(`I read ${added.map((d) => d.name).join(', ')}.`);
    const learned = [...changed].filter((p) => FIELD[p]);
    if (learned.length) parts.push(added.length ? 'That covers a good part of it.' : 'Got it.');
    else if (message && pending && !s.skipped.includes(pending)) parts.push('I couldn\'t get a clear detail from that.');
    if (q) parts.push(q.ask);
    else parts.push(closingLine(s));
    reply = parts.join(' ');
  }
  s.messages.push({ role: 'assistant', at: new Date().toISOString(), text: reply, model: model.used ? modelInfo(env).model : null });
  s.messages = s.messages.slice(-LIMITS.history);
  s.confirmedAt = null;
  s.updatedAt = new Date().toISOString();
  return { session: s, changed: [...changed], model };
}

export function removeDocument(s, id) {
  const doc = s.documents.find((d) => d.id === id);
  if (!doc) return false;
  s.documents = s.documents.filter((d) => d.id !== id);
  for (const [path, f] of Object.entries(s.fields)) if (f.origin === `document:${doc.name}`) delete s.fields[path];
  s.confirmedAt = null;
  s.updatedAt = new Date().toISOString();
  return true;
}

/* ───────── Planificador de investigación (determinista) ───────── */
const HEALTH = /biotech|pharma|medtech|neuro|mental health|digital health|diagnostics|salud|health|clinic|alzheimer|oncolog|cardio/;
export function planResearch(s, env = {}) {
  const objectives = fieldValue(s, 'funding.objectives') || [];
  const sectors = (fieldValue(s, 'industry.sectors') || []).join(' ').toLowerCase();
  const maturity = fieldValue(s, 'product.maturity') || '';
  const health = HEALTH.test(sectors) || /clinical|preclinical/.test(maturity);
  const steps = [];
  const skipped = [];
  const add = (goal, source, why, status = 'activo', cost = 'gratis') => steps.push({ goal, source, why, status, cost });
  if (objectives.includes('grant')) {
    add('Grants', 'Grants.gov', 'Open federal calls: dates, ceilings and published contacts.');
    if (health) {
      add('Grants', 'NIH RePORTER', 'Funded projects and program officers in the area.');
      add('Grants', 'Foundation radar (ADDF, CDMRP, a2)', 'Foundation cycles and specialized programs.');
    } else skipped.push({ source: 'NIH RePORTER and health foundations', reason: 'Not a health sector.' });
  }
  if (objectives.includes('investment')) {
    add('Investment', 'SEC Form D', 'Peer rounds and active funds (Investors engine).');
    add('Investment', `Funding rounds${env.EXA_API_KEY ? ' (Exa · news)' : env.SERPER_API_KEY ? ' (Serper News)' : ''}`, 'Who led similar rounds in the last 18 months.', env.EXA_API_KEY || env.SERPER_API_KEY ? 'activo' : 'falta EXA_API_KEY o SERPER_API_KEY', 'crédito');
  }
  if (objectives.includes('sponsorship')) add('Sponsorship', 'Exa · sponsors', 'Companies, CSR programs and foundations sponsoring the sector.', env.EXA_API_KEY ? 'activo' : 'falta EXA_API_KEY', 'crédito');
  if (objectives.includes('partnering')) {
    if (health) add('Partnering', 'ClinicalTrials.gov', 'Active industry sponsors in the area.');
    else skipped.push({ source: 'ClinicalTrials.gov', reason: 'Health only.' });
    add('Partnering', 'OpenAlex', 'Co-authorships and affiliations: groups publishing on the topic.');
  }
  if (objectives.includes('debt')) skipped.push({ source: 'Debt', reason: 'Limited coverage: shown as pending.' });
  add('Contacts', 'Your network (LinkedIn, email, calendar)', 'Warm paths to the organizations found.');
  add('Contacts', 'Firecrawl + ScrapeGraph', 'Fund and organization teams from public pages, quoted.', env.FIRECRAWL_API_KEY && (env.SGAI_API_KEY || env.SCRAPEGRAPH_API_KEY) ? 'activo' : 'no configurado', 'crédito');
  add('Discovery', 'Exa · semantic search', 'One query per goal with your full profile.', env.EXA_API_KEY ? 'activo' : 'falta EXA_API_KEY', 'crédito');
  add('Contacts', 'Hunter · enrichment', 'Top 5 contacts only.', 'pendiente de integración', 'crédito');
  return { objectives, steps, skipped, rules: ['Only the sources that fit the goal, in parallel.', 'De-duplicated by organization and person before enrichment.', 'Every claim keeps URL, quote, date and confidence.'] };
}

/* ───────── Perfil confirmado -> ProjectConfig ───────── */
const FUNDING_MAP = { investment: 'venture', grant: 'grant', debt: 'debt', partnering: 'corporate', sponsorship: 'corporate' };
export function toProfile(s, base, user, env = {}) {
  const v = (p) => fieldValue(s, p);
  const objectives = v('funding.objectives') || [];
  const competitors = v('competitors') || [];
  const comparables = [...(base.comparables || [])];
  for (const name of competitors) if (!comparables.some((c) => norm(c.name) === norm(name))) comparables.push({ name, domain: '', sec_cik: '', aliases: [], why: 'Competitor declared in intake' });
  const evidence = Object.fromEntries(Object.entries(s.fields).map(([k, f]) => [k, { origin: f.origin, confidence: f.confidence, quote: f.quote }]));
  return {
    ...base,
    founder: { ...base.founder, name: base.founder?.name || user.name, email: base.founder?.email || user.email, title: v('founder.title') || base.founder?.title || '', org: v('organization.name') || v('company.name') || base.founder?.org || '' },
    project: {
      ...base.project,
      name: v('product.name') || '', one_liner: v('product.one_liner') || '', description: v('product.description') || v('product.one_liner') || '',
      sectors: v('industry.sectors') || [], stage: v('funding.round') || base.project?.stage || 'pre-seed',
      raise_usd: v('funding.amount_usd') || null, geo: v('geography') || [],
      funding_types: [...new Set(objectives.map((o) => FUNDING_MAP[o]))],
      venture: v('company.name') || '',
      relation: v('company.relation') || (v('organization.name') && norm(v('organization.name')) !== norm(v('company.name')) ? 'other' : 'same'),
    },
    comparables,
    intake: {
      objectives, maturity: v('product.maturity') || 'other', competitors, criteria: v('criteria') || [], constraints: v('constraints') || [],
      use_of_funds: v('funding.use_of_funds') || '', traction: v('company.traction') || '', team: v('company.team') || '', business_model: v('product.business_model') || '', differentiation: v('product.differentiation') || '', timeline: v('funding.timeline') || '', apply_window: v('funding.apply_window') || '', apply_from: (parseWindow(v('funding.apply_window'), env.today) || {}).from || '', apply_to: (parseWindow(v('funding.apply_window'), env.today) || {}).to || '', website: v('company.website') || '',
      organization: v('organization.name') || '', relation: v('company.relation') || '', entity_type: v('company.entity_type') || '', country: v('company.country') || '', state: v('company.state') || '', city: v('company.city') || '',
      documents: s.documents.map((d) => ({ name: d.name, chars: d.chars, at: d.at })), evidence,
      plan: planResearch(s, env), confirmedAt: new Date().toISOString(),
    },
  };
}

export function publicIntake(s, env = {}) {
  return {
    id: s.id, messages: s.messages, pending: s.pending, confirmedAt: s.confirmedAt, updatedAt: s.updatedAt, skipped: s.skipped,
    documents: s.documents.map(({ text, ...d }) => ({ ...d, preview: clip(text, 280) })),
    fields: s.fields, missing: missingRequired(s), planFields: planFields(s), plan: planResearch(s, env), model: modelInfo(env),
  };
}
