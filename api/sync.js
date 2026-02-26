/**
 * api/sync.js — Cloud sync endpoint for VocabLoop learning data
 *
 * Actions:
 *   push  — Upload local learning data to cloud (overwrites cloud copy)
 *   pull  — Download cloud data to client
 *   merge — Two-way merge: client sends local data, server merges and returns result
 *
 * Auth: HMAC-signed token (see token.js)
 * Storage: Turso (libSQL) via api/db.js
 */

const { queryOne, execute } = require('./db');
const { verifyToken } = require('./token');

/* ── Merge helpers ─────────────────────────────────────────────────── */

/** Merge two SRS deck state objects at the per-word level. */
function mergeWordStates(local, cloud) {
  if (!local) return cloud || {};
  if (!cloud) return local;

  const localState = local.state || {};
  const cloudState = cloud.state || {};
  const merged = {};

  const allWords = new Set([...Object.keys(localState), ...Object.keys(cloudState)]);
  for (const word of allWords) {
    const l = localState[word];
    const c = cloudState[word];
    if (!l) { merged[word] = c; continue; }
    if (!c) { merged[word] = l; continue; }
    merged[word] = (l.next || 0) >= (c.next || 0) ? l : c;
  }

  return {
    state:    merged,
    points:   Math.max(local.points || 0, cloud.points || 0),
    streak:   Math.max(local.streak || 0, cloud.streak || 0),
    autoPlay: local.autoPlay !== undefined ? local.autoPlay : cloud.autoPlay,
  };
}

/** Merge global state (streaks, achievements, totalReviewed). */
function mergeGlobal(local, cloud) {
  if (!local) return cloud || {};
  if (!cloud) return local;
  return {
    dailyStreak:   Math.max(local.dailyStreak || 0, cloud.dailyStreak || 0),
    lastStudyDate: (local.lastStudyDate || '') >= (cloud.lastStudyDate || '') ? local.lastStudyDate : cloud.lastStudyDate,
    totalReviewed: Math.max(local.totalReviewed || 0, cloud.totalReviewed || 0),
    achievements:  [...new Set([...(local.achievements || []), ...(cloud.achievements || [])])],
  };
}

/** Full merge of all sync data: decks + global + preferences. */
function mergeAll(local, cloud) {
  const result = { decks: {}, global: {}, preferredDeck: '', readingHistory: [] };

  const allDeckIds = new Set([
    ...Object.keys(local.decks || {}),
    ...Object.keys(cloud.decks || {}),
  ]);
  for (const id of allDeckIds) {
    result.decks[id] = mergeWordStates(
      (local.decks || {})[id],
      (cloud.decks || {})[id]
    );
  }

  result.global = mergeGlobal(local.global, cloud.global);
  result.preferredDeck = local.preferredDeck || cloud.preferredDeck || '';

  // Reading history: union, deduplicate, cap at 50
  const localHist  = Array.isArray(local.readingHistory)  ? local.readingHistory  : [];
  const cloudHist  = Array.isArray(cloud.readingHistory)  ? cloud.readingHistory  : [];
  const seen = new Set();
  const merged = [];
  for (const item of [...localHist, ...cloudHist]) {
    const key = typeof item === 'object' ? JSON.stringify(item) : String(item);
    if (!seen.has(key)) { seen.add(key); merged.push(item); }
  }
  result.readingHistory = merged.slice(-50);

  return result;
}

/* ── Handler ──────────────────────────────────────────────────────── */

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, message: 'Method not allowed' });
  }

  try {
    const { action, token, data } = req.body || {};
    const username = await verifyToken(token);

    if (!username) {
      return res.status(401).json({ ok: false, message: 'Invalid or expired token.' });
    }

    // Verify user actually exists in DB
    const userExists = await queryOne('SELECT 1 FROM users WHERE username = ?', [username]);
    if (!userExists) {
      return res.status(401).json({ ok: false, message: 'User not found.' });
    }

    // ── PUSH ──────────────────────────────────────────────────────────
    if (action === 'push') {
      if (!data || typeof data !== 'object') {
        return res.status(400).json({ ok: false, message: 'Missing data payload.' });
      }
      const now = Date.now();
      await execute('INSERT OR REPLACE INTO sync_data (username, data, updated_at) VALUES (?, ?, ?)', [username, JSON.stringify(data), now]);
      return res.status(200).json({ ok: true, message: 'Data saved.', updatedAt: now });
    }

    // ── PULL ──────────────────────────────────────────────────────────
    if (action === 'pull') {
      const record = await queryOne('SELECT data, updated_at FROM sync_data WHERE username = ?', [username]);
      if (!record) {
        return res.status(200).json({ ok: true, data: null, message: 'No cloud data found.' });
      }
      return res.status(200).json({ ok: true, data: JSON.parse(record.data), updatedAt: record.updated_at });
    }

    // ── MERGE ─────────────────────────────────────────────────────────
    if (action === 'merge') {
      if (!data || typeof data !== 'object') {
        return res.status(400).json({ ok: false, message: 'Missing data payload.' });
      }
      const record = await queryOne('SELECT data FROM sync_data WHERE username = ?', [username]);
      const cloudData = record ? JSON.parse(record.data) : {};
      const merged = mergeAll(data, cloudData);
      const now = Date.now();
      await execute('INSERT OR REPLACE INTO sync_data (username, data, updated_at) VALUES (?, ?, ?)', [username, JSON.stringify(merged), now]);
      return res.status(200).json({ ok: true, data: merged, updatedAt: now, message: 'Merged successfully.' });
    }

    return res.status(400).json({ ok: false, message: 'Unsupported action. Use push, pull, or merge.' });
  } catch (err) {
    console.error('[sync] Error:', err);
    const msg = (err.message && err.message.includes('TURSO_DATABASE_URL'))
      ? 'Backend database not configured. Contact the administrator.'
      : 'Internal server error.';
    return res.status(500).json({ ok: false, message: msg });
  }
};
