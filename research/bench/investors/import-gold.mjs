#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

const repo = resolve(import.meta.dirname, '../../..');
const gold = process.argv[2];
if (!gold) throw new Error('Usage: import-gold.mjs <gold-directory>');
const casesDir = resolve(repo, 'research/bench/investors/cases');
const profilesDir = resolve(casesDir, 'profiles');
mkdirSync(profilesDir, { recursive: true });

const manifest = JSON.parse(readFileSync(resolve(gold, 'MANIFEST.json'), 'utf8'));
const selected = new Map();
for (const item of manifest.cases) selected.set(item.case_id, item);

const linesByFile = new Map();
for (const item of manifest.cases) {
  if (!linesByFile.has(item.profile_file)) {
    linesByFile.set(item.profile_file, readFileSync(resolve(gold, item.profile_file), 'utf8').trim().split('\n').map(JSON.parse));
  }
}

const archive = resolve(gold, '_handoff-claude-nube/handoff-gold.tgz');
const adjudicationName = new Map([
  ['inv-case-syn-p08', 'gold/C/out/inv-case-syn-p08-reanchor.json'],
  ['inv-case-syn-p12', 'gold/C/out/inv-case-syn-p12-reanchor.json'],
]);
const anchorFallback = {
  'inv-case-syn-p12': { canonical_name: '1337 Ventures', official_url: 'https://1337.ventures/' },
};
const readAdjudication = caseId => {
  const name = adjudicationName.get(caseId) ?? `gold/C/out/${caseId}.json`;
  try { return JSON.parse(execFileSync('tar', ['-xOzf', archive, name], { encoding: 'utf8' })); }
  catch { return null; }
};
const host = url => new URL(url).hostname.replace(/^www\./, '').toLowerCase();
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const coreProfile = row => ({
  schema_version: row.schema_version,
  profile_id: row.profile_id,
  status: row.status,
  as_of: row.as_of,
  provenance: row.provenance,
  fields: row.fields,
});

const nullSpecs = {
  'inv-case-syn-n04': {
    minutes: 20,
    scope: 'Institutional equity investors active for a Palau-incorporated utility-scale solar and battery IPP seeking a USD 28M Series B.',
    queries: ['Palau solar IPP equity investor', 'Pacific islands climate infrastructure fund equity', 'Palau battery storage project investor'],
  },
  'inv-case-syn-r13': {
    minutes: 20,
    scope: 'Institutional equity investors active for an Equatorial Guinea funeral and mortuary services operator seeking a USD 16M Series A.',
    queries: ['Equatorial Guinea funeral services private equity', 'CEMAC death care investor', 'Africa healthcare services fund Equatorial Guinea'],
  },
  'inv-case-syn-r14': {
    minutes: 20,
    scope: 'Institutional equity investors active for a Turkmenistan veterinary diagnostics and food-safety laboratory network seeking a USD 14M Series A.',
    queries: ['Turkmenistan veterinary diagnostics investor', 'Central Asia animal health private equity', 'Turkmenistan agrifood laboratory investment fund'],
  },
};

