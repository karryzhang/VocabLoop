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

  /* ── Derived metrics ── */
  const coveragePct    = d.total > 0 ? Math.round(d.studied  / d.total   * 100) : 0;
  const masteredPct    = d.total > 0 ? Math.round(d.mastered / d.total   * 100) : 0;
  const retentionRate  = d.studied > 0 ? Math.round(d.mastered / d.studied * 100) : 0;
  const velocity       = d.streak > 1  ? (d.studied / d.streak).toFixed(1) : null;
  const avgReviews     = d.studied > 0 ? (d.reviewedTotal / d.studied).toFixed(1) : 0;
  const activePct      = d.studied > 0
    ? Math.round((d.stages.learning + d.stages.review) / d.studied * 100) : 0;

  const deckLines = (d.decks || []).map(dk => {
    const dp  = dk.total > 0 ? Math.round(dk.studied  / dk.total   * 100) : 0;
    const mp  = dk.studied > 0 ? Math.round(dk.mastered / dk.studied * 100) : 0;
    return `  • ${dk.name}: coverage ${dp}% (${dk.studied}/${dk.total}), retention ${mp}% (${dk.mastered} mastered)`;
  }).join('\n');

  const hardWords = (d.difficultWords || []).slice(0, 5)
    .map(w => `${w.word}(×${w.againCount})`)
    .join(', ') || (isZh ? '暂无' : 'none');

  /* ── Risk flags for the model to reason about ── */
  const flags = [];
  if (retentionRate < 40 && d.studied > 20) flags.push(isZh ? '记忆巩固率偏低（<40%）' : 'Low retention rate (<40%) — too many words introduced before consolidation');
  if (activePct > 70) flags.push(isZh ? '学习中/复习中词汇占比过高（>70%）——可能超出工作记忆负荷' : 'High active-SRS load (>70%) — working memory may be overloaded');
  if (d.streak < 3 && d.studied > 0) flags.push(isZh ? '连续学习天数不足——习惯尚未形成' : 'Streak < 3 days — habit not yet established');
  if (coveragePct < 20 && d.total > 200) flags.push(isZh ? '词汇覆盖率低——建议系统性推进' : 'Low coverage (<20%) — systematic progression recommended');
  if (d.stages.learning > d.stages.mastered * 2 && d.studied > 30) flags.push(isZh ? '学习中词汇远多于已掌握词汇——间隔复习效率待提升' : 'Learning-stage words greatly outnumber mastered — SRS review cadence needs attention');

  if (isZh) {
    return `你是一位应用语言学专家，专注于第二语言词汇习得与间隔重复学习系统（SRS）的研究与实践。
请依据下方学习者数据，从语言习得科学的角度给出专业评估报告。

━━ 学习者数据 ━━

【基础指标】
• 词库总量：${d.total} 词，已接触：${d.studied} 词（覆盖率 ${coveragePct}%）
• 已掌握：${d.mastered} 词（占总量 ${masteredPct}%，保留率 ${retentionRate}%）
• 总复习次数：${d.reviewedTotal}，人均复习轮次：${avgReviews} 次/词

【学习连续性】
• 当前连续学习：${d.streak} 天${velocity ? `，平均习得速度：${velocity} 词/天` : ''}

【SRS 阶段分布】
• 未学：${d.stages.new} 词 | 学习中：${d.stages.learning} 词 | 复习中：${d.stages.review} 词 | 已掌握：${d.stages.mastered} 词
• 活跃 SRS 词汇占已学词汇：${activePct}%

【词库分项进度】
${deckLines}

【高遗忘风险词汇】（忘记次数最多）
${hardWords}

【系统检测到的风险信号】
${flags.length > 0 ? flags.map(f => '⚠ ' + f).join('\n') : '✓ 暂无明显风险信号'}

━━ 输出要求 ━━

请输出以下 JSON（严格格式，不含任何 markdown 或多余文字）：
{
  "summary": "3~4句专业诊断：指出学习者当前所处的习得阶段、最突出的优势、最需关注的风险点，以及核心结论。语言需专业但易于理解。",
  "suggestions": [
    "建议1（以动词开头，结合具体数据，说明为什么这样做及预期效果，不超过60字）",
    "建议2",
    "建议3",
    "建议4",
    "建议5（可选）"
  ]
}`;
  }

  return `You are an applied linguist and SRS learning specialist with expertise in second-language vocabulary acquisition. Your assessments are grounded in research on spaced repetition, lexical retention curves, and evidence-based vocabulary instruction.

Analyse the learner data below and produce a professional diagnostic report.

━━ LEARNER DATA ━━

[Core metrics]
• Vocabulary coverage: ${d.studied}/${d.total} words studied (${coveragePct}%)
• Mastery: ${d.mastered} words mastered (${masteredPct}% of total, ${retentionRate}% retention rate)
• Total review events: ${d.reviewedTotal} (avg ${avgReviews} reviews/word studied)

[Learning consistency]
• Current streak: ${d.streak} days${velocity ? ` | Acquisition velocity: ${velocity} words/day` : ''}

[SRS stage distribution]
• Unseen: ${d.stages.new} | Learning: ${d.stages.learning} | Review: ${d.stages.review} | Mastered: ${d.stages.mastered}
• Active SRS load: ${activePct}% of studied words are in active rotation

[Deck-level progress]
${deckLines}

[High-risk vocabulary] (most frequently forgotten)
${hardWords}

[System-detected risk flags]
${flags.length > 0 ? flags.map(f => '⚠ ' + f).join('\n') : '✓ No critical risk signals detected'}

━━ OUTPUT FORMAT ━━

Return ONLY this JSON (no markdown, no extra text):
{
  "summary": "3–4 sentence professional diagnosis: identify the learner's current acquisition phase, their most notable strength, the most critical risk, and a clear overall verdict. Be specific — cite numbers.",
  "suggestions": [
    "Tip 1 (start with an action verb; cite specific data; state the evidence-based rationale; ≤ 50 words)",
    "Tip 2",
    "Tip 3",
    "Tip 4",
    "Tip 5 (optional)"
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
