import { answerIndex, normalize } from "../src/answer-rules.js";

export const POLICY = Object.freeze({
  minimumSamples: 30,
  priorSamples: 30,
  minimumSubmitters: 3,
  minimumDays: 2,
  maximumAdditionsPerQuestion: 50,
});
const order = ["plankton", "schooler", "rare", "deepcut"];
const weights = { plankton: 16, tooclever: 10, schooler: 4, rare: 1, deepcut: 0.25, krillion: 0.1 };

export function wilsonLower(yes, total) {
  if (!total) return 0;
  const z = 1.96, p = yes / total;
  return (p + z * z / (2 * total) - z * Math.sqrt((p * (1 - p) + z * z / (4 * total)) / total)) / (1 + z * z / total);
}

export function candidateName(raw) {
  if (typeof raw !== "string") return null;
  const value = raw.normalize("NFKC").trim();
  if (!/^[\p{Script=Han}A-Za-z0-9·ー -]{1,30}$/u.test(value) ||
      /(?:\d[ -]*){7,}|(?:ghp|sk|sb.secret)[_-]/i.test(value)) return null;
  return value;
}

// Only grammatical wrappers around an already accepted name can become aliases
// without semantic voting. Similar spelling alone never establishes membership.
export function knownAlias(question, raw) {
  const name = normalize(raw);
  const stripped = name.replace(/^(?:我选|我的答案是|一(?:种|个|把|架|双|件|顶|杯|碗|盏|条|只|辆|棵|朵|台|支|本|瓶))/, "");
  if (name === stripped) return null;
  return answerIndex(question).get(stripped)?.label ?? null;
}

export function approvedCandidate(candidate) {
  // llmApproved comes from the LLM-based review step in the refresh pipeline.
  return Boolean(candidateName(candidate.label)) && candidate.llmApproved === true &&
    candidate.submitters >= POLICY.minimumSubmitters && candidate.days >= POLICY.minimumDays;
}

export function recalibrate(current, observations, candidates, now = new Date()) {
  const bank = structuredClone(current), changes = [];
  for (const question of bank.questions) {
    let index = answerIndex(question), additions = 0;
    const proposed = candidates.filter(candidate => candidate.questionId === question.id)
      .sort((a, b) => b.submitters - a.submitters || b.days - a.days || a.normalized.localeCompare(b.normalized, "en"));
    for (const candidate of proposed) {
      if (!candidateName(candidate.label) || index.has(normalize(candidate.label))) continue;
      const target = knownAlias(question, candidate.label);
      if (target && candidate.submitters >= 3 && candidate.days >= 2) {
        const answer = question.answers.find(item => item.label === target);
        if (answer.aliases.length >= 100) continue;
        answer.aliases.push(candidate.label);
        changes.push({ type: "alias", questionId: question.id, label: target, alias: candidate.label });
      } else if (approvedCandidate(candidate) && additions < POLICY.maximumAdditionsPerQuestion && question.answers.length < 1000) {
        question.answers.push({ label: candidate.label, aliases: [], tier: "schooler", addedAt: now.toISOString(), origin: "community" });
        additions++;
        changes.push({ type: "answer", questionId: question.id, label: candidate.label, submitters: candidate.submitters, days: candidate.days });
      } else continue;
      index = answerIndex(question);
    }
    const samples = observations.filter(row => row.questionId === question.id);
    const total = samples.reduce((n, row) => n + row.count, 0);
    if (total < POLICY.minimumSamples) continue;
    const counts = new Map();
    for (const sample of samples) {
      const answer = index.get(sample.normalized);
      if (answer) counts.set(answer.label, (counts.get(answer.label) ?? 0) + sample.count);
    }
    const sumWeights = question.answers.reduce((n, answer) => n + weights[answer.tier], 0);
    const probability = answer => ((counts.get(answer.label) ?? 0) + POLICY.priorSamples * weights[answer.tier] / sumWeights) / (total + POLICY.priorSamples);
    const previousGem = question.answers.find(answer => answer.tier === "krillion");
    const eligibleGems = question.answers.filter(answer => ["deepcut", "krillion"].includes(answer.tier));
    eligibleGems.sort((a, b) => probability(a) - probability(b) || Number(b === previousGem) - Number(a === previousGem) || normalize(a.label).localeCompare(normalize(b.label), "en"));
    const gem = eligibleGems[0];
    // Calculate every probability before changing any tier, keeping the prior fixed.
    const updates = question.answers.map(answer => {
      const p = probability(answer);
      // The 15-point wordplay tier describes answer style, not frequency.
      if (answer.tier === "tooclever") return { answer, tier: answer.tier, probability: p };
      const target = p >= 0.15 ? 0 : p >= 0.05 ? 1 : p >= 0.015 ? 2 : 3;
      const previous = answer.tier === "krillion" ? 4 : answer.tier === "tooclever" ? 1 : order.indexOf(answer.tier);
      const next = Math.max(previous - 1, Math.min(previous + 1, target));
      return { answer, tier: answer === gem ? "krillion" : order[Math.min(3, next)], probability: p };
    });
    for (const { answer, tier, probability: p } of updates) {
      if (tier === answer.tier) continue;
      changes.push({ type: "tier", questionId: question.id, label: answer.label, before: answer.tier, after: tier, samples: total, count: counts.get(answer.label) ?? 0, probability: Number(p.toFixed(6)) });
      answer.tier = tier;
    }
  }
  return { bank, changes };
}
