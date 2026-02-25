/**
 * server.js — Local development server for VocabLoop
 *
 * Serves static files + API endpoints, matching Vercel's function routing.
 *
 * Usage:
 *   node server.js              # default port 3000
 *   PORT=8080 node server.js    # custom port
 */

const express = require('express');
const path    = require('path');

const app = express();

/* ── Security headers ─────────────────────────────────────────────── */
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

/* ── CORS (same-origin in production, permissive in dev) ──────────── */
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '86400');
  }
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

/* ── Body parsing with size limit ─────────────────────────────────── */
app.use(express.json({ limit: '2mb' }));

/* ── API routes ───────────────────────────────────────────────────── */
app.post('/api/auth', require('./api/auth'));
app.post('/api/sync', require('./api/sync'));

/* ── Static files ─────────────────────────────────────────────────── */
app.use(express.static(path.join(__dirname)));

/* ── SPA fallback: serve index.html for non-file routes ───────────── */
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

/* ── Start ────────────────────────────────────────────────────────── */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`VocabLoop server running at http://localhost:${PORT}`);
});
