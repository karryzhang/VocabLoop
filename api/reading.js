/**
 * api/reading.js — Proxy endpoint for AI-generated reading stories
 *
 * Proxies requests to Google Gemini API using a server-stored API key,
 * so users don't need to provide their own key.
 *
 * Env: GEMINI_API_KEY — Google Gemini API key
 */

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const GEMINI_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_KEY) {
    return res.status(503).json({ error: 'Reading service not configured' });
  }

  try {
    const { prompt, generationConfig } = req.body || {};
    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: 'Missing prompt' });
    }
    if (prompt.length > 5000) {
      return res.status(400).json({ error: 'Prompt too long' });
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000);

    const apiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: generationConfig || {
            maxOutputTokens: 800,
            temperature: 0.9,
            thinkingConfig: { thinkingBudget: 0 }
          }
        })
      }
    );
    clearTimeout(timeoutId);

    if (!apiRes.ok) {
      const status = apiRes.status;
      let msg = '';
      try { const e = await apiRes.json(); msg = e.error?.message || ''; } catch (_) {}
      return res.status(status === 429 ? 429 : 502).json({
        error: status === 429 ? 'rate_limit' : `Gemini API error: ${status}`,
        message: msg
      });
    }

    const data = await apiRes.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (!text) {
      return res.status(502).json({ error: 'Empty response from AI' });
    }

    return res.status(200).json({ text: text.trim() });
  } catch (e) {
    if (e.name === 'AbortError') {
      return res.status(504).json({ error: 'timeout' });
    }
    return res.status(500).json({ error: 'Internal error' });
  }
};
