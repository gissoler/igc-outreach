/* ─────────────────────────────────────────────────────────────────────────────
   Encaje de inversores con el pedido del usuario (27-10, prueba IGC «family offices»).
   La prueba mostró en los primeros puestos a un Customer Service Manager, una directora de farmacología
   y un Operations Manager de Merck: el ranking no sabía qué tipo de inversor se pidió, aceptaba cualquier
   empleado de una organización relevante y atribuía a cada persona la tesis de su organización.
   Aquí, sin modelo y con la cita a la vista:
     · qué tipos de inversor pidió el usuario y si es preferencia o restricción;
     · qué exclusiones dijo (asesores sin inversión directa, fondos VC no relacionados, nombres);
     · qué tipo de entidad es cada organización según sus fuentes (el nombre solo no basta);
     · si la persona tiene una función inversora demostrable por su cargo;
     · si una organización es en realidad una empresa financiada (sirve para descubrir inversores, no lo es);
     · operaciones, instrumentos e indicios de inversión en compañías cotizadas que las fuentes citan.
   Resultado: tier meets | alternative | verify | excluded, con motivos, lo que falta y el siguiente paso.
   ───────────────────────────────────────────────────────────────────────────── */
import { norm } from '../core.mjs';
import { FAMILY_OFFICE } from './familyOffices.mjs';

