// V9 (f): emparejamiento nombre–dominio para la resolución, más permisivo que nameMatchesDomain de extractor.mjs (que no se toca).
// Solo elige qué URL abrir: la firma sigue entrando únicamente si su sitio oficial pasa el extractor con cita literal y el
// control de misma firma de resolve.mjs. Reglas: etiqueta registrable (no el primer subdominio), plegado de acentos, nombres
// cortos solo con igualdad exacta, siglas del nombre, y sin el tipo que pegan las tablas de agregadores.
import { nameMatchesDomain } from './extractor.mjs';
const GENERIC_TAIL = /\b(?:vc fund|pe fund|corporate vc|family office|angel|accelerator|fund [ivx]+|llc|ltd|inc|gmbh|plc|pte|s\.?a\.?|b\.?v\.?)$/i;
const MULTI_TLD = /\.(?:co|com|org|net|ac|gov)\.[a-z]{2}$/;
const STOP = new Set(['the', 'and', 'of', 'de', 'da', 'do', 'en', 'y', 'e']);
const fold = s => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
export const stripTypeTail = name => { let s = String(name ?? '').replace(/\s*\([^)]*\)\s*$/, '').trim(); for (let i = 0; i < 2; i++) s = s.replace(GENERIC_TAIL, '').trim(); return s; };
/** Etiqueta registrable del host: "v3.eqtventures.com" → "eqtventures"; "fondo.org" → "fondo"; "x.co.uk" → "x". */
export function registrableLabel(host) {
  const h = fold(host).replace(/^www\./, ''), parts = h.split('.');
  if (parts.length < 2) return parts[0] ?? '';
  return MULTI_TLD.test(h) && parts.length >= 3 ? parts.at(-3) : parts.at(-2);
}
const FIRM_WORDS = new Set(['ventures', 'venture', 'capital', 'partners', 'fund', 'vc', 'investments', 'investment', 'equity', 'group', 'management', 'holdings', 'labs', 'advisors']);
/** true si el host parece el sitio propio del nombre. */
export function nameMatchesDomainV9(name, host) {
  if (nameMatchesDomain(name, host)) return true;                       // la regla v8 sigue valiendo
  const n = stripTypeTail(name), label = registrableLabel(host).replace(/[^a-z0-9]/g, '');
  if (!label) return false;
  const words = fold(n).replace(/&/g, ' ').split(/[^a-z0-9]+/).filter(Boolean);
  const joined = words.join(''), core = words.filter(w => !FIRM_WORDS.has(w)).join('');
  if (label.length >= 5 && joined.length >= 5 && (joined.includes(label) || label.includes(joined))) return true;   // etiqueta registrable
  if (core.length >= 2 && (label === core || (core.length >= 4 && label.startsWith(core) && FIRM_WORDS.has(label.slice(core.length)) ) || (label.length >= 4 && core.length >= 4 && label === core))) return true; // "hi"→hi.vc, "qbic"→qbic.be
  const sig = words.filter(w => !STOP.has(w)), acro = sig.map(w => w[0]).join('');
  if (acro.length >= 3 && (label === acro || label === `${acro}vc` || label === `${acro}capital` || label === `${acro}llc`)) return true;   // "New Enterprise Associates"→nea, "Lightspeed Venture Partners"→lsvp no (l-v-p)
  const paren = String(name).match(/\(([A-Za-z0-9]{2,8})\)\s*$/); if (paren && (label === fold(paren[1]) || label.startsWith(fold(paren[1])))) return true;   // "(ATV)"→atvcapital
  return false;
}
