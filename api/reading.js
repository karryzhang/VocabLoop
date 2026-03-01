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
    'naturally into the narrative. Then provide sentence-by-sentence Chinese translations',
    'and brief Chinese glosses for other key words.',
    '',
    'Story requirements:',
    '- Length: 260–320 English words (immersive and engaging, NOT a list of example sentences)',
    '- Every vocabulary word must appear naturally — essential to the story, not forced',
    '- Structure: a named character in a specific vivid setting → rising tension or dilemma',
    '  → emotionally satisfying resolution',
    '- Depth: sensory details, character inner thoughts, one unexpected or touching moment',
    '- Language: the vocabulary list words ARE the challenging words in this story.',
    '  Everything else — background narration, dialogue, transitions — must use simple,',
    '  everyday language (A2–B1 level: short sentences, common words, clear structure).',
    '  This lets learners focus their attention on the key words in context rather than',
    '  getting lost in other unfamiliar vocabulary. Engaging and vivid, but not dense.',
    '- Format the story into 3–4 paragraphs (use actual blank lines between paragraphs)',
    '- Give the story a short, imaginative, evocative title (4–8 words)',
    '- Plain prose only — do NOT use markdown symbols (**, *, _, ##) inside the story text',
    '',
    'Return ONLY valid JSON — no markdown, no code fences, no extra text:',
    '{',
    '  "title": "A Short Evocative Title",',
    '  "story": "Paragraph 1.\\n\\nParagraph 2.\\n\\nParagraph 3.",',
    '  "sentences": [',
    '    { "en": "First sentence.", "zh": "第一句中文翻译。" },',
    '    { "en": "Second sentence.", "zh": "第二句中文翻译。" }',
    '  ],',
    '  "glosses": {',
    '    "hesitated": "犹豫",',
    '    "gleaming": "闪闪发光的"',
    '  }',
    '}',
    '',
    'Rules for sentences: include every sentence of the story in order, each with an accurate Chinese translation.',
    'Rules for glosses: include up to 15 non-trivial words from the story background that a Chinese learner',
    'at B1 level might not know. Skip the vocabulary list words (those are the focus) and skip very basic',
    'words (the, is, go, etc.). Keep each gloss to 2–5 Chinese characters — concise and useful.',
    '',
    `Vocabulary: ${wordList}`,
  ].join('\n');
}

/* ── Response parser ────────────────────────────────────────────────── */

function tryParseJSON(str) {
  try { return JSON.parse(str); } catch (_) {}
  // Fix trailing commas (common LLM output issue): ,] → ] and ,} → }
  const fixed = str.replace(/,\s*([\]}])/g, '$1');
  try { return JSON.parse(fixed); } catch (_) {}
  return null;
}

