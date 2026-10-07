import { DatabaseSync } from 'node:sqlite';

export function createBenchCache({ path = ':memory:', namespace }) {
  const db = new DatabaseSync(path);
  db.exec('CREATE TABLE IF NOT EXISTS entries(namespace TEXT, kind TEXT, key TEXT, value_json TEXT, meta_json TEXT, created_at TEXT, PRIMARY KEY(namespace,kind,key))');
  const getStmt = db.prepare('SELECT value_json, meta_json FROM entries WHERE namespace=? AND kind=? AND key=?');
  const putStmt = db.prepare('INSERT INTO entries(namespace,kind,key,value_json,meta_json,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(namespace,kind,key) DO UPDATE SET value_json=excluded.value_json, meta_json=excluded.meta_json');
  return {
    get(kind, key) { const row = getStmt.get(namespace, kind, key); return row ? { value: JSON.parse(row.value_json), meta: JSON.parse(row.meta_json) } : null; },
    put(kind, key, value, meta = {}) { putStmt.run(namespace, kind, key, JSON.stringify(value), JSON.stringify(meta), new Date().toISOString()); },
    close() { db.close(); },
  };
}
