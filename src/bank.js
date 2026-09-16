import { QUESTIONS, BANK_VERSION } from "./questions.js";
import { TIERS, answerIndex } from "./answer-rules.js";

export const BASE_BANK = { baseVersion: BANK_VERSION, version: BANK_VERSION, questions: QUESTIONS };

export function validateBank(value) {
  if (!value || value.baseVersion !== BANK_VERSION || typeof value.version !== "string" ||
      !value.version.startsWith(BANK_VERSION) || value.version.length > 120 ||
      !/^[a-zA-Z0-9._~-]+$/.test(value.version) || !Array.isArray(value.questions) ||
      value.questions.length !== QUESTIONS.length) throw new Error("Invalid question bank version.");
  for (const [i, q] of value.questions.entries()) {
    const base = QUESTIONS[i];
    if (!q || ["id", "category", "prompt", "scope"].some(key => q[key] !== base[key]) ||
        (base.source ? q.source?.title !== base.source.title || q.source?.url !== base.source.url : q.source !== null) ||
        !Array.isArray(q.answers) || q.answers.length < 2 || q.answers.length > 1000) throw new Error("Invalid question bank category.");
    if (q.answers.filter(answer => answer?.tier === "krillion").length !== 1) throw new Error("A category must have one gem.");
    for (const answer of q.answers) {
      if (!answer || !Object.hasOwn(TIERS, answer.tier) || answer.tier === "miss" ||
          !Array.isArray(answer.aliases) || answer.aliases.length > 100) throw new Error("Invalid answer tier or aliases.");
      for (const name of [answer.label, ...answer.aliases]) {
        if (typeof name !== "string" || !name.trim() || name.length > 80 || /[<>\u0000-\u001f]/u.test(name)) throw new Error("Invalid answer name.");
      }
    }
    answerIndex(q);
  }
  return value;
}