function extractJSON(raw) {
  // Strategy 1: direct parse (clean JSON)
  const direct = tryParseJSON(raw.trim());
  if (direct) return direct;

  // Strategy 2: strip markdown code fences (```json ... ```)
  const fenceRe = /```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/;
  const fenceMatch = raw.match(fenceRe);
  if (fenceMatch) {
    const fenced = tryParseJSON(fenceMatch[1].trim());
    if (fenced) return fenced;
  }

  // Strategy 3: find the outermost { ... } brace pair
  const first = raw.indexOf('{');
  const last  = raw.lastIndexOf('}');
  if (first !== -1 && last > first) {
    const braced = tryParseJSON(raw.slice(first, last + 1));
    if (braced) return braced;
  }

  // Strategy 4: repair truncated JSON (output cut off by token limit)
  if (first !== -1) {
    const repaired = repairTruncatedJSON(raw.slice(first));
    if (repaired) return repaired;
  }

  return null;
}

/**
 * Attempt to repair truncated JSON by closing open strings, arrays, objects.
 * Handles the common case where maxOutputTokens cuts the response mid-JSON.
 */
function repairTruncatedJSON(str) {
  // Remove any trailing incomplete string value (cut mid-sentence)
  let s = str.replace(/,\s*"[^"]*$/s, '');        // trailing incomplete key or value
  s = s.replace(/:\s*"[^"]*$/s, ': ""');           // truncated string value
  s = s.replace(/,\s*\{[^}]*$/s, '');              // trailing incomplete object in array
  // Count unclosed brackets / braces
  let braces = 0, brackets = 0, inString = false, escape = false;
  for (const ch of s) {
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') braces++;
    if (ch === '}') braces--;
    if (ch === '[') brackets++;
    if (ch === ']') brackets--;
  }
  // Close any open string
  if (inString) s += '"';
  // Close open brackets then braces
  while (brackets > 0) { s += ']'; brackets--; }
  while (braces > 0)   { s += '}'; braces--; }
  return tryParseJSON(s);
}

function extractStoryText(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return '';
  // Try common field names for the story text
  const textFields = ['story', 'text', 'content', 'article', 'body', 'narrative'];
  for (const field of textFields) {
    if (typeof obj[field] === 'string' && obj[field].trim().length > 20) {
      return obj[field].trim();
    }
  }
  // Fallback: find the longest string value (likely the story)
  let best = '';
  for (const [key, val] of Object.entries(obj)) {
    if (typeof val === 'string' && val.length > best.length && key !== 'title') {
      best = val;
    }
  }
  if (best.length > 50) return best.trim();
  // Handle array of paragraph strings (e.g. "paragraphs": ["p1", "p2"])
  for (const val of Object.values(obj)) {
    if (Array.isArray(val) && val.length > 0 && typeof val[0] === 'string' && val[0].length > 20) {
      return val.join('\n\n').trim();
    }
  }
  return '';
}

function parseResponse(raw) {
  const parsed = extractJSON(raw);

  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const text = extractStoryText(parsed);
    if (text) {
      return {
        title: typeof parsed.title === 'string' ? parsed.title.trim() : '',
        text,
        sentences: Array.isArray(parsed.sentences)
          ? parsed.sentences
              .filter(s => s && typeof s.en === 'string' && typeof s.zh === 'string')
              .map(s => ({ en: s.en.trim(), zh: s.zh.trim() }))
          : [],
        glosses: (parsed.glosses && typeof parsed.glosses === 'object' && !Array.isArray(parsed.glosses))
          ? parsed.glosses
          : {},
      };
    }
  }

  // Could not parse structured JSON — clean up raw text as fallback
  let fallback = raw.trim();
  // Strip markdown code fences
  fallback = fallback.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?\s*```\s*$/i, '');
  // If it still looks like raw JSON, do NOT return it as article text
  const stripped = fallback.trim();
  if (stripped.charAt(0) === '{' || stripped.charAt(0) === '[') {
    return { title: '', text: '', sentences: [], glosses: {} };
  }
  return { title: '', text: fallback, sentences: [], glosses: {} };
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
            maxOutputTokens: 8192,
            temperature: 0.88,
            responseMimeType: 'application/json',
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
    // Gemini 2.5 thinking models may return multiple parts; use the last
    // non-thought text part (thought parts have `thought: true`).
    const parts = data.candidates?.[0]?.content?.parts || [];
    let raw = '';
    for (let i = parts.length - 1; i >= 0; i--) {
      if (parts[i].text && !parts[i].thought) { raw = parts[i].text; break; }
    }
    if (!raw && parts.length) raw = parts[parts.length - 1].text || '';
    if (!raw) {
      return res.status(502).json({ error: 'Empty response from AI' });
    }

    const { title, text, sentences, glosses } = parseResponse(raw);
    if (!text) {
      return res.status(502).json({ error: 'Could not extract story from AI response' });
    }

    return res.status(200).json({ title, text, sentences, glosses });
  } catch (e) {
    if (e.name === 'AbortError') {
      return res.status(504).json({ error: 'timeout' });
    }
    return res.status(500).json({ error: 'Internal error' });
  }
};
