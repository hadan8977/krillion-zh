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
  const system = "你是中文百科题库审核员。判断一个词是否属于题目所描述的类别，只看它本身是否符合题意，不需要判断它是否已被收录。(1) 若候选答案的对象本身属于题目类别，approve 为 true；(2) 若不属于，approve 为 false。只输出 JSON：{\"approved\":true|false,\"reason\":\"一句话\"}";
  const user = `题目：${question.prompt}\n范围：${question.scope}\n\n参考：属于该类别的一些已有词包括：${accepted || "(暂无)"}\n\n请判断候选答案「${label}」是否属于题目类别，只返回 JSON。`;
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
