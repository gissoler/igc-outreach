/* ─────────────────────────────────────────────────────────────────────────────
   V15 · Expediente por convocatoria.
   La unidad de decisión deja de ser la página y pasa a ser la CONVOCATORIA (RD-04, runs-v6):
     · todas las fuentes de una misma convocatoria (NIH Guide, Simpler, Grants.gov, páginas web)
       se agrupan por su identificador oficial (RFA-AG-27-005, PA-25-304…) o, si no tiene, por URL canónica;
     · cada documento lleva su clase de texto: full (aviso completo), synopsis (descripción + requisitos del
       registro), stub (ficha sin alcance ni requisitos) o web (página leída);
     · una ficha stub nunca se juzga sola: o se completa con otra fuente, o el expediente queda «no evaluable»;
     · el juez lee el expediente entero, así la evidencia negativa de un documento completo no la borra una ficha pobre.
   Funciones puras (sin red, disco ni reloj).
   ───────────────────────────────────────────────────────────────────────────── */
import { foaIdsIn } from '../grantSources.mjs';
import { hostKind, hostOf } from '../verify.mjs';
import { focusText } from '../../lib/relevance.mjs';
import { nihDueDates, nihEligibility, nihKeyDates, nihNosiCore, nihPurpose } from './nihGuide.mjs';
import { parseDates } from '../dates.mjs';

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const KIND_RANK = { full: 0, synopsis: 1, web: 2, stub: 3 };
const SOURCE_RANK = { nih_guide: 0, simpler: 1, grants_gov: 2, web: 3, agent: 4 };

/** URL canónica para agrupar páginas sin identificador oficial: host sin www, ruta sin barra final, sin consulta ni ancla. */
export function canonicalUrl(url) {
  try { const u = new URL(url); return `${u.hostname.replace(/^www\./, '').toLowerCase()}${u.pathname.replace(/\/+$/, '').toLowerCase() || '/'}`; } catch { return String(url || '').toLowerCase(); }
}

/** Identificador de convocatoria de un elemento: el estructurado del registro, o el ÚNICO ID oficial del título/URL
 *  de una página (una página con varios IDs es un índice, no una convocatoria). */
export function callIdOf(item = {}) {
  if (item.number && foaIdsIn(item.number).length === 1) return foaIdsIn(item.number)[0];
  if (item.number && ['simpler', 'grants_gov'].includes(item.source)) return clean(item.number).toUpperCase();
  const fromHead = foaIdsIn(`${item.title || ''} ${item.url || ''}`);
  if (fromHead.length === 1) return fromHead[0];
  if (fromHead.length === 0 && item.textKind !== 'stub') { const inText = foaIdsIn(String(item.text || '').slice(0, 1500)); if (inText.length === 1) return inText[0]; }
  return null;
}

/** ¿El texto trae alcance y requisitos? Un aviso o página «suficiente» dice qué financia y quién puede aplicar. */
const SCOPE_RX = /\b(purpose|research objectives?|description|scope|supports?|will fund|funds?|seeks|intends? to|aims?|priorit(?:y|ies)|areas? of (?:interest|research)|topics?)\b/i;
const ELIG_RX = /\b(eligib\w*|who (?:can|may) apply|applicants?|applicant types?|organizations? (?:may|can)|open to|must be)\b/i;
export function textKindOf(item = {}) {
  if (item.textKind === 'full' || item.textKind === 'stub') return item.textKind;
  const t = String(item.text || '');
  if (item.textKind === 'synopsis') return t.length >= 300 && ELIG_RX.test(t) && SCOPE_RX.test(t) ? 'synopsis' : 'stub';
  return t.length >= 300 && SCOPE_RX.test(t) && ELIG_RX.test(t) ? 'web' : t.length >= 1500 && SCOPE_RX.test(t) ? 'web' : 'stub';
}

/** Agrupa elementos en expedientes. `items`: [{source,id?,number?,url,title,agency,text,textKind,meta}].
 *  Dos elementos van al mismo expediente si comparten ID oficial o URL canónica (unión de ambos criterios). */
