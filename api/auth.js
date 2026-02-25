const crypto = require('crypto');
const { getDb } = require('./db');

function normalizeUsername(input = '') {
  return String(input).trim().toLowerCase();
}
function validateUsername(username) {
  return typeof username === 'string' && username.trim().length >= 5;
}
function validatePassword(password) {
  return typeof password === 'string' && /^\d{6,}$/.test(password);
}
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
function token(username) {
  return Buffer.from(`${username}:${Date.now()}:${crypto.randomBytes(12).toString('hex')}`).toString('base64url');
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, message: 'Method not allowed' });
  }

  const db = getDb();
  const { action, username, password } = req.body || {};
  const u = normalizeUsername(username);

  if (action === 'register') {
    if (!validateUsername(u)) {
      return res.status(400).json({ ok: false, message: 'Username must be at least 5 characters.' });
    }
    if (!validatePassword(password)) {
      return res.status(400).json({ ok: false, message: 'Password must be at least 6 digits.' });
    }

    const existing = db.prepare('SELECT 1 FROM users WHERE username = ?').get(u);
    if (existing) {
      return res.status(409).json({ ok: false, message: 'Username already exists.' });
    }

    const { salt, hash } = hashPassword(password);
    db.prepare('INSERT INTO users (username, salt, hash, created_at) VALUES (?, ?, ?, ?)').run(u, salt, hash, Date.now());

    return res.status(200).json({ ok: true, message: 'Registered successfully.', user: { username: u }, token: token(u) });
  }

  if (action === 'login') {
    if (!u || !validatePassword(password)) {
      return res.status(400).json({ ok: false, message: 'Invalid username or password format.' });
    }

    const user = db.prepare('SELECT salt, hash FROM users WHERE username = ?').get(u);
    if (!user || !verifyPassword(password, user.salt, user.hash)) {
      return res.status(401).json({ ok: false, message: 'Invalid credentials.' });
    }

    return res.status(200).json({ ok: true, message: 'Login successful.', user: { username: u }, token: token(u) });
  }

  return res.status(400).json({ ok: false, message: 'Unsupported action. Use register or login.' });
};
