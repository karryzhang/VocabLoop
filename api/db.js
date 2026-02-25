/**
 * api/db.js — Shared SQLite database for VocabLoop
 *
 * Two tables:
 *   users     — username, salt, hash, createdAt
 *   sync_data — username (PK), data (JSON text), updatedAt
 *
 * Database file: .data/vocabloop.db  (gitignored)
 */

const path = require('path');
const fs   = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, '..', '.data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'vocabloop.db');

let _db;
function getDb() {
  if (_db) return _db;
  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');

  _db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      username   TEXT PRIMARY KEY,
      salt       TEXT NOT NULL,
      hash       TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sync_data (
      username   TEXT PRIMARY KEY,
      data       TEXT NOT NULL DEFAULT '{}',
      updated_at INTEGER NOT NULL
    );
  `);
  return _db;
}

module.exports = { getDb };
