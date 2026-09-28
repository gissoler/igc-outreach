// Tablas de la capa de análisis en la misma base SQLite (node:sqlite).
// deals + deal_investors (índice por fondo y fecha), embeddings, extracciones (conjunto de entrenamiento),
// vehículos Form D, acercamientos (pilar B), fragmentos de voz (RAG) y reglas de elegibilidad.
export const ANALYSIS_SCHEMA = `
CREATE TABLE IF NOT EXISTS deals (
  id TEXT PRIMARY KEY, startup TEXT NOT NULL, startup_key TEXT NOT NULL, sector TEXT, country TEXT, stage TEXT,
  amount_usd INTEGER, date TEXT, date_basis TEXT, url TEXT NOT NULL, quote TEXT NOT NULL, extractor TEXT,
  retrieved_at TEXT, body TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS deals_date ON deals(date);
CREATE INDEX IF NOT EXISTS deals_startup ON deals(startup_key);
CREATE TABLE IF NOT EXISTS deal_investors (
  deal_id TEXT NOT NULL, fund_id TEXT NOT NULL, fund_name TEXT NOT NULL, role TEXT NOT NULL, date TEXT,
  PRIMARY KEY (deal_id, fund_id, role));
CREATE INDEX IF NOT EXISTS deal_investors_fund_date ON deal_investors(fund_id, date);
CREATE TABLE IF NOT EXISTS deal_embeddings (deal_id TEXT NOT NULL, model TEXT NOT NULL, vector TEXT NOT NULL, PRIMARY KEY (deal_id, model));
CREATE TABLE IF NOT EXISTS extractions (
  id TEXT PRIMARY KEY, url TEXT NOT NULL, text_hash TEXT NOT NULL, extractor TEXT NOT NULL, created_at TEXT NOT NULL,
  page TEXT NOT NULL, raw TEXT NOT NULL, verified TEXT NOT NULL, review TEXT, split TEXT);
CREATE TABLE IF NOT EXISTS fund_review (left_name TEXT, right_name TEXT, score REAL, decision TEXT, PRIMARY KEY (left_name, right_name));
CREATE TABLE IF NOT EXISTS outreach_events (
  id TEXT PRIMARY KEY, user_id TEXT, fund_id TEXT, fund_name TEXT NOT NULL, person TEXT, person_type TEXT, fund_type TEXT,
  channel TEXT NOT NULL, arguments TEXT NOT NULL, variant TEXT, sector TEXT, stage TEXT, sent_at TEXT NOT NULL,
  outcome TEXT NOT NULL, outcome_at TEXT, shared INTEGER NOT NULL DEFAULT 0, body TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS outreach_user ON outreach_events(user_id, sent_at);
CREATE INDEX IF NOT EXISTS outreach_fund ON outreach_events(fund_id);
CREATE TABLE IF NOT EXISTS judgments (id TEXT PRIMARY KEY, user_id TEXT, kind TEXT NOT NULL, query TEXT NOT NULL, item_id TEXT NOT NULL, item_text TEXT NOT NULL, label INTEGER NOT NULL, reason TEXT, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS voice_chunks (id TEXT PRIMARY KEY, person_key TEXT NOT NULL, person TEXT NOT NULL, url TEXT NOT NULL, title TEXT, published TEXT, kind TEXT, text TEXT NOT NULL, position TEXT, vector TEXT);
CREATE INDEX IF NOT EXISTS voice_person ON voice_chunks(person_key);
CREATE TABLE IF NOT EXISTS grant_evaluations (opportunity_id TEXT PRIMARY KEY, body TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS advisor_updates (id TEXT PRIMARY KEY, user_id TEXT, period TEXT NOT NULL, body TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS advisor_updates_user ON advisor_updates(user_id, period);
CREATE TABLE IF NOT EXISTS advisor_generations (
  id TEXT PRIMARY KEY, user_id TEXT, kind TEXT NOT NULL, model TEXT, system TEXT, input TEXT NOT NULL, output TEXT NOT NULL,
  final TEXT, label TEXT, created_at TEXT NOT NULL, reviewed_at TEXT);
CREATE TABLE IF NOT EXISTS agent_runs (id TEXT PRIMARY KEY, user_id TEXT, job_id TEXT, status TEXT NOT NULL, body TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS dossiers (id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL, user_id TEXT, job_id TEXT, body TEXT NOT NULL, created_at TEXT NOT NULL, feedback TEXT);
CREATE INDEX IF NOT EXISTS dossiers_key ON dossiers(user_id, key, created_at);
CREATE TABLE IF NOT EXISTS edge_judgments (id TEXT PRIMARY KEY, user_id TEXT, job_id TEXT, from_name TEXT, to_name TEXT, body TEXT NOT NULL, human TEXT, created_at TEXT NOT NULL);
`;

