import { readFileSync } from 'node:fs';
import { validateInvestor } from './contracts.mjs';

export function parseCsv(text) {
  const rows = []; let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) { const c = text[i]; if (quoted) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c; } else if (c === '"') quoted = true; else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\n') { row.push(cell); if (row.some(Boolean)) rows.push(row); row = []; cell = ''; } else if (c !== '\r') cell += c; }
  if (cell || row.length) { row.push(cell); rows.push(row); } const [headers, ...data] = rows; return data.map(values => Object.fromEntries(headers.map((h, i) => [h, values[i] ?? ''])));
}

export function importInvestorLabels({ csvText, key, role, annotator }) {
  return parseCsv(csvText).map(row => {
    const identity = key[row.item_key]; if (!identity) throw new Error(`Unknown item_key ${row.item_key}`);
    const evidence = row.evidence_json ? JSON.parse(row.evidence_json) : [];
    const criteria = evidence.filter(x => x.criterion_id && x.state).map(x => ({ criterion_id: x.criterion_id, state: x.state }));
    const label = { schema_version: 'investor_label/1', ...identity, role, annotator, identity_correct: row.identity_correct === '' ? null : row.identity_correct === 'true', entity_kind: row.entity_kind, active_status: row.active_status, sector_fit: row.sector_fit, stage_fit: row.stage_fit, geography_fit: row.geography_fit, check_fit: row.check_fit, round_fit: row.round_fit, business_model_fit: row.business_model_fit, lead_fit: row.lead_fit, hard_eligibility: row.hard_eligibility, portfolio_conflict: row.portfolio_conflict, overall_relevance: row.overall_relevance, confidence: row.confidence, criteria, evidence: evidence.filter(x => x.url && x.quote).map(({ criterion_id, url, quote, retrieved_on }) => ({ criterion_id, url, quote, retrieved_on })), labeled_on: row.labeled_on, notes: row.notes };
    return validateInvestor('investor_label', label);
  });
}

export const importInvestorLabelsFile = args => importInvestorLabels({ ...args, csvText: readFileSync(args.file, 'utf8') });
