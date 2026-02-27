/**
 * api/insight.js — AI-generated learning insights for VocabLoop
 *
 * Accepts the user's aggregated study stats, calls Gemini, and returns
 * a personalised summary + actionable study suggestions.
 *
 * Env: GEMINI_API_KEY
 *
 * Request:  POST { lang, studied, mastered, total, streak, reviewedTotal,
 *                  decks:[{name,total,studied,mastered}],
 *                  stages:{new,learning,review,mastered},
 *                  difficultWords:[{word,againCount}] }
 * Response: { summary: "...", suggestions: ["...", ...] }
 */

function buildPrompt(d) {
  const isZh = d.lang === 'zh';
  const pct = d.total > 0 ? Math.round(d.studied / d.total * 100) : 0;
  const masteredPct = d.total > 0 ? Math.round(d.mastered / d.total * 100) : 0;

  const deckLines = (d.decks || [])
    .map(dk => `  - ${dk.name}: ${dk.studied}/${dk.total} studied, ${dk.mastered} mastered`)
    .join('\n');

  const hardWords = (d.difficultWords || []).slice(0, 5).map(w => w.word).join(', ') || (isZh ? '暂无' : 'none');

  if (isZh) {
    return `你是一位专业的英语词汇学习顾问。
请根据以下学习数据，给出一段2~3句的中文总结，再给出3~5条具体、可执行的学习建议（每条不超过40字）。

学习数据：
- 词库总量：${d.total} 词
- 已学习：${d.studied} 词（${pct}%）
- 已掌握：${d.mastered} 词（${masteredPct}%）
- 总复习次数：${d.reviewedTotal}
- 当前连续学习：${d.streak} 天
- 各阶段分布：未学 ${d.stages.new}，学习中 ${d.stages.learning}，复习中 ${d.stages.review}，已掌握 ${d.stages.mastered}
- 各词库进度：
${deckLines}
- 最容易忘记的词：${hardWords}

请严格以 JSON 格式返回（不要有任何其他文字、代码块或注释）：
{"summary":"…","suggestions":["…","…","…"]}`;
  }

  return `You are an expert English vocabulary learning coach.
Based on the learning data below, write a 2–3 sentence summary and provide 3–5 specific, actionable study tips (≤ 30 words each).

Learning data:
- Total vocabulary: ${d.total} words
- Studied: ${d.studied} (${pct}%)
- Mastered: ${d.mastered} (${masteredPct}%)
- Total reviews: ${d.reviewedTotal}
- Current streak: ${d.streak} days
- Stage breakdown: new ${d.stages.new}, learning ${d.stages.learning}, review ${d.stages.review}, mastered ${d.stages.mastered}
- Deck progress:
${deckLines}
- Most-forgotten words: ${hardWords}

Return ONLY a JSON object (no markdown, no extra text):
{"summary":"…","suggestions":["…","…","…"]}`;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const GEMINI_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_KEY) return res.status(503).json({ error: 'Service not configured' });

  const data = req.body || {};
  if (typeof data.studied !== 'number') {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const prompt = buildPrompt(data);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 25000);

  try {
    const apiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            maxOutputTokens: 600,
            temperature: 0.7,
            thinkingConfig: { thinkingBudget: 0 }
          }
        })
      }
    );
    clearTimeout(timeoutId);

    if (!apiRes.ok) {
      const status = apiRes.status;
      return res.status(status === 429 ? 429 : 502).json({ error: `API error: ${status}` });
    }

    const geminiData = await apiRes.json();
    let text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (!text) return res.status(502).json({ error: 'Empty response' });

    // Strip markdown code fences if model wraps in them
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

    let parsed;
    try { parsed = JSON.parse(text); } catch (e) {
      return res.status(502).json({ error: 'Invalid JSON from AI', raw: text.slice(0, 200) });
    }

    if (!parsed.summary || !Array.isArray(parsed.suggestions)) {
      return res.status(502).json({ error: 'Unexpected response shape' });
    }

    return res.status(200).json(parsed);
  } catch (e) {
    clearTimeout(timeoutId);
    if (e.name === 'AbortError') return res.status(504).json({ error: 'timeout' });
    return res.status(500).json({ error: 'Internal error' });
  }
};
