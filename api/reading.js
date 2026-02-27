/**
 * api/reading.js — AI-generated reading stories for VocabLoop
 *
 * Client sends a word list; server builds the prompt, calls Gemini,
 * and returns the story. The API key never leaves the server.
 *
 * Env: GEMINI_API_KEY — Google Gemini API key
 *
 * Request:  POST { words: [{ word: "accept", zh: "接受" }, ...] }
 * Response: { text: "Once upon a time..." }
 */

/* ── Prompt template (server-only) ─────────────────────────────────── */

function buildPrompt(words) {
  const wordList = words.map(w => `${w.word} (${w.zh})`).join(', ');
  return [
    'You are a creative writing tutor crafting a short story to help',
    'an intermediate English learner remember new vocabulary.',
    '',
    'Requirements:',
    '- Length: 180–220 words.',
    '- Weave ALL of the vocabulary words below naturally into the story',
    '  — they should feel essential, not forced.',
    '- Literary quality: give the story a clear arc',
    '  (setup → tension → resolution), a vivid scene, and at least one',
    '  moment of emotion or surprise that makes it memorable.',
    '- Vocabulary level: keep all OTHER words at roughly the same',
    '  difficulty as the given list — don\'t simplify to beginner level,',
    '  but avoid obscure words the learner hasn\'t seen.',
    '- Tone: warm, imaginative, slightly literary — think short-story',
    '  rather than textbook exercise.',
    '- Return only the story text. No title, no commentary, no word list.',
    '',
    `Vocabulary: ${wordList}`,
  ].join('\n');
}

/* ── Handler ───────────────────────────────────────────────────────── */

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
    const { words } = req.body || {};

    // Validate: words must be a non-empty array of {word, zh} objects
    if (!Array.isArray(words) || words.length === 0) {
      return res.status(400).json({ error: 'Missing or empty words array' });
    }
    if (words.length > 30) {
      return res.status(400).json({ error: 'Too many words (max 30)' });
    }
    const valid = words.every(w =>
      w && typeof w.word === 'string' && w.word.length > 0 &&
      typeof w.zh === 'string' && w.zh.length > 0
    );
    if (!valid) {
      return res.status(400).json({ error: 'Each word must have { word, zh }' });
    }

    // Build prompt server-side — API key and prompt never sent to client
    const prompt = buildPrompt(words);

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
          generationConfig: {
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
