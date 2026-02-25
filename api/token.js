/**
 * api/token.js — HMAC-signed token creation & verification
 *
 * Token format: {payload}.{signature}
 *   payload   = base64url(JSON { sub, iat, exp })
 *   signature = HMAC-SHA256(payload, server_secret)
 *
 * Default expiry: 30 days
 */

const crypto = require('crypto');
const { getSecret } = require('./db');

const TOKEN_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function sign(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

/** Create a signed token for the given username */
function createToken(username) {
  const secret = getSecret();
  const now = Date.now();
  const payload = Buffer.from(JSON.stringify({
    sub: username,
    iat: now,
    exp: now + TOKEN_MAX_AGE_MS,
  })).toString('base64url');
  const sig = sign(payload, secret);
  return `${payload}.${sig}`;
}

/**
 * Verify a token and return the username, or null if invalid/expired.
 * Accepts both new HMAC tokens and legacy base64url tokens (for migration).
 */
function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;

  // New format: payload.signature
  const dotIdx = token.indexOf('.');
  if (dotIdx > 0) {
    const payload = token.slice(0, dotIdx);
    const sig     = token.slice(dotIdx + 1);
    const secret  = getSecret();
    const expected = sign(payload, secret);
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    try {
      const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      if (!data.sub || typeof data.sub !== 'string') return null;
      if (data.exp && data.exp < Date.now()) return null;
      return data.sub;
    } catch (_) { return null; }
  }

  // Legacy format: base64url("username:ts:random") — accept for migration
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf8');
    const parts = decoded.split(':');
    if (parts.length < 3) return null;
    const username = parts[0];
    return username && username.length >= 5 ? username : null;
  } catch (_) { return null; }
}

module.exports = { createToken, verifyToken };
