#!/usr/bin/env node
// Fase 1.5 — prueba LLM vs diseño. Sin cambiar el extractor ni el prompt v1.
//   (b) gpt-oss-120b: usa la extracción cruda guardada en cache.sqlite de v3 (temperatura 0, mismo prompt) — sin red.
//   (c) --strong: misma petición (prompt extractor v1, schema investor_extraction) a un endpoint OpenAI-compatible
//       STRONG_LLM_URL / STRONG_LLM_MODEL / STRONG_LLM_API_KEY, con tope de gasto --cap-usd (precios por 1M tokens en
//       STRONG_PRICE_IN / STRONG_PRICE_OUT). Se detiene antes de superar el tope.
//   (d) --guided: pide al servidor de la flota (rol engine) una salida que viola el schema y mira si la impone.
// Uso: node llm_vs_design.mjs --v3 <dir out v3> --labels <adjudicator.jsonl> --out <dir> [--n 20] [--strong] [--guided] [--cap-usd 5]
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { normalizeUrl } from '../../../agent/docs.mjs';
import { render, sanitizePageText } from '../../../agent/prompts.mjs';
import { fleetTransport } from '../../../agent/llm.mjs';
import { parseJsonContent } from '../../../server/analysis/fleet.mjs';
import { loadInvestorPrompt } from '../prompts.mjs';
import { bundleInvestor, validateInvestor, investorRepoRoot as repo } from '../contracts.mjs';
import { extractFixtureInvestor, groundInvestorExtraction, describeInvestorExtraction } from '../extractor.mjs';
import { judgeInvestor } from '../judge.mjs';
import { investorGain } from '../ranking.mjs';

const arg = (name, d = null) => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? d : process.argv[i + 1]; };
const flag = name => process.argv.includes(`--${name}`);
const sha = v => createHash('sha256').update(String(v)).digest('hex');
const json = p => JSON.parse(readFileSync(p, 'utf8'));
const host = u => { try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ''); } catch { return null; } };
const V3 = resolve(arg('v3')), OUTDIR = resolve(arg('out')), N = Number(arg('n', 20)), CAP = Number(arg('cap-usd', 5));
mkdirSync(OUTDIR, { recursive: true });

// Copia local del caché: nunca abrimos SQLite dentro de la carpeta de evidencia.
const dbCopy = resolve(tmpdir(), `v3-cache-${process.pid}.sqlite`); copyFileSync(resolve(V3, 'cache.sqlite'), dbCopy);
const db = new DatabaseSync(dbCopy, { readOnly: true });
const ns = db.prepare('SELECT DISTINCT namespace FROM entries').all().map(r => r.namespace)[0];
const get = (kind, key) => { const r = db.prepare('SELECT value_json FROM entries WHERE namespace=? AND kind=? AND key=?').get(ns, kind, key); return r ? JSON.parse(r.value_json) : null; };

const prompt = loadInvestorPrompt('extractor', 'v1');
const catalog = json(resolve(repo, 'docs/contracts/investor/criteria_catalog.investor.v1.json'));
const casesDir = resolve(repo, 'research/bench/investors/cases');
const cases = new Map(readdirSync(casesDir).filter(x => x.endsWith('.json') && x !== 'manifest.json').map(x => { const c = json(resolve(casesDir, x)); return [c.case_id, c]; }));
const profileOf = caseId => json(resolve(repo, cases.get(caseId).profile_path));

// Firmas con etiqueta positiva (gain de etiqueta >= 2) y dominio resoluble.
const labels = readFileSync(resolve(arg('labels')), 'utf8').trim().split('\n').map(JSON.parse).filter(l => investorGain(l) >= 2 && l.stable_id.startsWith('inv:domain:'));
// Páginas descargadas en v3 (extract_end) por caso.
const pagesByCase = new Map();
for (const line of readFileSync(resolve(V3, 'events.jsonl'), 'utf8').split('\n')) {
  if (!line.includes('"extract_end"')) continue; const e = JSON.parse(line); const caseId = e.run_id.split('__')[1];
  (pagesByCase.get(caseId) ?? pagesByCase.set(caseId, new Set()).get(caseId)).add(e.url);
}
const candidates = [];
for (const l of labels) {
  const domain = l.stable_id.slice('inv:domain:'.length);
  const urls = [...(pagesByCase.get(l.case_id) ?? [])].filter(u => { const h = host(u); return h === domain || h?.endsWith(`.${domain}`); }).sort((a, b) => a.length - b.length || a.localeCompare(b));
  for (const url of urls) {
    const page = get('fetch', normalizeUrl(url)); if (!page?.text || page.text.length < 200) continue;
    candidates.push({ case_id: l.case_id, stable_id: l.stable_id, url, page, label: l }); break;
  }
}
// Selección determinista: round-robin por caso.
const byCase = new Map(); for (const c of candidates.sort((a, b) => a.case_id.localeCompare(b.case_id) || a.stable_id.localeCompare(b.stable_id))) (byCase.get(c.case_id) ?? byCase.set(c.case_id, []).get(c.case_id)).push(c);
const sample = [], seenUrl = new Set(); for (let i = 0; sample.length < N && [...byCase.values()].some(v => v.length > i); i++) for (const v of byCase.values()) if (v[i] && sample.length < N && !seenUrl.has(v[i].url)) { seenUrl.add(v[i].url); sample.push(v[i]); }

