/**
 * api/reading.js — AI-generated reading stories for VocabLoop
 *
 * Client sends a word list; server builds the prompt, calls Gemini,
 * and returns the story text + sentence-level bilingual translations.
 *
 * Env: GEMINI_API_KEY — Google Gemini API key
 *
 * Request:  POST { words: [{ word: "accept", zh: "接受" }, ...] }
 * Response: { text: "Full story...", sentences: [{ en: "...", zh: "..." }] }
 */

/* ── Prompt template (server-only) ─────────────────────────────────── */

function buildPrompt(words) {
  const wordList = words.map(w => `${w.word} (${w.zh})`).join(', ');
  return [
    'You are a creative writing teacher helping an intermediate English learner',
    'master vocabulary through immersive, enjoyable reading.',
    '',
    'Write an engaging short story that weaves ALL the vocabulary words below',
    'naturally into the narrative. Then provide a sentence-by-sentence Chinese translation.',
    '',
    'Story requirements:',
    '- Length: 260–320 English words (rich and immersive, NOT a list of example sentences)',
    '- Every vocabulary word must appear naturally — essential to the story, not forced',
    '- Structure: a named character in a specific vivid setting → rising tension or dilemma',
    '  → emotionally satisfying resolution',
    '- Depth: sensory details, character inner thoughts, one unexpected or touching moment',
    '- Language: rich B1–B2 level — literary and engaging, NOT a textbook exercise',
    '- Format the story into 3–4 paragraphs (use actual blank lines between paragraphs)',
    '',
    'Return ONLY valid JSON — no markdown, no code fences, no extra text:',
    '{',
    '  "story": "Paragraph 1.\\n\\nParagraph 2.\\n\\nParagraph 3.",',
    '  "sentences": [',
    '    { "en": "First sentence.", "zh": "第一句中文翻译。" },',
    '    { "en": "Second sentence.", "zh": "第二句中文翻译。" }',
    '  ]',
    '}',
    '',
    'The sentences array must contain every sentence of the story in order,',
    'each with an accurate Chinese translation.',
    '',
    `Vocabulary: ${wordList}`,
  ].join('\n');
}

/* ── Response parser ────────────────────────────────────────────────── */

function parseResponse(raw) {
  // Try to parse as JSON (the expected format)
  try {
    // Strip markdown code fences if present
    const cleaned = raw.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
    const parsed = JSON.parse(cleaned);
    if (parsed.story && Array.isArray(parsed.sentences)) {
      return {
        text: parsed.story.trim(),
        sentences: parsed.sentences
          .filter(s => s && typeof s.en === 'string' && typeof s.zh === 'string')
          .map(s => ({ en: s.en.trim(), zh: s.zh.trim() })),
      };
    }
    // Fallback if JSON has unexpected shape
    const text = parsed.story || parsed.text || raw.trim();
    return { text, sentences: [] };
  } catch (_) {
    // Not valid JSON — treat as plain text (backwards compat)
    return { text: raw.trim(), sentences: [] };
  }
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
    const timeoutId = setTimeout(() => controller.abort(), 28000);

    const apiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            maxOutputTokens: 1500,
            temperature: 0.88,
            thinkingConfig: { thinkingBudget: 0 },
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
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (!raw) {
      return res.status(502).json({ error: 'Empty response from AI' });
    }

    const { text, sentences } = parseResponse(raw);
    if (!text) {
      return res.status(502).json({ error: 'Could not extract story from AI response' });
    }

    return res.status(200).json({ text, sentences });
  } catch (e) {
    if (e.name === 'AbortError') {
      return res.status(504).json({ error: 'timeout' });
    }
    return res.status(500).json({ error: 'Internal error' });
  }
};
