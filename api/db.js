/**
 * api/db.js — Database layer for VocabLoop
 *
 * Uses @libsql/client for both remote (Turso) and local (file-based SQLite):
 *   - Production (Vercel): Set TURSO_DATABASE_URL + TURSO_AUTH_TOKEN env vars
 *   - Local dev:           Falls back to file:.data/vocabloop.db
 *
 * Tables: config, users, sync_data
 */

const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');
const { createClient } = require('@libsql/client');

// Local dev: ensure .data/ directory exists for SQLite file
if (!process.env.TURSO_DATABASE_URL) {
  const dataDir = path.join(__dirname, '..', '.data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
}

const client = createClient(
  process.env.TURSO_DATABASE_URL
    ? { url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN }
    : { url: `file:${path.join(__dirname, '..', '.data', 'vocabloop.db')}` }
);

let _initialized = false;

/** Ensure tables exist (runs once per cold start) */
async function initDb() {
  if (_initialized) return;
  await client.batch([
    `CREATE TABLE IF NOT EXISTS config (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS users (
      username   TEXT PRIMARY KEY COLLATE NOCASE,
      salt       TEXT NOT NULL,
      hash       TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS sync_data (
      username   TEXT PRIMARY KEY,
      data       TEXT NOT NULL DEFAULT '{}',
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (username) REFERENCES users(username)
    )`,
  ], 'write');
  _initialized = true;
}

/** Execute a read query — returns first row or null */
async function queryOne(sql, args = []) {
  await initDb();
  const result = await client.execute({ sql, args });
  return result.rows[0] || null;
}

/** Execute a write statement (INSERT / UPDATE / DELETE) */
async function execute(sql, args = []) {
  await initDb();
  return client.execute({ sql, args });
}

/** Get or create the HMAC signing secret */
async function getSecret() {
  const row = await queryOne('SELECT value FROM config WHERE key = ?', ['token_secret']);
  if (row) return row.value;
  const secret = crypto.randomBytes(48).toString('hex');
  await execute('INSERT INTO config (key, value) VALUES (?, ?)', ['token_secret', secret]);
  return secret;
}

module.exports = { queryOne, execute, getSecret };