const userFor = (url, text) => render(prompt.user, { today: '2026-10-08', url, page_text: sanitizePageText(text).replaceAll('{{', '{ {').replaceAll('}}', '} }').slice(0, 24000) });
const CORE = ['INV-SECTOR', 'INV-STAGE', 'INV-GEO', 'INV-TYPE'];
const FACTS = ['investor_type', 'sectors', 'stages', 'geographies', 'check_range_usd', 'rounds', 'lead_follow', 'business_models', 'active_status', 'published_on', 'quote', 'official_domain'];
// Lo que la página dice, por regex conservadora (solo para saber si el dato estaba disponible).
const SAYS = {
  stages: /\b(pre-?seed|seed|series [a-e]|early[- ]stage|growth[- ]stage|late[- ]stage|scale-?up)\b/i,
  investor_type: /\b(venture capital|vc firm|venture fund|family office|corporate venture|accelerator|private equity|investment firm)\b/i,
};
function scoreExtraction(row, raw) {
  const document = { url: row.url, title: row.page.title || row.url, text: row.page.text };
  const profile = profileOf(row.case_id);
  const extracted = extractFixtureInvestor({ document, extraction: raw, today: '2026-10-08', firstSeen: { step: 0, search_index: 0, order: 0, query_id: 'q000' } });
  // Para medir el contenido de la extracción, también juzgamos la entidad aunque el gate la rechace.
  let entity = extracted.entity, bypass = false;
  if (!entity) { try { entity = extractFixtureInvestor({ document: { url: row.url, title: document.title }, extraction: { ...groundInvestorExtraction({ document, extraction: raw }), entity_kind: 'institutional_investor', canonical_name: raw?.canonical_name && !/^(null|unknown)$/i.test(raw.canonical_name) ? raw.canonical_name : row.stable_id, official_domain: row.stable_id.slice(11) }, today: '2026-10-08', firstSeen: { step: 0, search_index: 0, order: 0, query_id: 'q000' } }).entity; bypass = true; } catch { entity = null; } }
  const j = entity ? judgeInvestor({ entity, profile, catalog }) : null;
  const state = id => j?.criteria.find(c => c.criterion_id === id)?.state ?? 'unknown';
  const diag = describeInvestorExtraction({ document, raw, grounded: groundInvestorExtraction({ document, extraction: raw }), entity: extracted.entity });
  return {
    accepted: Boolean(extracted.entity), rejected_kind: extracted.rejected_kind, judged_with_gate_bypass: bypass,
    facts_filled: FACTS.filter(f => diag.fields_present.includes(f) || (f === 'active_status' && raw?.active_status && raw.active_status !== 'unknown')),
    core_known: CORE.filter(id => state(id) !== 'unknown'), all_known: j ? j.criteria.filter(c => c.state !== 'unknown').length : 0,
    gain: j ? investorGain({ ...j, identity_correct: true, entity_kind: 'institutional_investor' }) : 0,
    page_says: Object.fromEntries(Object.entries(SAYS).map(([k, re]) => [k, re.test(row.page.text)]))
  };
}
const summarize = rows => {
  const n = rows.length, sum = f => rows.reduce((a, r) => a + f(r), 0);
  return {
    pages: n,
    core_criteria_known_pct: n ? +(100 * sum(r => r.core_known.length) / (4 * n)).toFixed(1) : null,
    all12_criteria_known_pct: n ? +(100 * sum(r => r.all_known) / (12 * n)).toFixed(1) : null,
    pages_all4_core_known: sum(r => r.core_known.length === 4 ? 1 : 0),
    fact_fields_filled_pct: n ? +(100 * sum(r => r.facts_filled.length) / (FACTS.length * n)).toFixed(1) : null,
    per_field_filled: Object.fromEntries(FACTS.map(f => [f, sum(r => r.facts_filled.includes(f) ? 1 : 0)])),
    accepted_by_gate: sum(r => r.accepted ? 1 : 0), gain_ge2: sum(r => r.gain >= 2 ? 1 : 0),
    page_states_stage: sum(r => r.page_says.stages ? 1 : 0), page_states_type: sum(r => r.page_says.investor_type ? 1 : 0)
  };
};

