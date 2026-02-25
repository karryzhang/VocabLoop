const crypto = require('crypto');
const { stmt } = require('./db');
const { createToken } = require('./token');

/* ── Input validation ──────────────────────────────────────────────────── */

const USERNAME_RE = /^[a-zA-Z0-9_\u4e00-\u9fff]+$/; // alphanumeric, underscore, CJK

function normalizeUsername(input = '') {
  return String(input).trim().toLowerCase();
}
function validateUsername(u) {
  return typeof u === 'string' && u.length >= 5 && u.length <= 30 && USERNAME_RE.test(u);
}
function validatePassword(p) {
  return typeof p === 'string' && /^\d{6,20}$/.test(p);
}

/* ── Password hashing (PBKDF2-SHA512, 120k iterations) ─────────────── */

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(password, salt, 120000, 64, 'sha512').toString('hex');
  return { salt, hash };
}
function verifyPassword(password, salt, storedHash) {
  const { hash } = hashPassword(password, salt);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(storedHash, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/* ── Rate limiting (in-memory sliding window per IP) ──────────────── */

const _attempts = new Map();   // ip → [timestamp, ...]
const RATE_WINDOW  = 15 * 60 * 1000; // 15 minutes
const RATE_MAX     = 20;              // max attempts per window

function isRateLimited(ip) {
  const now = Date.now();
  let hits = _attempts.get(ip) || [];
  hits = hits.filter(t => now - t < RATE_WINDOW);
  _attempts.set(ip, hits);
  if (hits.length >= RATE_MAX) return true;
  hits.push(now);
  return false;
}

// Periodically clean old entries to prevent memory leak
setInterval(() => {
  const now = Date.now();
  for (const [ip, hits] of _attempts) {
    const fresh = hits.filter(t => now - t < RATE_WINDOW);
    if (fresh.length === 0) _attempts.delete(ip);
    else _attempts.set(ip, fresh);
  }
}, 5 * 60 * 1000);

/* ── Handler ──────────────────────────────────────────────────────── */

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, message: 'Method not allowed' });
  }

  try {
    const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
    if (isRateLimited(ip)) {
      return res.status(429).json({ ok: false, message: 'Too many requests. Please try again later.' });
    }

    const { action, username, password } = req.body || {};
    const u = normalizeUsername(username);

    if (action === 'register') {
      if (!validateUsername(u)) {
        return res.status(400).json({ ok: false, message: 'Username must be 5–30 characters (letters, digits, underscore).' });
      }
      if (!validatePassword(password)) {
        return res.status(400).json({ ok: false, message: 'Password must be 6–20 digits.' });
      }

      const existing = stmt('SELECT 1 FROM users WHERE username = ?').get(u);
      if (existing) {
        return res.status(409).json({ ok: false, message: 'Username already exists.' });
      }

      const { salt, hash } = hashPassword(password);
      stmt('INSERT INTO users (username, salt, hash, created_at) VALUES (?, ?, ?, ?)').run(u, salt, hash, Date.now());

      return res.status(200).json({ ok: true, message: 'Registered successfully.', user: { username: u }, token: createToken(u) });
    }

    if (action === 'login') {
      if (!u || !password) {
        return res.status(400).json({ ok: false, message: 'Username and password are required.' });
      }

      const user = stmt('SELECT salt, hash FROM users WHERE username = ?').get(u);
      if (!user || !verifyPassword(password, user.salt, user.hash)) {
        return res.status(401).json({ ok: false, message: 'Invalid credentials.' });
      }

      return res.status(200).json({ ok: true, message: 'Login successful.', user: { username: u }, token: createToken(u) });
    }

    return res.status(400).json({ ok: false, message: 'Unsupported action. Use register or login.' });
  } catch (err) {
    console.error('[auth] Error:', err);
    return res.status(500).json({ ok: false, message: 'Internal server error.' });
  }
};
