import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export function requestKey(url, init = {}) {
  const body = typeof init.body === 'string' ? init.body : init.body ? JSON.stringify(init.body) : '';
  const hash = createHash('sha256').update(body).digest('hex').slice(0, 16);
  return `${String(init.method || (body ? 'POST' : 'GET')).toUpperCase()} ${url} ${hash}`;
}

export function loadReplay(directory) {
  const records = new Map();
  for (const name of readdirSync(directory).filter((file) => file.endsWith('.json'))) {
    const parsed = JSON.parse(readFileSync(join(directory, name), 'utf8'));
    for (const row of Array.isArray(parsed) ? parsed : parsed.records || []) records.set(row.key || requestKey(row.url, row.init || { method: row.method, body: row.body }), row);
  }
  return records;
}

export function createReplayFetcher(directoryOrRecords) {
  const records = directoryOrRecords instanceof Map ? directoryOrRecords : loadReplay(directoryOrRecords);
  return async (url, init = {}) => {
    const key = requestKey(url, init);
    const row = records.get(key);
    if (!row) throw new Error(`Replay miss: ${key}`);
    const body = typeof row.response?.body === 'string' ? row.response.body : JSON.stringify(row.response?.body ?? row.body ?? {});
    return new Response(body, { status: row.response?.status || row.status || 200, headers: row.response?.headers || row.headers || { 'content-type': 'application/json' } });
  };
}