export function buildDossiers(items = []) {
  const list = items.filter((x) => x?.url).map((raw) => { const item = { ...raw, textKind: textKindOf(raw) }; return { item, id: callIdOf(item), urlKey: canonicalUrl(item.url) }; });
  const parent = list.map((_, i) => i); const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i]))); const join = (a, b) => { const x = find(a); const y = find(b); if (x !== y) parent[y] = x; };
  const firstBy = new Map();
  for (const [i, x] of list.entries()) for (const k of [x.id ? `id:${x.id}` : null, `url:${x.urlKey}`].filter(Boolean)) { if (firstBy.has(k)) join(firstBy.get(k), i); else firstBy.set(k, i); }
  const groups = new Map();
  for (const [i] of list.entries()) { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(list[i]); }
  const out = [];
  for (const members of groups.values()) {
    const ids = [...new Set(members.map((m) => m.id).filter(Boolean))];
    const d = { key: ids[0] ? `id:${ids[0]}` : `url:${members[0].urlKey}`, id: ids[0] || null, ids, title: '', agency: '', urls: [], docs: [], sources: [], meta: {}, refs: [] };
    for (const { item, urlKey } of members) {
      if (!d.urls.includes(item.url)) d.urls.push(item.url);
      if (!d.sources.includes(item.source)) d.sources.push(item.source);
      if (item.ref) d.refs.push(item.ref);
      const same = d.docs.find((x) => canonicalUrl(x.url) === urlKey && x.source === item.source);
      if (same) { if ((KIND_RANK[item.textKind] ?? 9) < (KIND_RANK[same.textKind] ?? 9) || String(item.text || '').length > String(same.text || '').length) Object.assign(same, item); }
      else d.docs.push(item);
      // Metadatos: el NIH y el registro mandan; una página web no pisa un dato oficial.
      for (const [k, v] of Object.entries(item.meta || {})) if (v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && !v.length) && (d.meta[k] === undefined || (SOURCE_RANK[item.source] ?? 9) < (SOURCE_RANK[d.meta[`${k}__src`]] ?? 9))) { d.meta[k] = v; d.meta[`${k}__src`] = item.source; }
    }
    d.docs.sort((a, b) => (KIND_RANK[a.textKind] ?? 9) - (KIND_RANK[b.textKind] ?? 9) || (SOURCE_RANK[a.source] ?? 9) - (SOURCE_RANK[b.source] ?? 9));
    const best = d.docs[0];
    d.title = clean(d.docs.find((x) => x.source === 'nih_guide')?.title || d.docs.find((x) => ['simpler', 'grants_gov'].includes(x.source))?.title || best?.title || '');
    d.agency = clean(d.docs.find((x) => x.agency)?.agency || '');
    d.url = (d.docs.find((x) => x.source === 'nih_guide') || d.docs.find((x) => x.textKind === 'full') || d.docs.find((x) => x.source === 'simpler') || best).url;
    d.sufficiency = sufficiencyOf(d);
    out.push(d);
  }
  return out;
}

/** Suficiencia documental del expediente: evaluable solo si algún documento trae alcance y requisitos. */
export function sufficiencyOf(d) {
  const kinds = d.docs.map((x) => x.textKind);
  const level = kinds.includes('full') ? 'full' : kinds.includes('synopsis') ? 'synopsis' : kinds.includes('web') ? 'web' : 'stub';
  return { level, evaluable: level !== 'stub', why: level === 'stub' ? 'only_registry_stub' : null, docs: d.docs.map((x) => ({ source: x.source, url: x.url, kind: x.textKind, chars: String(x.text || '').length })) };
}

/* ── Estado determinista con metadatos oficiales (antes de gastar juez) ── */
export function officialStatus(d, today) {
  const m = d.meta || {};
  if (m.expires && m.expires < today) return { state: 'expired', why: `Official expiration date ${m.expires} is before today`, source: m.expires__src };
  const st = String(m.status || '').toLowerCase();
  if (/closed|archived|expired/.test(st)) return { state: 'closed', why: `Registry status: ${st}`, source: m.status__src };
  if (m.closeDate && m.closeDate < today && !m.expires) return { state: 'closed', why: `Registry close date ${m.closeDate} is before today`, source: m.closeDate__src };
  if (/forecast/.test(st)) return { state: 'forecast', why: 'Registry status: forecasted', source: m.status__src };
  return { state: 'unknown', why: null, source: null };
}

/** Próxima fecha para una solicitud NUEVA en un aviso del NIH (Key Dates o fechas estándar). */
export function nihNextDue(d, today) {
  const doc = d.docs.find((x) => x.source === 'nih_guide' && x.textKind === 'full'); if (!doc) return null;
  const r = nihDueDates(doc.text, { today, expires: d.meta?.expires || null, activityCodes: d.meta?.activityCodes || [], parse: parseDates });
  return r.next ? { ...r.next, standard: r.standard } : null;
}

/** Mecanismo legible (R21 exploratorio, R01, SBIR…) para cubrir rutas generales además de las temáticas. */
export function mechanismOf(d) {
  const codes = d.meta?.activityCodes || []; const parent = Boolean(d.meta?.parent);
  const label = codes.length ? codes.join('/') : null;
  const nosi = d.meta?.nihKind === 'nosi';
  return { codes, parent, nosi, label: nosi ? `NOSI${label ? ` ${label}` : ''}` : label, sbir: codes.some((c) => /^(R4[1-4]|U4[34]|SB1)$/.test(c)) };
}

