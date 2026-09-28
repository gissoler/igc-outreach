import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { norm } from './core.mjs';
import { createAnalysisStore } from '../analysis/analysisStore.mjs';
export const scope = (b, userId = null) =>
  [userId ? `user:${userId}` : 'anonymous', norm(b.name), norm(b.company), norm(b.product), b.dataMode].join('|');
const networkOwner = (name, company, userId = null) =>
  userId ? `user:${userId}` : `${norm(name)}|${norm(company)}`;
export function createStore(path) {
  if (path !== ':memory:')
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, body TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS feedback (scope TEXT, lead_key TEXT, body TEXT, PRIMARY KEY(scope,lead_key));
    CREATE TABLE IF NOT EXISTS sources (id INTEGER PRIMARY KEY, job_id TEXT, url TEXT, fetched_at TEXT, body TEXT);
    CREATE TABLE IF NOT EXISTS networks (owner TEXT PRIMARY KEY, body TEXT);
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, password_salt TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS account_profiles (user_id TEXT PRIMARY KEY, body TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS account_sources (user_id TEXT NOT NULL, source TEXT NOT NULL, body TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(user_id,source));
    CREATE TABLE IF NOT EXISTS intake_sessions (user_id TEXT PRIMARY KEY, body TEXT NOT NULL);`);
  const store = {
    analysis: createAnalysisStore(db),
    save(job) {
      db.prepare('INSERT OR REPLACE INTO jobs VALUES (?,?)').run(
        job.id,
        JSON.stringify(job),
      );
    },
    get(id) {
      const row = db.prepare('SELECT body FROM jobs WHERE id=?').get(id);
      return row ? JSON.parse(row.body) : null;
    },
    list(userId = null) {
      return db
        .prepare('SELECT body FROM jobs ORDER BY rowid DESC LIMIT 30')
        .all()
        .map((r) => JSON.parse(r.body))
        .filter((j) => userId ? j.userId === userId : !j.userId)
        .map((j) => ({
          id: j.id,
          name: j.brief.name,
          product: j.brief.product,
          status: j.status,
          mode: j.mode,
          createdAt: j.createdAt,
          // Campos aditivos para el selector de evaluaciones del frontend.
          company: j.brief.company,
          venture: j.brief.venture || '',
          finishedAt: j.finishedAt || null,
          leads: j.leads?.length || 0,
          top: j.leads?.filter((l) => l.bucket === 'top').length || 0,
        }));
    },
    source(jobId, url, data) {
      db.prepare(
        'INSERT INTO sources(job_id,url,fetched_at,body) VALUES (?,?,?,?)',
      ).run(jobId, url, new Date().toISOString(), JSON.stringify(data));
    },
    feedback(brief, key, value, userId = null) {
      db.prepare('INSERT OR REPLACE INTO feedback VALUES (?,?,?)').run(
        scope(brief, userId),
        key,
        JSON.stringify(value),
      );
    },
    feedbackFor(brief, userId = null) {
      return new Map(
        db
          .prepare('SELECT lead_key,body FROM feedback WHERE scope=?')
          .all(scope(brief, userId))
          .map((r) => [r.lead_key, JSON.parse(r.body)]),
      );
    },
    network(brief, userId = null) {
      const r = db
        .prepare('SELECT body FROM networks WHERE owner=?')
        .get(networkOwner(brief.name, brief.company, userId));
      return r ? JSON.parse(r.body) : [];
    },
    networkInfo(name, company, userId = null) {
      const r = db
        .prepare('SELECT body FROM networks WHERE owner=?')
        .get(networkOwner(name, company, userId));
      const rows = r ? JSON.parse(r.body) : [];
      return { connected: rows.length > 0, count: rows.length };
    },
    saveNetwork(name, company, rows, userId = null) {
      db.prepare('INSERT OR REPLACE INTO networks VALUES (?,?)').run(
        networkOwner(name, company, userId),
        JSON.stringify(rows),
      );
    },
    deleteNetwork(name, company, userId = null) {
      db.prepare('DELETE FROM networks WHERE owner=?').run(
        networkOwner(name, company, userId),
      );
    },
    createUser(user) {
      db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?)').run(
        user.id, user.email, user.name, user.passwordSalt, user.passwordHash, user.createdAt,
      );
    },
    userByEmail(email) {
      return db.prepare('SELECT * FROM users WHERE email=?').get(email) || null;
    },
    userById(id) {
      return db.prepare('SELECT id,email,name,created_at FROM users WHERE id=?').get(id) || null;
    },
    saveSession(tokenHash, userId, expiresAt) {
      db.prepare('INSERT OR REPLACE INTO sessions VALUES (?,?,?)').run(tokenHash, userId, expiresAt);
    },
    session(tokenHash, now = new Date().toISOString()) {
      return db.prepare('SELECT user_id FROM sessions WHERE token_hash=? AND expires_at>?').get(tokenHash, now) || null;
    },
    deleteSession(tokenHash) {
      db.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenHash);
    },
    profile(userId) {
      const row = db.prepare('SELECT body FROM account_profiles WHERE user_id=?').get(userId);
      return row ? JSON.parse(row.body) : null;
    },
    saveProfile(userId, profile) {
      db.prepare('INSERT OR REPLACE INTO account_profiles VALUES (?,?)').run(userId, JSON.stringify(profile));
    },
    accountSources(userId) {
      return db.prepare('SELECT source,body,updated_at FROM account_sources WHERE user_id=? ORDER BY source').all(userId).map((row) => {
        const rows = JSON.parse(row.body);
        return { source: row.source, count: rows.length, updatedAt: row.updated_at };
      });
    },
    sourceRows(userId) {
      return db.prepare('SELECT body FROM account_sources WHERE user_id=?').all(userId).flatMap((row) => JSON.parse(row.body));
    },
    saveAccountSource(userId, source, rows) {
      db.prepare('INSERT OR REPLACE INTO account_sources VALUES (?,?,?,?)').run(userId, source, JSON.stringify(rows), new Date().toISOString());
    },
    deleteAccountSource(userId, source) {
      db.prepare('DELETE FROM account_sources WHERE user_id=? AND source=?').run(userId, source);
    },
    intake(userId) {
      const row = db.prepare('SELECT body FROM intake_sessions WHERE user_id=?').get(userId);
      return row ? JSON.parse(row.body) : null;
    },
    saveIntake(userId, session) {
      db.prepare('INSERT OR REPLACE INTO intake_sessions VALUES (?,?)').run(userId, JSON.stringify(session));
    },
    deleteIntake(userId) {
      db.prepare('DELETE FROM intake_sessions WHERE user_id=?').run(userId);
    },
    close() {
      db.close();
    },
  };
  for (const row of db.prepare('SELECT body FROM jobs').all()) {
    const job = JSON.parse(row.body);
    if (['queued', 'running'].includes(job.status)) {
      job.status = 'failed';
      job.events.push({
        phase: 'error',
        at: new Date().toISOString(),
        message: 'The server restarted. Run the research again.',
      });
      if (job.run?.events) {
        const sequence = job.run.events.at(-1)?.sequence || 0;
        const at = new Date().toISOString();
        job.run.events.push(
          { id: `${job.id}:${sequence + 1}`, sequence: sequence + 1, at, phase: 'error', status: 'error', title: 'Server restarted', message: 'The server restarted during the run. Run it again.' },
          { id: `${job.id}:${sequence + 2}`, sequence: sequence + 2, at, phase: 'completed', status: 'error', title: 'Stopped', message: 'Research stopped before finishing.', detail: { jobStatus: 'failed' } },
        );
      }
      store.save(job);
    }
  }
  return store;
}
