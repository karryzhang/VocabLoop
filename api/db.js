/**
 * api/db.js — Shared SQLite database for VocabLoop
 *
 * Tables:
 *   users     — username, salt, hash, created_at
 *   sync_data — username (FK → users), data (JSON text), updated_at
 *   config    — key-value store for server config (e.g. token signing secret)
 *
 * Database file: .data/vocabloop.db  (gitignored)
 */

const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');
const Database = require('better-sqlite3');

// Vercel serverless: project dir is read-only, only /tmp is writable
const DATA_DIR = process.env.VERCEL
  ? '/tmp'
  : path.join(__dirname, '..', '.data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'vocabloop.db');

let _db;
const _stmts = {};

function getDb() {
  if (_db) return _db;
  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');

  _db.exec(`
    CREATE TABLE IF NOT EXISTS config (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS users (
      username   TEXT PRIMARY KEY COLLATE NOCASE,
      salt       TEXT NOT NULL,
      hash       TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sync_data (
      username   TEXT PRIMARY KEY,
      data       TEXT NOT NULL DEFAULT '{}',
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (username) REFERENCES users(username)
    );
  `);

  return _db;
}

/** Cached prepared statement — avoids re-parsing SQL on every request */
function stmt(sql) {
  if (!_stmts[sql]) {
    _stmts[sql] = getDb().prepare(sql);
  }
  return _stmts[sql];
}

/** Get or create the HMAC signing secret (persisted in config table) */
function getSecret() {
  const db = getDb();
  const row = stmt('SELECT value FROM config WHERE key = ?').get('token_secret');
  if (row) return row.value;
  const secret = crypto.randomBytes(48).toString('hex');
  stmt('INSERT INTO config (key, value) VALUES (?, ?)').run('token_secret', secret);
  return secret;
}

/** Graceful shutdown — close DB on process exit */
function closeDb() {
  if (_db) {
    try { _db.close(); } catch (_) {}
    _db = null;
  }
}
process.on('exit', closeDb);
process.on('SIGINT',  () => { closeDb(); process.exit(0); });
process.on('SIGTERM', () => { closeDb(); process.exit(0); });

module.exports = { getDb, stmt, getSecret, closeDb };