/* ── Texto de evidencia que lee el juez (≤ 11.500 caracteres; dentro de pageExcerpt no se vuelve a recortar) ── */
const DATE_WORDS = ['deadline', 'due date', 'letter of intent', 'loi', 'closes', 'apply by', 'submission', 'expiration'];
const ELIG_WORDS = ['eligib', 'who can apply', 'who may apply', 'applicant', 'foreign', 'for-profit', 'small business', 'institution'];
function docBlock(doc, termsList, budget) {
  const head = `=== Source: ${doc.url} (${doc.source}${doc.textKind ? `, ${doc.textKind}` : ''}) ===`;
  const t = String(doc.text || '').replace(/\s+/g, ' ');
  if (doc.source === 'nih_guide' && doc.textKind === 'full') {
    const parts = doc.kind === 'nosi' || /^NOT-/.test(doc.number || '')
      ? [nihNosiCore(t, Math.round(budget * 0.6))]
      : [nihKeyDates(t, Math.round(budget * 0.22)), nihPurpose(t, Math.round(budget * 0.34)), nihEligibility(t, Math.round(budget * 0.26))];
    if (!parts.some(Boolean)) parts.push(t.slice(0, Math.round(budget * 0.6)));   // sin marcas de sección reconocibles: cabeza del aviso
    const used = parts.join(' … ').length;
    const focus = termsList.length ? focusText(t, termsList, { window: 420, max: 3 }) : '';
    return [head, ...parts.filter(Boolean), focus && used + focus.length < budget ? `[Passages about the applicant topic] ${focus}` : ''].filter(Boolean).join('\n');
  }
  if (t.length <= budget) return `${head}\n${t}`;
  const lead = t.slice(0, Math.round(budget * 0.45));
  const rest = t.slice(lead.length);
  const dates = focusText(rest, DATE_WORDS, { window: 360, max: 3 });
  const elig = focusText(rest, ELIG_WORDS, { window: 420, max: 3 });
  const topic = termsList.length ? focusText(rest, termsList, { window: 360, max: 2 }) : '';
  return [head, lead, ' … ', elig, ' … ', dates, topic ? ` … ${topic}` : ''].join('').slice(0, budget + head.length + 1);
}
/** Metadatos oficiales legibles (van al texto para que el juez pueda citarlos literalmente). */
export function metaLines(d) {
  const m = d.meta || {}; const out = [];
  if (d.id) out.push(`Funding opportunity number: ${d.id}.`);
  if (d.title) out.push(`Title: ${d.title}.`);
  if (d.agency) out.push(`Agency: ${d.agency}.`);
  if (m.status) out.push(`Registry status: ${m.status}.`);
  if (m.activityCodes?.length) out.push(`Activity code(s): ${m.activityCodes.join(', ')}.`);
  if (m.parent) out.push('This is an NIH parent announcement (investigator-initiated, any topic within the mission of the participating institutes).');
  if (m.nihKind === 'nosi') out.push('This is an NIH Notice of Special Interest (NOSI): applications are submitted through the funding opportunities it lists, with their due dates.');
  if (m.clinicalTrials) out.push(`Clinical trials: ${String(m.clinicalTrials).replace(/_/g, ' ')}.`);
  if (m.opens) out.push(`Open date (earliest submission date): ${m.opens}.`);
  if (m.closeDate) out.push(`Registry close date: ${m.closeDate}.`);
  if (m.expires) out.push(`Expiration date: ${m.expires}.`);
  if (m.applicantTypes?.length) out.push(`Registry applicant types: ${m.applicantTypes.join('; ')}.`);
  return out.join('\n');
}
export function evidenceText(d, { terms = [], max = 11500 } = {}) {
  const docs = d.docs.filter((x) => x.textKind !== 'stub' || d.docs.length === 1).slice(0, 3);
  const header = `Official dossier for one funding opportunity (${d.docs.length} source document${d.docs.length === 1 ? '' : 's'}).\n${metaLines(d)}`;
  const share = Math.max(1500, Math.floor((max - header.length) / Math.max(1, docs.length)));
  const weights = docs.map((x, i) => (i === 0 ? 1.4 : 0.8)); const total = weights.reduce((a, b) => a + b, 0);
  const blocks = docs.map((x, i) => docBlock(x, terms, Math.floor(share * docs.length * (weights[i] / total))));
  return `${header}\n${blocks.join('\n')}`.slice(0, max);
}

/** Ítems de un expediente que no se juzgan (agregadores o redes) quedan fuera desde el principio. */
export const judgeable = (d) => d.docs.some((x) => hostKind(x.url) === 'other') && d.sufficiency.evaluable;
export const hostsOf = (d) => [...new Set(d.urls.map(hostOf))];
