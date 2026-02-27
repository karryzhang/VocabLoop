/**
 * api/db.js — Database layer for VocabLoop
 *
 * Uses @libsql/client for both remote (Turso) and local (file-based SQLite):
 *   - Production (Vercel): Set TURSO_DATABASE_URL + TURSO_AUTH_TOKEN env vars
 *   - Local dev:           Falls back to file:/tmp/vocabloop.db (writable on all platforms)
 *
 * Tables: config, users, sync_data
 */

const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');

/* ── Client initialisation (lazy, fail-safe) ─────────────────────────── */

let client = null;
let _clientError = null;

function getClient() {
  if (_clientError) throw _clientError;
  if (client) return client;

  try {
    const { createClient } = require('@libsql/client');

    if (process.env.TURSO_DATABASE_URL) {
      // Production: remote Turso DB (pure HTTP, no native modules needed)
      client = createClient({
        url:       process.env.TURSO_DATABASE_URL,
        authToken: process.env.TURSO_AUTH_TOKEN,
      });
    } else if (process.env.VERCEL) {
      // Running on Vercel but TURSO_DATABASE_URL not configured — fail clearly
      throw new Error('TURSO_DATABASE_URL environment variable is not set. Configure it in the Vercel dashboard.');
    } else {
      // Local dev: use /tmp which is writable on all platforms
      const dbPath = path.join('/tmp', 'vocabloop.db');
      client = createClient({ url: `file:${dbPath}` });
      console.log('[db] No TURSO_DATABASE_URL set — using local SQLite at', dbPath);
    }
  } catch (err) {
    _clientError = err;
    console.error('[db] Failed to initialise database client:', err.message);
    throw err;
  }

  return client;
}

let _initialized = false;

/** Ensure tables exist (runs once per cold start) */
async function initDb() {
  if (_initialized) return;
  await getClient().batch([
    `CREATE TABLE IF NOT EXISTS config (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS users (
      username   TEXT PRIMARY KEY COLLATE NOCASE,
      salt       TEXT NOT NULL DEFAULT '',
      hash       TEXT NOT NULL DEFAULT '',
      google_sub TEXT,
      created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS sync_data (
      username   TEXT PRIMARY KEY,
      data       TEXT NOT NULL DEFAULT '{}',
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (username) REFERENCES users(username)
    )`,
  ], 'write');
  // Migration: add google_sub to existing databases (no-op if already present)
  try {
    await getClient().execute('ALTER TABLE users ADD COLUMN google_sub TEXT');
  } catch (_) { /* column already exists — ignore */ }
  _initialized = true;
}

/** Execute a read query — returns first row or null */
async function queryOne(sql, args = []) {
  await initDb();
  const result = await getClient().execute({ sql, args });
  return result.rows[0] || null;
}

/** Execute a write statement (INSERT / UPDATE / DELETE) */
async function execute(sql, args = []) {
  await initDb();
  return getClient().execute({ sql, args });
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