export const INVESTOR_TYPES = ['family_office', 'venture_capital', 'corporate_venture', 'angel', 'private_equity', 'hedge_fund', 'crossover', 'foundation'];
export const TYPE_LABEL = {
  family_office: 'Family office', venture_capital: 'Venture capital firm', corporate_venture: 'Corporate venture arm', angel: 'Angel investor or network',
  private_equity: 'Private equity firm', hedge_fund: 'Hedge fund / public-markets investor', crossover: 'Crossover fund', foundation: 'Foundation or philanthropic investor',
  wealth_adviser: 'Wealth adviser', operating_company: 'Operating company', funded_company: 'Company that raised capital', investor: 'Investor (type not stated)',
};
const TYPE_RX = {
  family_office: /\b(?:single|multi)[- ]family offices?\b|\bfamily offices?\b|\bfamily investment offices?\b|\bprivate investment offices?\b/i,
  corporate_venture: /\bcorporate venture(?: capital)?\b|\bventure (?:capital )?arm\b|\bstrategic (?:venture|investment) (?:fund|arm|group)\b|\bcvc\b|access to [\w’'.& -]{2,40}(?:deep )?(?:domain )?expertise/i,
  private_equity: /\bprivate equity\b|\bbuyout\b/i,
  hedge_fund: /\bhedge funds?\b|\bpublic (?:equity|equities|markets?) (?:fund|investor|strategies)\b|\blong[/ -]short\b/i,
  crossover: /\bcrossover (?:fund|investor|investments?|rounds?)\b/i,
  angel: /\bangel (?:investors?|networks?|groups?)\b|\bbusiness angels?\b/i,
  foundation: /\b(?:venture philanthropy|mission[- ]related investments?|program[- ]related investments?)\b/i,
  venture_capital: /\bventure capital\b|\bventure (?:firm|fund|investors?)\b|\bvc (?:firm|fund)\b|\bseed (?:fund|investor)\b|\bearly[- ]stage (?:fund|investor|venture)\b|\blife sciences? (?:investor|investment firm|venture|fund)\b|\bbiotech (?:investor|venture firm|fund)\b|\bhealthcare (?:investor|investment firm|venture fund)\b|\bevergreen fund\b/i,
};
/** Palabras del usuario → tipos pedidos. */
const ASK_RX = {
  family_office: /\bfamily[- ]?offices?\b|\bfamily capital\b|\bfamilias? inversionistas?\b/i,
  venture_capital: /\b(?:vcs?|venture capital(?:ists?)?|venture funds?|fondos? de capital de riesgo)\b/i,
  corporate_venture: /\bcorporate venture|\bcvcs?\b|\bstrategic investors?\b/i,
  angel: /\bangels?\b|\bangel investors?\b|\binversionistas? [aá]ngel/i,
  private_equity: /\bprivate equity\b|\bpe funds?\b/i,
  hedge_fund: /\bhedge funds?\b|\bpublic[- ]market investors?\b|\binstitutional investors?\b/i,
  crossover: /\bcrossover\b/i,
  foundation: /\bfoundations?\b.*\binvest|\bventure philanthropy\b/i,
};
const INVEST_CUE = /\b(?:we (?:invest|have invested|back|partner with|provide (?:capital|funding))|invests? (?:in|directly|globally|across)|investing in|investments? in|direct investments?|portfolio (?:companies|company|includes)|our portfolio|(?:led|co-led|participated in|joined) (?:the|a|an|its) [\w$€£.,\s-]{0,40}(?:round|financing|offering|placement)|capital (?:to|for) (?:companies|founders|startups)|we provide (?:growth|venture|patient) capital|seed|series [a-f]|venture capital|private equity|family office)\b/i;
const ADVISER = /\b(?:wealth (?:management|advis\w*|planning)|financial (?:advis\w*|planning|planners?)|registered investment advis\w*|\bria\b|private wealth|investment advisory services|asset allocation for (?:families|clients)|outsourced (?:cio|chief investment officer)|concierge|family office services|tax (?:planning|advis\w*)|estate planning|trust services|bill pay)\b/i;
const DIRECT = /\b(?:direct (?:investments?|investing|private investments?)|invests? directly|co-?invest\w*|(?:led|co-led|participated in) (?:the|a|an|its)\b|portfolio compan(?:y|ies)|we (?:have )?(?:backed|invested in))\b/i;
const OPERATING = /\b(?:(?:bio)?pharmaceutical company|biotechnology company|drug developer|we (?:discover|develop|manufacture|commercialize)|our (?:pipeline|products|medicines)|clinical[- ]stage (?:company|biotech)|medical device company)\b/i;
const RAISED = /\b(?:raised|raises|announc\w* (?:the )?(?:closing|close|pricing)|closed|closes|secured|secures|completed|completes|prices?|priced)\b[^.]{0,80}\b(?:financing|round|funding|series [a-f]|seed|private placement|offering|pipe|investment from)\b/i;
const LISTED = /\b(?:pipes?\b|private investments? in public equit\w*|registered direct|public (?:companies|company|equities|equity|markets?)|listed (?:companies|company|biotech\w*)|nasdaq|nyse|small[- ]cap|micro[- ]cap|follow-?on offerings?)\b/i;
const PRIVATE_ONLY = /\b(?:only (?:invest in )?private|private companies only|early[- ]stage private compan\w*|pre-?ipo only)\b/i;
const INSTRUMENT = [
  ['PIPE', /\bpipes?\b|\bprivate investments? in public equit\w*/i], ['Registered direct', /\bregistered direct\b/i], ['Warrants', /\bwarrants?\b/i],
  ['Convertible', /\bconvertible (?:notes?|debentures?|preferred|bonds?|loans?)\b|\bconvertibles?\b/i], ['Preferred equity', /\bpreferred (?:stock|shares|equity)\b/i],
  ['Common stock', /\bcommon (?:stock|shares)\b/i], ['Equity round', /\bseries [a-f]\b|\bseed round\b|\bequity (?:financing|round|investment)\b/i], ['Debt', /\bventure debt\b|\bterm loan\b|\bcredit facility\b/i], ['Royalty', /\broyalty (?:financing|deal|interest)\b/i],
];
const AMOUNT = /(?:US\$|USD|EUR|CHF|GBP|\$|€|£)\s?\d[\d.,]*\s?(?:million|billion|mm|m|bn|b|k)?\b|\b\d[\d.,]*\s?(?:million|billion)\s(?:dollars|usd|euros?)\b/gi;
const PERSONAL_AMOUNT = /\b(?:invested|committed|contributed|purchased|bought)\s+(?:US\$|USD|\$|€|£)\s?\d/i;

/* ───────── Pedido del usuario ───────── */
export function parseInvestorTypes(text) {
  const t = String(text || '');
  return INVESTOR_TYPES.filter((k) => ASK_RX[k]?.test(t));
}
/** «only/exclusively/solo» → only; «prefer/ideally/first/priority» → prefer; si no lo dice, '' (sin decidir). */
export function parseTypeMode(text) {
  const t = norm(text);
  // «Only family offices in the main list; others separately as alternatives» describe una preferencia, no una restricción.
  if (/\b(?:alternatives?|separately|as well|also show|others? (?:too|below|after))\b/.test(t)) return 'prefer';
  if (/\b(?:only|exclusively|nothing but|just|solo|solamente|unicamente|exclusivamente)\b/.test(t) && !/\bnot (?:only|just)\b/.test(t)) return 'only';
  if (/\b(?:prefer\w*|preferably|ideally|first|priority|prioriti\w*|mainly|primarily|mostly|plus other|and other|also (?:other|vcs?|funds?)|alternatives?|preferimos|preferiblemente|principalmente|primero)\b/.test(t)) return 'prefer';
  return '';
}
/** Exclusiones dichas en el chat → reglas comprobables. Lo que no se puede comprobar se conserva como texto y se muestra. */
export function parseExclusions(text) {
  const out = [];
  for (const raw of String(text || '').split(/\n|;|(?<=\.)\s+/)) {
    const s = raw.trim(); const t = norm(s);
    if (!s || !/\b(?:exclude|excluding|avoid|no |not |without|except|excluir|excluye|evitar|sin |ningun)\w*/.test(t)) continue;
    if (/\b(?:advis\w*|asesor\w*|wealth|planners?|ria)\b/.test(t)) out.push({ kind: 'wealth_adviser', label: /without direct|sin inversion directa|no direct/.test(t) ? 'Advisers without direct investments' : 'Wealth advisers', quote: s });
    if (/\b(?:vcs?|venture (?:capital|funds?)|fondos? de capital de riesgo)\b/.test(t)) out.push({ kind: /\bunrelated|not related|no relacionad|outside|irrelevant|generic/.test(t) ? 'unrelated_vc' : 'venture_capital', label: /\bunrelated|not related|no relacionad|generic/.test(t) ? 'Venture funds unrelated to the sector' : 'Venture capital funds', quote: s });
    if (/\b(?:pharma\w*|corporates?|strategic investors?|corporate venture)\b/.test(t) && /\b(?:exclude|avoid|no |not |excluir|evitar)\b/.test(t)) out.push({ kind: 'corporate', label: 'Pharma or corporate investors', quote: s });
    if (/\bhedge funds?\b/.test(t)) out.push({ kind: 'hedge_fund', label: 'Hedge funds', quote: s });
    if (/\bprivate equity\b/.test(t)) out.push({ kind: 'private_equity', label: 'Private equity', quote: s });
  }
  const seen = new Set();
  return out.filter((x) => (seen.has(x.kind) ? false : seen.add(x.kind)));
}
/** Preferencias del brief en un objeto (tipos, modo, exclusiones, cotizada/privada). */
export function investorPrefs(brief = {}) {
  const types = String(brief.investorTypes || '').split(/[,;]\s*/).map((x) => x.trim()).filter((x) => INVESTOR_TYPES.includes(x));
  const mode = ['only', 'prefer'].includes(brief.investorTypesMode) ? brief.investorTypesMode : '';
  const exclusions = parseExclusions([brief.constraints, brief.exclusionsText].filter(Boolean).join('\n'));
  const listing = ['public', 'private'].includes(brief.listing) ? brief.listing : brief.round === 'public' ? 'public' : '';
  return { types, mode, exclusions, listing };
}

/* ───────── Entidad ───────── */
const quotesOf = (lead) => (lead.evidence || []).filter((e) => e.verified !== false && !/hunter|apollo|contact/i.test(`${e.source} ${e.field}`)).map((e) => ({ quote: String(e.quote || ''), url: e.url, source: e.source, at: e.retrievedAt || null }));
/** Quita el nombre de la organización: «Cooper Family Office» no prueba nada sobre Cooper Family Office. */
const withoutName = (q, org) => { let s = String(q || ''); for (const n of [org, String(org || '').replace(/\b(?:llc|inc|ltd|lp|corp)\b\.?/gi, '').trim()]) if (n && n.length > 3) s = s.split(n).join(' '); return s; };
export function classifyEntity(lead) {
  const org = lead.org || ''; const qs = quotesOf(lead);
  const hit = (rx, onlyAbout = true) => qs.find((q) => rx.test(onlyAbout ? withoutName(q.quote, org) : q.quote));
  const nameFo = FAMILY_OFFICE.test(org) || /family.?(?:office|capital)/i.test(org.replace(/[^A-Za-z]/g, ''));
  const funded = qs.find((q) => RAISED.test(q.quote) && new RegExp(`\\b${org.split(/\s+/)[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(q.quote.split(RAISED)[0] || '') && !/\bwe (?:led|invested|backed)\b/i.test(q.quote));
  // Una frase «X raised… led by Y» habla de quien recibe capital: no cuenta como prueba de que X invierte.
  const invests = qs.find((q) => INVEST_CUE.test(q.quote) && !(RAISED.test(q.quote) && !/\b(?:we|it|they) (?:invest|led|backed|participated)\b/i.test(q.quote))) || (lead.directInvestment ? { quote: lead.directInvestment.quote, url: lead.directInvestment.url } : null);
  const adviser = hit(ADVISER, false);
  const direct = hit(DIRECT, false) || (lead.directInvestment ? { quote: lead.directInvestment.quote, url: lead.directInvestment.url } : null);
  for (const type of ['family_office', 'corporate_venture', 'crossover', 'hedge_fund', 'private_equity', 'angel', 'foundation', 'venture_capital']) {
    const q = hit(TYPE_RX[type]);
    if (q) return { type, status: 'sourced', quote: q.quote, url: q.url, nameOnly: false, invests: invests || null, adviser: adviser || null, direct: direct || null };
  }
  if (funded && !invests) return { type: 'funded_company', status: 'sourced', quote: funded.quote, url: funded.url, invests: null, adviser: null, direct: null };
  const op = hit(OPERATING, false);
  if (op && !invests) return { type: 'operating_company', status: 'sourced', quote: op.quote, url: op.url, invests: null, adviser: adviser || null, direct: null };
  if (adviser && !direct) return { type: 'wealth_adviser', status: 'sourced', quote: adviser.quote, url: adviser.url, invests: invests || null, adviser, direct: null };
  if (nameFo || lead.investorType === 'family_office') return { type: 'family_office', status: 'name_only', quote: null, url: null, nameOnly: true, invests: invests || null, adviser: adviser || null, direct: direct || null };
  if (invests) return { type: 'investor', status: 'sourced', quote: invests.quote, url: invests.url, invests, adviser: adviser || null, direct: direct || null };
  return { type: 'unknown', status: 'unknown', quote: null, url: null, invests: null, adviser: adviser || null, direct: direct || null };
}

/* ───────── Persona ───────── */
const INVESTING_ROLE = /\b(?:general partner|managing partner|venture partner|partner|principal|chief investment officer|\bcio\b|investment (?:director|manager|officer|professional|associate|analyst|committee|partner|team)|head of (?:\w+ )?(?:investments?|private (?:equity|markets)|direct investments?|venture|capital markets)|director of (?:\w+ )?investments?|portfolio manager|fund manager|managing director|investor relations? (?:lead)?|investment|investor|venture)\b/i;
const LEADERSHIP_ROLE = /\b(?:founder|co-?founder|ceo|chief executive|president|chair(?:man|woman|person)?|owner|managing member|executive director)\b/i;
const OPERATIONAL_ROLE = /\b(?:customer (?:service|success|support)|operations?|office manager|executive assistant|assistant|administrat\w*|receptionist|human resources|\bhr\b|recruit\w*|talent|marketing|communications?|sales|account (?:manager|executive)|engineer\w*|developer|software|\bit\b|technician|scientist|pharmacolog\w*|clinical|medical (?:affairs|science|director)|regulatory|quality|manufactur\w*|supply chain|logistics|field service|training|teacher|nurse|physician|research (?:associate|scientist)|accountant|accounting|controller|bookkeep\w*|tax|legal|counsel|attorney|paralegal|compliance|vice president of finance|finance (?:manager|director)|treasur\w*|payroll|facilities|security|scientific relations|medical science liaison|business analyst|data (?:analyst|scientist)|product manager|project manager|program manager|consultant)\b/i;
/** Función del cargo frente a la inversión: investing | leadership | operational | unknown (sin cargo). */
export function roleFit(role) {
  const r = String(role || '').trim();
  if (!r) return 'unknown';
  if (/\bvice president of finance\b|\bfinance (?:manager|director)\b/i.test(r)) return 'operational';
  if (INVESTING_ROLE.test(r) && !/\b(?:investor relations)\b/i.test(r)) return 'investing';
  if (LEADERSHIP_ROLE.test(r)) return 'leadership';
  if (OPERATIONAL_ROLE.test(r)) return 'operational';
  if (/\b(?:director|vice president|vp|head|manager|associate|analyst)\b/i.test(r)) return 'unknown';
  return 'unknown';
}

/* ───────── Operaciones e instrumentos citados ───────── */
const COMPANY_AFTER = /\b(?:invested in|investment in|(?:co-)?leads? (?:a |an |the )?[\w$€£.,\s-]{0,40}?(?:round|financing|offering|placement|PIPE|[Ss]eries [A-F]) (?:in|of|for)|co-led (?:a |an |the )?[\w$€£.,\s-]{0,40}?(?:round|financing|offering|placement|PIPE|[Ss]eries [A-F]) (?:in|of|for)|led the [\w$€£.,\s-]{0,40}?(?:round|financing|offering|placement|PIPE|pipe|[Ss]eries [A-F]) (?:of|for|in)|participated in [\w$€£.,\s-]{0,40}?(?:round|financing|offering|placement|PIPE|pipe|[Ss]eries [A-F]) (?:of|for|in)|portfolio compan(?:y|ies)(?: include| such as|:)?|backed)\s+([A-Z][\w&.'’-]*(?:\s+[A-Z][\w&.'’-]*){0,4})/;
const SUBJECT_RAISED = /^([A-Z][\w&.'’-]*(?:\s+[A-Z][\w&.'’-]*){0,4})(?:,[^,]{0,80},)?\s+(?:\([A-Z]+:\s?[A-Z]+\)\s+)?(?:raised|raises|announc\w*|closed|closes|secured|secures|completed|prices?|priced)\b/;
export function dealsFrom(lead) {
  const out = []; const seen = new Set();
  for (const q of quotesOf(lead)) {
    const s = q.quote;
    if (!/\b(?:invest\w*|round|financing|offering|placement|pipe|series [a-f]|seed|led|participat\w*|backed|portfolio)\b/i.test(s)) continue;
    const company = (COMPANY_AFTER.exec(s)?.[1] || SUBJECT_RAISED.exec(s)?.[1] || '').replace(/[.,;:]+$/, '');
    if (!company || norm(company) === norm(lead.org) || /^(?:The|Our|We|This|Its|Their|A|An)$/.test(company)) continue;
    const instruments = INSTRUMENT.filter(([, rx]) => rx.test(s)).map(([k]) => k);
    const amounts = [...s.matchAll(AMOUNT)].map((m) => m[0].trim());
    const year = (s.match(/\b20\d{2}\b/g) || []).map(Number).sort((a, b) => b - a)[0] || null;
    const key = `${norm(company)}|${year || ''}`;
    if (seen.has(key)) continue; seen.add(key);
    out.push({
      company, year, instruments, url: q.url, quote: s.slice(0, 400), source: q.source,
      // Una cifra de ronda sindicada no es la participación de este inversor: solo «invested $X» se lee como participación reportada.
      amount: amounts[0] ? { value: amounts[0], kind: PERSONAL_AMOUNT.test(s) ? 'reported_participation' : 'round_size' } : null,
    });
  }
  return out.slice(0, 6);
}
export function instrumentsFrom(lead) {
  const found = new Map();
  for (const q of quotesOf(lead)) for (const [k, rx] of INSTRUMENT) if (rx.test(q.quote) && !found.has(k)) found.set(k, { instrument: k, quote: q.quote.slice(0, 300), url: q.url });
  return [...found.values()];
}
export function listedCompat(lead) {
  const qs = quotesOf(lead);
  const pub = qs.find((q) => LISTED.test(q.quote));
  if (pub) return { value: 'listed_evidence', quote: pub.quote.slice(0, 300), url: pub.url };
  const priv = qs.find((q) => PRIVATE_ONLY.test(q.quote));
  if (priv) return { value: 'private_only', quote: priv.quote.slice(0, 300), url: priv.url };
  return { value: 'unknown', quote: null, url: null };
}

/* ───────── Tier ───────── */
const typeName = (t) => TYPE_LABEL[t] || 'Organization';
export function assessInvestor(lead, prefs, ctx = {}) {
  const reasons = []; const gaps = []; let tier = 'verify'; let excludedBy = null;
  const wanted = prefs.types || []; const only = prefs.mode === 'only';
  const wantedLabel = wanted.map((t) => TYPE_LABEL[t].toLowerCase()).join(' or ');
  if (lead.person) {
    const role = roleFit(lead.role);
    const parent = ctx.parentOf?.(lead) || null;
    const parentFit = parent?.investorFit || null;
    const entity = parentFit?.entity || classifyEntity({ ...lead, evidence: [] });
    const base = { entity, role: { value: role, title: lead.role || null }, deals: [], instruments: [], listed: parentFit?.listed || { value: 'unknown' }, personLevel: true };
    if (role === 'operational') return { ...base, tier: 'excluded', excludedBy: 'role', reasons: [`${lead.role} is not an investment role; working at ${lead.org} does not show that this person invests or decides investments.`], gaps: [], nextAction: 'Look for a partner, principal or investment lead at this organization instead.' };
    if (parentFit?.tier === 'excluded') return { ...base, tier: 'excluded', excludedBy: parentFit.excludedBy, reasons: [`Organization ruled out: ${parentFit.reasons[0] || 'does not meet your criteria'}.`], gaps: [], nextAction: 'No action.' };
    if (role === 'unknown') { reasons.push(lead.role ? `Role "${lead.role}" does not show an investment function.` : 'Role not confirmed.'); gaps.push('Confirm whether this person makes or recommends investments'); }
    if (role === 'leadership') { reasons.push(`${lead.role}: senior role at ${lead.org}; investment authority is not shown by the sources.`); gaps.push('Confirm this person decides direct investments'); }
    if (role === 'investing') reasons.push(`Role "${lead.role}" is an investment role (title only; personal thesis not verified).`);
    reasons.push(`Organization evidence belongs to ${lead.org}; it is not attributed to this person.`);
    tier = parentFit ? (parentFit.tier === 'meets' && role === 'investing' ? 'meets' : parentFit.tier === 'alternative' && role === 'investing' ? 'alternative' : 'verify') : 'verify';
    if (!parentFit) gaps.push(`Verify ${lead.org} as an investor that fits`);
    return { ...base, tier, excludedBy: null, reasons, gaps, nextAction: tier === 'verify' ? `Confirm ${lead.person}'s role before contacting.` : `Review ${lead.org}'s evidence, then prepare an outreach plan for ${lead.person}.` };
  }
  const entity = classifyEntity(lead);
  const deals = dealsFrom(lead); const instruments = instrumentsFrom(lead); const listed = listedCompat(lead);
  const base = { entity, role: null, deals, instruments, listed };
  if (entity.type === 'funded_company') return { ...base, tier: 'excluded', excludedBy: 'funded_company', reasons: [`Sources show ${lead.org} raising capital, not investing. It is not shown as an investor; its round can point to investors to research.`], gaps: [], nextAction: `Open the round source and research the investors named there.` };
  if (entity.type === 'operating_company') return { ...base, tier: 'excluded', excludedBy: 'operating_company', reasons: [`Operating company; no source shows it making investments.`], gaps: [], nextAction: 'No action as an investor.' };
  for (const x of prefs.exclusions || []) {
    const hitAdviser = x.kind === 'wealth_adviser' && (entity.type === 'wealth_adviser' || (entity.adviser && !entity.direct));
    const hitVc = (x.kind === 'venture_capital' && entity.type === 'venture_capital') || (x.kind === 'unrelated_vc' && entity.type === 'venture_capital' && !(ctx.topicHits > 0));
    const hitCorp = x.kind === 'corporate' && entity.type === 'corporate_venture';
    const hitType = ['hedge_fund', 'private_equity'].includes(x.kind) && entity.type === x.kind;
    if (hitAdviser || hitVc || hitCorp || hitType) { excludedBy = x.kind; return { ...base, tier: 'excluded', excludedBy, reasons: [`Your exclusion: ${x.label.toLowerCase()} (“${x.quote.slice(0, 120)}”).`], gaps: [], nextAction: 'No action.' }; }
  }
  if (entity.type === 'wealth_adviser') { reasons.push('Sources describe advisory or wealth services; no direct investment is cited.'); gaps.push('Find a direct investment before treating it as an investor'); }
  if (!entity.invests && !lead.directInvestment) gaps.push('No source shows this organization investing');
  else reasons.push(`Invests: “${String((entity.invests || lead.directInvestment).quote).slice(0, 160)}”`);
  if (wanted.length) {
    const match = wanted.includes(entity.type);
    if (match && entity.status === 'sourced') { reasons.unshift(`${typeName(entity.type)} per its source: “${String(entity.quote).slice(0, 140)}”`); tier = entity.invests || lead.directInvestment ? 'meets' : 'verify'; }
    else if (match && entity.nameOnly) { reasons.unshift(`The name says family office, but no source describes it as one.`); gaps.unshift('Confirm it is a family office and that it invests directly'); tier = 'verify'; }
    else if (['unknown', 'investor'].includes(entity.type)) { gaps.unshift(`Confirm whether it is a ${wantedLabel}`); tier = 'verify'; }
    else if (only) return { ...base, tier: 'excluded', excludedBy: 'type', reasons: [`${typeName(entity.type)}, not a ${wantedLabel}; you asked only for ${wantedLabel}s.`], gaps: [], nextAction: 'No action.' };
    else { reasons.unshift(`${typeName(entity.type)}, not a ${wantedLabel}${entity.quote ? ` (“${String(entity.quote).slice(0, 120)}”)` : ''}.`); tier = entity.invests || lead.directInvestment ? 'alternative' : 'verify'; }
  } else tier = entity.invests || lead.directInvestment ? (ctx.bucket === 'top' ? 'meets' : 'verify') : 'verify';
  if (!(ctx.topicHits > 0) && !lead.directInvestment) { gaps.push('No sector match in the evidence read'); if (tier === 'meets') tier = 'verify'; }
  if (prefs.listing === 'public') {
    if (listed.value === 'listed_evidence') reasons.push(`Sources mention listed-company financing: “${listed.quote.slice(0, 120)}”`);
    else if (listed.value === 'private_only') { gaps.push('States a private-company focus; your company is listed'); if (tier === 'meets') tier = 'verify'; }
    else gaps.push('No evidence it invests in listed companies (PIPE, registered direct)');
  }
  if (!deals.length) gaps.push('No comparable deal found in the sources read');
  if (!lead.contact) gaps.push('No contact channel found');
  const nextAction = tier === 'meets' ? 'Prepare an outreach plan and confirm the contact person.'
    : tier === 'alternative' ? `Consider only if ${wantedLabel || 'preferred'} candidates are too few; verify fit first.`
      : `Verify: ${gaps[0] || 'fit and investor type'}.`;
  return { ...base, tier, excludedBy, reasons, gaps: [...new Set(gaps)], nextAction };
}

const TIER_BUCKET = { meets: 'top', alternative: 'radar', verify: 'radar', excluded: 'discarded' };
/** Aplica el encaje a los leads de inversión ya puntuados (core.evaluate). Las organizaciones primero: las personas heredan. */
export function applyInvestorFit(leads, brief) {
  if (!(brief.fundingTypes || []).includes('investment')) return leads;
  const prefs = investorPrefs(brief);
  const isInv = (l) => l.fundingType === 'investment' && l.kind !== 'opportunity';
  const orgs = new Map(); const byKey = new Map();
  for (const l of leads) if (isInv(l) && !l.person) { orgs.set(norm(l.org), l); if (l.key) byKey.set(l.key, l); }
  const parentOf = (p) => (p.parentKey && byKey.get(p.parentKey)) || orgs.get(norm(p.org)) || null;
  const assess = (l) => {
    if (!isInv(l) || l.bucket === 'discarded') return l;
    const fit = assessInvestor(l, prefs, { parentOf, topicHits: (l.matchedTerms || []).length, bucket: l.bucket });
    l.investorFit = fit;
    l.bucket = TIER_BUCKET[fit.tier];
    if (fit.tier === 'excluded') l.discard = fit.reasons[0];
    return l;
  };
  for (const l of leads) if (!l.person) assess(l);
  for (const l of leads) if (l.person) assess(l);
  return leads;
}