const report = { as_of: new Date().toISOString(), sample: sample.map(r => ({ case_id: r.case_id, stable_id: r.stable_id, url: r.url, chars: r.page.text.length })) };
// (b) gpt-oss-120b desde el caché v3.
const ossRows = [];
for (const row of sample) {
  const key = sha([prompt.sha256, sha(userFor(row.url, row.page.text)), 'investor_extraction', 0, 0].join('|'));
  const raw = get('llm', key)?.json ?? null;
  ossRows.push({ url: row.url, cache_hit: Boolean(raw), raw, ...(raw ? scoreExtraction(row, raw) : {}) });
}
report.gpt_oss_120b = { model: 'openai/gpt-oss-120b (cache v3, temperature 0)', cache_hits: ossRows.filter(r => r.cache_hit).length, ...summarize(ossRows.filter(r => r.cache_hit)), rows: ossRows };

// (c) modelo fuerte, mismo prompt y schema.
if (flag('strong')) {
  const url = process.env.STRONG_LLM_URL, model = process.env.STRONG_LLM_MODEL, apiKey = process.env.STRONG_LLM_API_KEY;
  const pin = Number(process.env.STRONG_PRICE_IN), pout = Number(process.env.STRONG_PRICE_OUT);
  if (!url || !model || !apiKey || !(pin > 0) || !(pout > 0)) throw new Error('Faltan STRONG_LLM_URL/STRONG_LLM_MODEL/STRONG_LLM_API_KEY/STRONG_PRICE_IN/STRONG_PRICE_OUT');
  let spent = 0; const rows = [];
  for (const row of sample) {
    const user = userFor(row.url, row.page.text), estIn = Math.ceil((prompt.system.length + user.length) / 3.5), estOut = 3000;
    if (spent + (estIn * pin + estOut * pout) / 1e6 > CAP) { rows.push({ url: row.url, skipped: 'cap' }); continue; }
    const body = { model, temperature: 0, max_tokens: 8000, messages: [{ role: 'system', content: prompt.system }, { role: 'user', content: user }], response_format: { type: 'json_schema', json_schema: { name: 'investor_extraction', schema: bundleInvestor('investor_extraction') } } };
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` }, body: JSON.stringify(body) });
    const data = await res.json(); const u = data.usage ?? {};
    spent += ((u.prompt_tokens ?? estIn) * pin + (u.completion_tokens ?? estOut) * pout) / 1e6;
    let raw = null, error = null; try { raw = parseJsonContent(data.choices?.[0]?.message?.content ?? ''); validateInvestor('investor_extraction', raw); } catch (e) { error = String(e.message).slice(0, 200); }
    rows.push({ url: row.url, raw, error, ...(raw && !error ? scoreExtraction(row, raw) : {}) });
  }
  const ok = rows.filter(r => r.raw && !r.error);
  report.strong = { model, spent_usd: +spent.toFixed(4), cap_usd: CAP, valid: ok.length, ...summarize(ok), rows };
}

// (d) ¿decodificación guiada estricta en la flota?
if (flag('guided')) {
  const tx = fleetTransport(process.env, 'engine');
  const schema = { type: 'object', additionalProperties: false, required: ['entity_kind', 'canonical_name'], properties: { entity_kind: { type: 'string', enum: ['institutional_investor', 'other'] }, canonical_name: { type: 'string', maxLength: 20 } } };
  const probes = [
    { id: 'enum_violation', user: 'Reply with exactly this JSON and nothing else: {"entity_kind":"banana","canonical_name":"X"}' },
    { id: 'extra_key', user: 'Reply with exactly this JSON and nothing else: {"entity_kind":"other","canonical_name":"X","foo":1}' },
    { id: 'missing_required', user: 'Reply with exactly this JSON and nothing else: {"foo":"bar"}' },
    { id: 'maxlength', user: 'Reply with JSON where canonical_name is the 60-character string "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" and entity_kind is "other".' }
  ];
  const out = [];
  for (const p of probes) {
    const r = await tx({ body: { temperature: 0, max_tokens: 400, messages: [{ role: 'user', content: p.user }], response_format: { type: 'json_schema', json_schema: { name: 'probe', strict: true, schema } } } });
    let parsed = null; try { parsed = parseJsonContent(r.content); } catch {}
    const conforms = parsed && typeof parsed === 'object' && Object.keys(parsed).every(k => ['entity_kind', 'canonical_name'].includes(k)) && ['institutional_investor', 'other'].includes(parsed.entity_kind) && typeof parsed.canonical_name === 'string' && parsed.canonical_name.length <= 20;
    out.push({ probe: p.id, content: String(r.content).slice(0, 200), conforms_to_schema: Boolean(conforms) });
  }
  report.guided_decoding = { server_model: process.env.ENGINE_LLM_MODEL || null, probes: out, strict_enforced: out.every(x => x.conforms_to_schema) };
}

db.close();
const strip = r => { const { raw, ...rest } = r; return { ...rest, raw_keys: raw ? Object.keys(raw) : null }; };
const printable = { ...report, gpt_oss_120b: { ...report.gpt_oss_120b, rows: report.gpt_oss_120b.rows.map(strip) }, ...(report.strong ? { strong: { ...report.strong, rows: report.strong.rows.map(strip) } } : {}) };
writeFileSync(resolve(OUTDIR, 'llm_vs_design.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(printable, (k, v) => k === 'rows' ? undefined : v, 2));
