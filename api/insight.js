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

  /* ── Derived metrics (no coverage — user learns what they choose) ── */
  const retentionRate  = d.studied > 0 ? Math.round(d.mastered / d.studied * 100) : 0;
  const avgReviews     = d.studied > 0 ? (d.reviewedTotal / d.studied).toFixed(1) : 0;
  const activePct      = d.studied > 0
    ? Math.round((d.stages.learning + d.stages.review) / d.studied * 100) : 0;

  // Only include decks the user has actually started
  const studiedDecks = (d.decks || []).filter(dk => dk.studied > 0);
  const deckLines = studiedDecks.length > 0
    ? studiedDecks.map(dk => {
        const mp = dk.studied > 0 ? Math.round(dk.mastered / dk.studied * 100) : 0;
        return isZh
          ? `  • ${dk.name}：已学 ${dk.studied} 词，已掌握 ${dk.mastered} 词（巩固率 ${mp}%）`
          : `  • ${dk.name}: ${dk.studied} studied, ${dk.mastered} mastered (${mp}% consolidated)`;
      }).join('\n')
    : (isZh ? '  暂未开始任何词库' : '  No decks started yet');

  const hardWords = (d.difficultWords || []).slice(0, 5)
    .map(w => `${w.word}(×${w.againCount})`)
    .join(', ') || (isZh ? '暂无' : 'none');

  /* ── Situation notes (conversational, not alarm-style) ── */
  const notes = [];
  if (retentionRate < 40 && d.studied > 20) notes.push(isZh
    ? '巩固率偏低——近期可能学得比较快，让复习稍稍追一追'
    : 'Retention is a bit low — you might be adding words faster than your reviews can keep up');
  if (activePct > 70) notes.push(isZh
    ? '正在活跃复习的词比较多——SRS 在帮你密集巩固，坚持每天来就好'
    : 'Lots of words in active rotation — SRS is consolidating hard, just keep showing up daily');
  if (d.streak < 3 && d.studied > 0) notes.push(isZh
    ? '最近学习节奏有点断——哪怕每天只翻几张卡，也比隔天大量学效果好'
    : 'Study has been a bit irregular lately — even a few cards a day beats cramming occasionally');
  if (d.stages.learning > d.stages.mastered * 2 && d.studied > 30) notes.push(isZh
    ? '学习中的词比已掌握的多——这很正常，每天坚持复习这些词很快会毕业'
    : 'More words in learning than mastered — totally normal, keep reviewing and they\'ll graduate soon');
  if ((d.difficultWords || []).length >= 3) notes.push(isZh
    ? `有几个词在反复考验你——${hardWords}`
    : `A few words keep testing you — ${hardWords}`);

  if (isZh) {
    return `你是用户的学习伙伴，语气像朋友一样轻松，了解词汇记忆的规律。
请根据下方数据，给用户一个贴合当前状态的小结和实用建议。

重要原则：
- 不要提词库覆盖率或"还有多少词没学"——用户学自己想学的内容，这本来就是个性化的，不需要学完全部
- 语气轻松自然，可以鼓励，但要真实，不要空洞夸奖
- 建议要针对当前数据，具体可操作

━━ 学习数据 ━━

【当前状态】
• 已学词汇：${d.studied} 词，其中已掌握 ${d.mastered} 词（巩固率 ${retentionRate}%）
• 正在学习中：${d.stages.learning} 词 | 复习阶段：${d.stages.review} 词
• 平均每词复习次数：${avgReviews} 次
• 连续学习：${d.streak} 天

【词库情况】（仅已开始的）
${deckLines}

【反复记不住的词】
${hardWords}

【值得注意的点】
${notes.length > 0 ? notes.join('\n') : '学习状态不错，没发现明显问题！'}

━━ 输出格式 ━━

请输出以下 JSON，不含任何 markdown 或多余文字：
{
  "summary": "2~3句话，轻松聊一聊现在的学习状态，结合具体数字，有鼓励也要真实。",
  "suggestions": [
    "建议1（针对当前情况，具体可操作，40字以内）",
    "建议2",
    "建议3",
    "建议4（可选，仅在有额外值得说的内容时添加）"
  ]
}`;
  }

  return `You're the user's friendly study buddy — casual, warm, and knowledgeable about vocabulary learning.
Based on the data below, give them a quick honest take on how things are going and some practical tips.

Important principles:
- Do NOT mention coverage rates or how many words they haven't studied — users learn what they choose, and that's the whole point of personalised learning
- Keep the tone casual and genuine; encouragement is fine but skip hollow praise
- Make suggestions specific to their actual data, not generic advice

━━ STUDY DATA ━━

[Current state]
• Studied: ${d.studied} words, ${d.mastered} mastered (${retentionRate}% consolidation rate)
• In learning: ${d.stages.learning} words | In review: ${d.stages.review} words
• Avg reviews per word: ${avgReviews}
• Current streak: ${d.streak} days

[Active decks only]
${deckLines}

[Words that keep slipping]
${hardWords}

[Things worth noting]
${notes.length > 0 ? notes.join('\n') : 'Things look solid — no obvious issues!'}

━━ OUTPUT FORMAT ━━

Return ONLY this JSON (no markdown, no extra text):
{
  "summary": "2–3 casual, friendly sentences about how things are going. Reference specific numbers. Be real, not just cheerful.",
  "suggestions": [
    "Tip 1 (specific to their data, actionable, ≤ 35 words)",
    "Tip 2",
    "Tip 3",
    "Tip 4 (optional — only if there's something genuinely extra to say)"
  ]
}`;
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
            maxOutputTokens: 900,
            temperature: 0.65,
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
