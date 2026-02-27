const crypto = require('crypto');
const { queryOne, execute } = require('./db');
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
  return typeof p === 'string' && p.length >= 6 && p.length <= 128;
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

    const { action, username, password, idToken } = req.body || {};
    const u = normalizeUsername(username);

    // Health-check probe — does a real DB query to confirm backend is fully operational
    if (action === 'ping') {
      await queryOne('SELECT 1');
      return res.status(200).json({ ok: true, message: 'pong' });
    }

    if (action === 'register') {
      if (!validateUsername(u)) {
        return res.status(400).json({ ok: false, message: 'Username must be 5–30 characters (letters, digits, underscore).' });
      }
      if (!validatePassword(password)) {
        return res.status(400).json({ ok: false, message: 'Password must be 6–128 characters.' });
      }

      const existing = await queryOne('SELECT 1 FROM users WHERE username = ?', [u]);
      if (existing) {
        return res.status(409).json({ ok: false, message: 'Username already exists.' });
      }

      const { salt, hash } = hashPassword(password);
      await execute('INSERT INTO users (username, salt, hash, created_at) VALUES (?, ?, ?, ?)', [u, salt, hash, Date.now()]);

      return res.status(200).json({ ok: true, message: 'Registered successfully.', user: { username: u }, token: await createToken(u) });
    }

    if (action === 'login') {
      if (!u || !password) {
        return res.status(400).json({ ok: false, message: 'Username and password are required.' });
      }

      const user = await queryOne('SELECT salt, hash FROM users WHERE username = ?', [u]);
      if (!user || !verifyPassword(password, user.salt, user.hash)) {
        return res.status(401).json({ ok: false, message: 'Invalid credentials.' });
      }

      return res.status(200).json({ ok: true, message: 'Login successful.', user: { username: u }, token: await createToken(u) });
    }

    if (action === 'google') {
      if (!idToken) {
        return res.status(400).json({ ok: false, message: 'Missing Google ID token.' });
      }

      // Verify the ID token via Google's tokeninfo endpoint (no extra npm package needed)
      const googleRes = await fetch(
        `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`
      );
      if (!googleRes.ok) {
        return res.status(401).json({ ok: false, message: 'Invalid Google token.' });
      }
      const payload = await googleRes.json();

      // Validate that the token was issued for our app
      const expectedAud = process.env.GOOGLE_CLIENT_ID;
      if (expectedAud && payload.aud !== expectedAud) {
        return res.status(401).json({ ok: false, message: 'Token audience mismatch.' });
      }

      const googleSub = payload.sub;
      if (!googleSub) {
        return res.status(401).json({ ok: false, message: 'Unable to identify Google account.' });
      }

      // Look up existing user by Google sub
      const existing = await queryOne('SELECT username FROM users WHERE google_sub = ?', [googleSub]);
      if (existing) {
        return res.status(200).json({
          ok: true, message: 'Login successful.',
          user: { username: existing.username }, token: await createToken(existing.username),
        });
      }

      // New Google user — derive a unique username from their email
      const email = payload.email || '';
      let base = email.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
      if (base.length < 5) base = (base + 'user0').slice(0, 8);
      if (base.length > 25) base = base.slice(0, 25);

      let candidate = base;
      for (let i = 1; i <= 999; i++) {
        const taken = await queryOne('SELECT 1 FROM users WHERE username = ?', [candidate]);
        if (!taken) break;
        candidate = base + i;
      }

      await execute(
        'INSERT INTO users (username, salt, hash, google_sub, created_at) VALUES (?, ?, ?, ?, ?)',
        [candidate, 'google', '', googleSub, Date.now()]
      );
      return res.status(200).json({
        ok: true, message: 'Account created via Google.',
        user: { username: candidate }, token: await createToken(candidate),
      });
    }

    return res.status(400).json({ ok: false, message: 'Unsupported action. Use register or login.' });
  } catch (err) {
    console.error('[auth] Error:', err);
    const msg = (err.message && err.message.includes('TURSO_DATABASE_URL'))
      ? 'Backend database not configured. Contact the administrator.'
      : 'Internal server error.';
    return res.status(500).json({ ok: false, message: msg });
  }
};