export function createAnalysisStore(db) {
  db.exec(ANALYSIS_SCHEMA);
  const upsertDeal = db.prepare(`INSERT OR REPLACE INTO deals VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const delInv = db.prepare('DELETE FROM deal_investors WHERE deal_id=?');
  const insInv = db.prepare('INSERT OR REPLACE INTO deal_investors VALUES (?,?,?,?,?)');
  return {
    saveDeal(d) {
      upsertDeal.run(d.id, d.startup, d.startupKey, d.sector, d.country, d.stage, d.amountUsd ?? null, d.date, d.dateBasis, d.url, d.quote, d.extractor, d.retrievedAt, JSON.stringify(d));
      delInv.run(d.id);
      for (const i of d.investors) if (i.fundId) insInv.run(d.id, i.fundId, i.name, i.role, d.date);
    },
    deal(id) { const r = db.prepare('SELECT body FROM deals WHERE id=?').get(id); return r ? JSON.parse(r.body) : null; },
    /** Deals con fecha estrictamente anterior a `before` (corte temporal del backtest). */
    deals({ before = null, since = null, excludeStartupKey = null } = {}) {
      const where = ['date IS NOT NULL'];
      const args = [];
      if (before) { where.push('date < ?'); args.push(before); }
      if (since) { where.push('date >= ?'); args.push(since); }
      if (excludeStartupKey) { where.push('startup_key <> ?'); args.push(excludeStartupKey); }
      return db.prepare(`SELECT body FROM deals WHERE ${where.join(' AND ')} ORDER BY date DESC`).all(...args).map((r) => JSON.parse(r.body));
    },
    dealsByFund(fundId, { before = null } = {}) {
      const rows = before
        ? db.prepare('SELECT d.body FROM deal_investors i JOIN deals d ON d.id=i.deal_id WHERE i.fund_id=? AND i.date < ? ORDER BY i.date DESC').all(fundId, before)
        : db.prepare('SELECT d.body FROM deal_investors i JOIN deals d ON d.id=i.deal_id WHERE i.fund_id=? ORDER BY i.date DESC').all(fundId);
      return rows.map((r) => JSON.parse(r.body));
    },
    dealCount() { return db.prepare('SELECT COUNT(*) n FROM deals').get().n; },
    fundCount() { return db.prepare('SELECT COUNT(DISTINCT fund_id) n FROM deal_investors').get().n; },
    saveEmbedding(dealId, model, vector) { db.prepare('INSERT OR REPLACE INTO deal_embeddings VALUES (?,?,?)').run(dealId, model, JSON.stringify(vector)); },
    embeddings(model) { return new Map(db.prepare('SELECT deal_id, vector FROM deal_embeddings WHERE model=?').all(model).map((r) => [r.deal_id, JSON.parse(r.vector)])); },
    saveExtraction(e) { db.prepare('INSERT OR REPLACE INTO extractions VALUES (?,?,?,?,?,?,?,?,?,?)').run(e.id, e.url, e.textHash, e.extractor, e.createdAt, JSON.stringify(e.page), JSON.stringify(e.raw), JSON.stringify(e.verified), e.review ? JSON.stringify(e.review) : null, e.split || null); },
    extractions({ extractor = null } = {}) {
      const rows = extractor ? db.prepare('SELECT * FROM extractions WHERE extractor=? ORDER BY created_at').all(extractor) : db.prepare('SELECT * FROM extractions ORDER BY created_at').all();
      return rows.map((r) => ({ id: r.id, url: r.url, textHash: r.text_hash, extractor: r.extractor, createdAt: r.created_at, page: JSON.parse(r.page), raw: JSON.parse(r.raw), verified: JSON.parse(r.verified), review: r.review ? JSON.parse(r.review) : null, split: r.split }));
    },
    saveReview(id, review) { db.prepare('UPDATE extractions SET review=? WHERE id=?').run(JSON.stringify(review), id); },
    setSplit(id, split) { db.prepare('UPDATE extractions SET split=? WHERE id=?').run(split, id); },
    saveFundReview(left, right, score) { db.prepare('INSERT OR IGNORE INTO fund_review VALUES (?,?,?,NULL)').run(left, right, score); },
    fundReviews() { return db.prepare('SELECT * FROM fund_review WHERE decision IS NULL ORDER BY score DESC').all(); },
    // Pilar B
    saveOutreach(e) { db.prepare('INSERT OR REPLACE INTO outreach_events VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(e.id, e.userId ?? null, e.fundId ?? null, e.fundName, e.person ?? null, e.personType ?? null, e.fundType ?? null, e.channel, JSON.stringify(e.arguments || []), e.variant ?? null, e.sector ?? null, e.stage ?? null, e.sentAt, e.outcome, e.outcomeAt ?? null, e.shared ? 1 : 0, JSON.stringify(e)); },
    outreach(id) { const r = db.prepare('SELECT body FROM outreach_events WHERE id=?').get(id); return r ? JSON.parse(r.body) : null; },
    outreachFor(userId) { return db.prepare('SELECT body FROM outreach_events WHERE user_id IS ? ORDER BY sent_at DESC').all(userId ?? null).map((r) => JSON.parse(r.body)); },
    sharedOutreach() { return db.prepare('SELECT body FROM outreach_events WHERE shared=1').all().map((r) => JSON.parse(r.body)); },
    deleteOutreachFor(userId) { db.prepare('DELETE FROM outreach_events WHERE user_id IS ?').run(userId ?? null); },
    saveJudgment(j) { db.prepare('INSERT OR REPLACE INTO judgments VALUES (?,?,?,?,?,?,?,?,?)').run(j.id, j.userId ?? null, j.kind, j.query, j.itemId, j.itemText, j.label, j.reason ?? null, j.at); },
    judgments(kind = null) { return (kind ? db.prepare('SELECT * FROM judgments WHERE kind=?').all(kind) : db.prepare('SELECT * FROM judgments').all()); },
    // Voz del decisor
    saveChunk(c) { db.prepare('INSERT OR REPLACE INTO voice_chunks VALUES (?,?,?,?,?,?,?,?,?,?)').run(c.id, c.personKey, c.person, c.url, c.title ?? null, c.published ?? null, c.kind ?? null, c.text, c.position ?? null, c.vector ? JSON.stringify(c.vector) : null); },
    chunks(personKey) { return db.prepare('SELECT * FROM voice_chunks WHERE person_key=?').all(personKey).map((r) => ({ ...r, personKey: r.person_key, vector: r.vector ? JSON.parse(r.vector) : null })); },
    voicePeople() { return db.prepare('SELECT person_key, person, COUNT(*) n, COUNT(DISTINCT url) sources FROM voice_chunks GROUP BY person_key').all(); },
    // Grants
    saveGrantEvaluation(id, body) { db.prepare('INSERT OR REPLACE INTO grant_evaluations VALUES (?,?,?)').run(id, JSON.stringify(body), new Date().toISOString()); },
    grantEvaluations() { return db.prepare('SELECT body FROM grant_evaluations ORDER BY updated_at DESC').all().map((r) => JSON.parse(r.body)); },
    // Agente asesor: updates del fundador y generaciones (conjunto de entrenamiento: aprobado / editado / rechazado)
    saveUpdate(u) { db.prepare('INSERT OR REPLACE INTO advisor_updates VALUES (?,?,?,?,?)').run(u.id, u.userId ?? null, u.period, JSON.stringify(u), u.updatedAt); },
    updates(userId) { return db.prepare('SELECT body FROM advisor_updates WHERE user_id IS ? ORDER BY period DESC, updated_at DESC').all(userId ?? null).map((r) => JSON.parse(r.body)); },
    update(id) { const r = db.prepare('SELECT body FROM advisor_updates WHERE id=?').get(id); return r ? JSON.parse(r.body) : null; },
    saveGeneration(g) { db.prepare('INSERT OR REPLACE INTO advisor_generations VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(g.id, g.userId ?? null, g.kind, g.model ?? null, g.system ?? null, g.input, g.output, g.final ?? null, g.label ?? null, g.createdAt, g.reviewedAt ?? null); },
    generation(id) { return db.prepare('SELECT * FROM advisor_generations WHERE id=?').get(id) || null; },
    reviewGeneration(id, { final = null, label }) { db.prepare('UPDATE advisor_generations SET final=?, label=?, reviewed_at=? WHERE id=?').run(final, label, new Date().toISOString(), id); },
    // Análisis profundo con la flota
    saveRun(r) { db.prepare('INSERT OR REPLACE INTO agent_runs VALUES (?,?,?,?,?,?)').run(r.id, r.userId ?? null, r.jobId ?? null, r.status, JSON.stringify(r), new Date().toISOString()); },
    run(id) { const r = db.prepare('SELECT body FROM agent_runs WHERE id=?').get(id); return r ? JSON.parse(r.body) : null; },
    latestRun(userId, jobId) { const r = db.prepare('SELECT body FROM agent_runs WHERE user_id IS ? AND job_id IS ? ORDER BY updated_at DESC LIMIT 1').get(userId ?? null, jobId ?? null); return r ? JSON.parse(r.body) : null; },
    saveDossier({ key, userId, jobId, body }) { db.prepare('INSERT INTO dossiers (key, user_id, job_id, body, created_at) VALUES (?,?,?,?,?)').run(key, userId ?? null, jobId ?? null, JSON.stringify(body), body.createdAt || new Date().toISOString()); },
    latestDossier(userId, key) { const r = db.prepare('SELECT body FROM dossiers WHERE user_id IS ? AND key=? ORDER BY created_at DESC LIMIT 1').get(userId ?? null, key); return r ? JSON.parse(r.body) : null; },
    dossierFeedback(userId, key, feedback) { const r = db.prepare('SELECT id FROM dossiers WHERE user_id IS ? AND key=? ORDER BY created_at DESC LIMIT 1').get(userId ?? null, key); if (!r) return false; db.prepare('UPDATE dossiers SET feedback=? WHERE id=?').run(JSON.stringify(feedback), r.id); return true; },
    saveEdgeJudgment(j) { db.prepare('INSERT OR REPLACE INTO edge_judgments VALUES (?,?,?,?,?,?,?,?)').run(j.id, j.userId ?? null, j.jobId ?? null, j.from, j.to, JSON.stringify(j), null, j.createdAt); },
    edgeJudgments(userId) { return db.prepare('SELECT * FROM edge_judgments WHERE user_id IS ? ORDER BY created_at DESC').all(userId ?? null).map((r) => ({ ...JSON.parse(r.body), human: r.human ? JSON.parse(r.human) : null })); },
    labelEdge(id, userId, human) { return db.prepare('UPDATE edge_judgments SET human=? WHERE id=? AND user_id IS ?').run(JSON.stringify(human), id, userId ?? null).changes > 0; },
    generations({ reviewed = false } = {}) { return db.prepare(`SELECT * FROM advisor_generations ${reviewed ? 'WHERE label IS NOT NULL' : ''} ORDER BY created_at`).all(); },
  };
}
