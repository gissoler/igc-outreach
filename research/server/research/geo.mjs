/* País del solicitante a partir del brief, sin tablas escritas a mano: los nombres salen de Intl.DisplayNames (ISO 3166).
   Sirve para dos cosas genéricas: bajar en el ranking las páginas con dominio de otro país y decidir si aplica el registro federal de EE. UU. */
const CODES = (() => {
  const names = new Map(); let dn = null;
  try { dn = new Intl.DisplayNames(['en'], { type: 'region' }); } catch { return names; }
  for (let a = 65; a <= 90; a++) for (let b = 65; b <= 90; b++) {
    const code = String.fromCharCode(a, b); let name = null; try { name = dn.of(code); } catch { name = null; }
    if (name && name !== code) names.set(name.toLowerCase(), code);
  }
  return names;
})();
const ALIASES = { usa: 'US', 'u.s.': 'US', 'u.s.a.': 'US', us: 'US', 'united states of america': 'US', america: 'US', uk: 'GB', 'great britain': 'GB', england: 'GB', eu: 'EU', europe: 'EU' };
const clean = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

/** Código ISO-2 del país del brief (o 'EU'), o null si no se puede saber. Mira country, geography y location, en ese orden. */
export function briefCountry(brief = {}) {
  for (const key of ['country', 'geography', 'location', 'region']) {
    const raw = clean(brief?.[key]); if (!raw || /^(global|worldwide|any|international)$/.test(raw)) continue;
    for (const part of [raw, ...raw.split(/[,;/|]| and | y /).map((x) => x.trim())]) {
      if (!part) continue;
      if (ALIASES[part]) return ALIASES[part];
      if (/^[a-z]{2}$/.test(part) && CODES.size && [...CODES.values()].includes(part.toUpperCase())) return part.toUpperCase();
      if (CODES.has(part)) return CODES.get(part);
    }
  }
  return null;
}

/** ccTLD de un host ('uk' de gov.uk, 'eu' de europa.eu); null si es genérico (.gov, .org, .com…). */
export function hostCountryTld(host = '') {
  const tld = String(host).toLowerCase().split('.').filter(Boolean).pop() || '';
  return /^[a-z]{2}$/.test(tld) ? tld : null;
}
// ccTLD que en la práctica se usan como genéricos (marcas, startups): no dicen el país.
const VANITY = new Set(['io', 'ai', 'co', 'me', 'tv', 'ly', 'fm', 'gg', 'so', 'to', 'cc', 'ws', 'sh']);
/** ¿El dominio es de otro país distinto al del brief? Solo cuando el brief fija país y el dominio tiene un ccTLD real. */
export function foreignHost(host, country) {
  if (!country || country === 'EU') return false;   // un brief «Europa» acepta cualquier país europeo: no se penaliza
  const tld = hostCountryTld(host); if (!tld || VANITY.has(tld)) return false;
  return tld !== (country === 'GB' ? 'uk' : country.toLowerCase());
}