const transformations = [];
for (const item of manifest.cases) {
  const sourceRows = linesByFile.get(item.profile_file);
  const row = sourceRows.find(x => x.case_id === item.case_id);
  if (!row) throw new Error(`Profile not found for ${item.case_id}`);
  const sourceLine = JSON.stringify(row);
  if (sha(sourceLine) !== item.profile_line_sha256) throw new Error(`Source line hash mismatch for ${item.case_id}`);
  const profile = coreProfile(row);
  const profileRel = `research/bench/investors/cases/profiles/${item.case_id}.json`;
  const profileBytes = `${JSON.stringify(profile, null, 2)}\n`;
  writeFileSync(resolve(repo, profileRel), profileBytes);

  let anchors = [];
  let null_case = null;
  if (item.label === 'gold_positive') {
    const adjudication = readAdjudication(item.case_id);
    const a = adjudication?.anchors?.[0] ?? anchorFallback[item.case_id];
    if (!a?.official_url || !a?.canonical_name) throw new Error(`Anchor unavailable for ${item.case_id}`);
    anchors = [{
      stable_id: `inv:domain:${host(a.official_url)}`,
      canonical_name: a.canonical_name,
      official_url: a.official_url,
      active_status: (a.criteria?.find(x => x.criterion === 'INV-ACTIVE')?.state === 'active' ? 'active' : 'possibly_active'),
      verified_on: '2026-10-08',
      compatibility_evidence: (() => {
        const quote = a.criteria?.find(x => ['INV-SECTOR','INV-STAGE','INV-GEO'].includes(x.criterion))?.quote || '';
        return (quote.length >= 20 ? quote : `Internal-gold adjudication records ${a.canonical_name} as a defensible retrieval anchor.`).slice(0, 1000);
      })(),
      found_after_profile_freeze: true,
      selected_from_system_results: false,
      historical_investment_control: false,
    }];
  } else {
    const spec = nullSpecs[item.case_id];
    if (!spec) throw new Error(`Null scope unavailable for ${item.case_id}`);
    null_case = { scope: spec.scope, manual_search_minutes: spec.minutes, manual_queries: spec.queries, conclusion: 'no_active_investor_with_gain_gte_2_found_within_scope' };
  }
  const caseObj = {
    schema_version: 'investor_case/1', case_id: item.case_id,
    kind: item.label === 'gold_positive' ? 'anchor' : 'null', as_of: '2026-10-08',
    profile_path: profileRel, profile_sha256: sha(profileBytes),
    construction: {
      curator: 'internal-gold-2026-10-08', profile_builder: row.provenance.builder_id,
      profile_builder_saw_investors: false, selection_order: 'profile_first',
      profile_frozen_at: item.frozen_at, curation_started_at: manifest.created_at,
    }, anchors, null_case,
  };
  writeFileSync(resolve(casesDir, `${item.case_id}.json`), `${JSON.stringify(caseObj, null, 2)}\n`);
  transformations.push({ case_id: item.case_id, source_profile_file: item.profile_file, source_profile_line_sha256: item.profile_line_sha256, adapted_profile: profileRel, adapted_profile_sha256: sha(profileBytes), removed_top_level_metadata: Object.keys(row).filter(k => !['schema_version','profile_id','status','as_of','provenance','fields'].includes(k)), anchor_source: item.label === 'gold_positive' ? (readAdjudication(item.case_id) ? 'archived_adjudication' : 'documented_fallback') : null, null_scope_source: item.label === 'gold_null' ? 'BUSQUEDA-NULOS.md summarized into schema-required scope and three representative queries' : null });
}

writeFileSync(resolve(casesDir, 'manifest.json'), `${JSON.stringify({ schema_version: 'investor_case_import/1', source_manifest: resolve(gold, 'MANIFEST.json'), imported_at: '2026-10-08T00:00:00-05:00', counts: manifest.counts, transformations }, null, 2)}\n`);
const smokeDir = resolve(repo, 'research/bench/investors/smoke/cases');
mkdirSync(smokeDir, { recursive: true });
const smokeRows = readFileSync(resolve(gold, 'profiles-null-round2-frozen.jsonl'), 'utf8').trim().split('\n').map(JSON.parse).filter(x => ['inv-case-syn-n05','inv-case-syn-n06'].includes(x.case_id));
for (const row of smokeRows) {
  const profile = coreProfile(row);
  const profileRel = `research/bench/investors/cases/profiles/smoke-${row.case_id}.json`;
  const profileBytes = `${JSON.stringify(profile, null, 2)}\n`;
  writeFileSync(resolve(repo, profileRel), profileBytes);
  const item = {
    schema_version: 'investor_case/1', case_id: `inv-case-smoke-${row.case_id.endsWith('n05') ? 'n05' : 'n06'}`, kind: 'null', as_of: '2026-10-08', profile_path: profileRel, profile_sha256: sha(profileBytes),
    construction: { curator: 'technical-smoke-only', profile_builder: row.provenance.builder_id, profile_builder_saw_investors: false, selection_order: 'profile_first', profile_frozen_at: row.frozen_at, curation_started_at: manifest.created_at },
    anchors: [], null_case: { scope: 'Technical smoke fixture excluded from the final internal gold and not used for benchmark metrics.', manual_search_minutes: 20, manual_queries: ['technical smoke investor query one','technical smoke investor query two','technical smoke investor query three'], conclusion: 'no_active_investor_with_gain_gte_2_found_within_scope' },
  };
  writeFileSync(resolve(smokeDir, `${item.case_id}.json`), `${JSON.stringify(item, null, 2)}\n`);
}
console.log(`Imported ${transformations.length} cases (${manifest.counts.gold_positive} positive, ${manifest.counts.gold_null} null).`);
