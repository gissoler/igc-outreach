/**
 * Importa y valida etiquetas de adjudicación.
 * No completa campos ausentes ni decide desacuerdos.
 * Contratos: label/1 y columnas de adjudicación.
 */
import { createHash } from 'node:crypto';
import { readFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { validate } from '../agent/contracts.mjs';

const labelId = value => `lab-${createHash('sha256').update(value).digest('hex').slice(0, 12)}`;

function parseCsvLine(line) {
  const values = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index <= line.length; index++) {
    const char = line[index];
    if (char === '"' && line[index + 1] === '"') {
      current += '"';
      index++;
    } else if (char === '"') {
      quoted = !quoted;
    } else if ((char === ',' || index === line.length) && !quoted) {
      values.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  return values;
}

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const headers = parseCsvLine(lines.shift()).map(value => value.replace(/^"|"$/g, ''));
  return lines.map(line => {
    const values = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']));
  });
}

function parseCriteria(value) {
  return String(value || '').split(';').filter(Boolean).map(item => {
    const [criterionAndState, url, quote] = item.split('|');
    const [criterion_id, state] = criterionAndState.split('=');
    return {
      criterion_id,
      state,
      evidence_url: url || null,
      quote: quote || null,
    };
  });
}

function warnReplacements(outFile, labels) {
  if (!existsSync(outFile)) return;
  const prior = new Set(
    readFileSync(outFile, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(JSON.parse)
      .map(label => `${label.case_id}|${label.stable_id}|${label.role}`),
  );
  for (const label of labels) {
    const key = `${label.case_id}|${label.stable_id}|${label.role}`;
    if (prior.has(key)) {
      console.warn(`Replacing prior ${label.role} label for ${label.case_id}/${label.stable_id}`);
    }
  }
}

/**
 * Importa etiquetas y conserva la identidad opaca resuelta por la llave ciega.
 * Efectos: añade JSONL al archivo de etiquetas y advierte reemplazos.
 * @param {object} input Archivo, rol, anotador, llave ciega, salida y reloj.
 * @returns {object[]} Etiquetas validadas que se escribieron.
 */
export function importLabels({
  file,
  role,
  annotator,
  key,
  outFile,
  clock = () => new Date().toISOString(),
}) {
  const rows = extname(file) === '.json'
    ? JSON.parse(readFileSync(file, 'utf8'))
    : parseCsv(readFileSync(file, 'utf8'));
  const labels = [];
  for (const row of rows) {
    const identity = key[row.item_key];
    if (!identity) throw new Error(`Unknown item_key ${row.item_key}`);
    const now = clock();
    labels.push(validate('label', {
      schema_version: 'label/1',
      label_id: labelId(`${row.case_id}|${identity.stable_id}|${role}|${now}`),
      case_id: row.case_id,
      stable_id: identity.stable_id,
      role,
      annotator,
      labeled_at: now,
      status: row.status,
      deadline: row.deadline || null,
      identity_correct: row.identity_correct === ''
        ? null
        : String(row.identity_correct).toLowerCase() === 'true',
      scope: row.scope,
      hard_eligibility: row.hard_eligibility,
      route: row.route,
      criteria: parseCriteria(row.criteria_to_label),
      confidence: row.confidence,
      notes: row.notes || '',
    }));
  }
  warnReplacements(outFile, labels);
  mkdirSync(resolve(outFile, '..'), { recursive: true });
  appendFileSync(outFile, `${labels.map(label => JSON.stringify(label)).join('\n')}\n`);
  return labels;
}
