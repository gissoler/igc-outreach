/** Registro append-only de una corrida V14 y archivo del texto exacto de cada página. */
import Ajv from 'ajv';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const schemaPath = fileURLToPath(new URL('../../eval/v14/events.schema.json', import.meta.url));
const noop = Object.freeze({
  event: () => null,
  page: () => ({ ref: null, sha256: null, path: null }),
  summary: () => ({ events: 0, pages: 0 }),
  close: () => ({ events: 0, pages: 0 }),
});

const isoOf = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString();
};

export function createTrace(options) {
  if (!options?.dir) return noop;
  const { dir, runId, objective = '-', clock = () => new Date() } = options;
  const root = resolve(dir); const pagesDir = join(root, 'pages'); const eventsPath = join(root, 'events.jsonl');
  mkdirSync(pagesDir, { recursive: true });
  const started = clock(); const startedMs = new Date(started).getTime();
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
  const validate = new Ajv({ allErrors: true, strict: false }).compile(schema);
  let seq = 0; let pageSeq = 0; let closed = false;
  const pageHashes = new Set();

  const event = (type, data = {}) => {
    if (closed) throw new Error('TRACE_CLOSED');
    const now = clock();
    const row = {
      v: 'trace/1', run_id: String(runId), seq, ts: isoOf(now),
      ms: Math.max(0, Math.round(new Date(now).getTime() - startedMs)), objective, type, ...data,
    };
    if (!validate(row)) {
      const err = new Error(`TRACE_INVALID ${JSON.stringify(validate.errors || [])}`);
      err.code = 'TRACE_INVALID'; throw err;
    }
    mkdirSync(dirname(eventsPath), { recursive: true });
    appendFileSync(eventsPath, `${JSON.stringify(row)}\n`, 'utf8'); seq += 1;
    return row;
  };

  const page = ({ url, title = '', text = '', via = '', found_by = { tool: 'search' }, read = true, ref = null }) => {
    const body = String(text ?? '');
    const sha256 = createHash('sha256').update(body).digest('hex');
    const path = join(pagesDir, `${sha256}.txt`);
    if (!pageHashes.has(sha256)) { writeFileSync(path, body, 'utf8'); pageHashes.add(sha256); }
    const pageRef = ref || `p${pageSeq++}`;
    event('page', {
      ref: pageRef, url: String(url), host: new URL(String(url)).hostname, title: String(title), via: String(via),
      chars: body.length, sha256, path: relative(root, path), found_by, read: Boolean(read),
    });
    return { ref: pageRef, sha256, path };
  };

  const summary = () => ({ events: seq, pages: pageHashes.size, path: eventsPath });
  const close = () => { const out = summary(); closed = true; return out; };
  return { event, page, summary, close };
}
