const config = () => ({
  key: process.env.LLM_API_KEY || process.env.OPENROUTER_API_KEY || "",
  base: (process.env.LLM_BASE_URL || "https://openrouter.ai/api/v1").replace(/\/$/, ""),
  model: process.env.LLM_MODEL || "nex-agi/nex-n2.5-pro:free",
});

export function llmConfigured() {
  const { key, base, model } = config();
  return Boolean(key && base && model);
}

/**
 * Ask an LLM whether a proposed answer matches a question's scope.
 * Returns { approved, reason } or null on any failure/rate-limit.
 */
export async function reviewCandidate(question, label, acceptedAnswers = []) {
  const { key, base, model } = config();
  if (!key || !base || !question || !label) return null;
  const accepted = acceptedAnswers.slice(0, 30).join("、");
  const system = "你是中文百科游戏的题目质量审核员。系统会给出一道题的提示词(prompt)和范围定义(scope)，以及一个玩家提交的候选答案。请严格依据该题范围判断候选答案是否**属于**该题要求的类型。只回复 JSON：{\"approved\":true|false,\"reason\":\"一句话\"}";
  const user = `题目：${question.prompt}\n范围：${question.scope}\n\n已收录示例：${accepted || "(暂无)"}\n\n候选答案：${label}\n\n请严格依据范围判断该候选答案是否属于题目类别，只返回 JSON。`;
  let lastError = null;
  for (const attempt of [0, 1, 2]) {
    try {
      const response = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
          ...(base.includes("openrouter") ? { "HTTP-Referer": "https://krillion-zh.vercel.app", "X-Title": "krillion-zh" } : {}),
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          temperature: 0,
          max_tokens: 300,
        }),
        signal: AbortSignal.timeout(30000),
      });
      if (response.status === 429) {
        // rate-limited upstream: back off and retry, otherwise leave pending
        lastError = "rate-limited";
        await new Promise(r => setTimeout(r, (attempt + 1) * 3000));
        continue;
      }
      if (!response.ok) return null;
      const data = await response.json();
      const text = data?.choices?.[0]?.message?.content || "";
      let parsed;
      try { parsed = JSON.parse(text); }
      catch {
        const match = text.match(/\{[^{}]*"approved"\s*:\s*(true|false)[^{}]*\}/);
        if (!match) return null;
        try { parsed = JSON.parse(match[0]); } catch { return null; }
      }
      if (typeof parsed.approved !== "boolean") return null;
      return { approved: parsed.approved, reason: String(parsed.reason || "") };
    } catch (error) {
      lastError = error.name;
      if (attempt < 2) await new Promise(r => setTimeout(r, (attempt + 1) * 2000));
    }
  }
  const _ = lastError;
  return null;
}
