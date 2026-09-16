import { Converter } from "../node_modules/opencc-js/dist/esm/t2cn.js";
import { QUESTIONS, BANK_VERSION, PACKS } from "./questions.js";

export const ROUND_MS = 25_000;
export const ROUND_COUNT = 7;
export const TIERS = {
  miss: { name: "没有回声", score: 0, color: "#7d93b8", emoji: "⬛", blurb: "这一题留在了海面。下一次，再往深处想一点。" },
  plankton: { name: "浮游生物", score: 10, color: "#8fa3c4", emoji: "🫧", blurb: "第一个浮上脑海的答案，也浮在海面。" },
  tooclever: { name: "聪明反被聪明误", score: 15, color: "#ff9f43", emoji: "🟧", blurb: "这个看似冷门的选择，其实也很容易被想到。" },
  schooler: { name: "随鱼而行", score: 30, color: "#4de3ff", emoji: "🐟", blurb: "答得不错。不过，鱼群也游在这里。" },
  rare: { name: "深海稀客", score: 60, color: "#ff5252", emoji: "🦑", blurb: "一个不常被想起的答案。继续向下。" },
  deepcut: { name: "深渊秘藏", score: 85, color: "#9d7bff", emoji: "🟪", blurb: "你找到了记忆深处的宝藏。" },
  krillion: { name: "万里挑一", score: 100, color: "#ffd166", emoji: "🌟", blurb: "这一题的海底珍宝，被你找到了。" },
};
const toSimplified = Converter({ from: "t", to: "cn" });
export function normalize(value) {
  // Keep internal punctuation: concatenating several guesses must never create a valid answer.
  const simplified = toSimplified(String(value).normalize("NFKC"));
  return simplified.trim().replace(/^[《〈「『“"']+|[》〉」』”"']+$/gu, "").replace(/\s+/gu, "").toLowerCase();
}

const indexes = new Map();
for (const q of QUESTIONS) {
  const index = new Map();
  for (const answer of q.answers) {
    for (const name of [answer.label, ...answer.aliases]) {
      const key = normalize(name);
      if (index.has(key) && index.get(key) !== answer) throw new Error(`Ambiguous answer in ${q.id}: ${name}`);
      index.set(key, answer);
    }
  }
  indexes.set(q.id, index);
}

export function judge(question, raw) {
  const answer = indexes.get(question.id)?.get(normalize(raw));
  return answer ? { answer: answer.label, tier: answer.tier, score: TIERS[answer.tier].score } : null;
}

export function suggest(question, raw) {
  const chars = [...normalize(raw)];
  if (chars.length < 3) return null;
  const matches = question.answers.filter((a) => {
    const label = [...normalize(a.label)];
    return label.length === chars.length && label.filter((c, i) => c !== chars[i]).length === 1;
  });
  return matches.length === 1 ? matches[0].label : null;
}

export function localDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export function selectQuestions(seed, pack = "all") {
  if (!Object.hasOwn(PACKS, pack)) throw new Error(`Unknown question pack: ${pack}`);
  let state = 2166136261;
  for (const char of `${BANK_VERSION}:${seed}`) state = Math.imul(state ^ char.codePointAt(0), 16777619) >>> 0;
  const pool = QUESTIONS.filter((q) => pack === "all" || PACKS[pack].categories.includes(q.category));
  for (let i = pool.length - 1; i > 0; i--) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const j = Math.floor(state / 4294967296 * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  // Spread daily topics before filling the remaining slots.
  const categories = new Set();
  const first = pool.filter((q) => !categories.has(q.category) && categories.add(q.category));
  return [...first, ...pool.filter((q) => !first.includes(q))].slice(0, ROUND_COUNT);
}

export function newDive(mode = "daily", date = localDate(), seed = date, pack = "all") {
  return { version: BANK_VERSION, mode, date, seed, pack, ids: selectQuestions(seed, pack).map((q) => q.id), results: [], deadline: null, phase: "ready" };
}

export function beginRound(dive, now = Date.now()) {
  if (!["ready", "feedback"].includes(dive.phase)) return dive;
  if (dive.results.length === ROUND_COUNT) return { ...dive, phase: "done", deadline: null };
  return { ...dive, phase: "playing", deadline: now + ROUND_MS };
}

export function submitAnswer(dive, raw, now = Date.now()) {
  if (dive.phase !== "playing") return { dive, error: "inactive" };
  const q = QUESTIONS.find((question) => question.id === dive.ids[dive.results.length]);
  const timedOut = now >= dive.deadline;
  const answer = timedOut ? null : judge(q, raw);
  if (!timedOut && !answer) return { dive, error: "unknown", suggestion: suggest(q, raw) };
  const result = { questionId: q.id, raw: String(raw).slice(0, 80), ...(answer ?? { answer: null, tier: "miss", score: 0 }), timedOut };
  return { dive: { ...dive, results: [...dive.results, result], deadline: null, phase: "feedback" }, result };
}

export function restoreDive(value) {
  if (!value || value.version !== BANK_VERSION || !["daily", "unlimited", "archive"].includes(value.mode) || !/^\d{4}-\d{2}-\d{2}$/.test(value.date) || typeof value.seed !== "string" || !Object.hasOwn(PACKS, value.pack)) return null;
  if (!["ready", "playing", "feedback", "done"].includes(value.phase) || !Array.isArray(value.results) || value.results.length > ROUND_COUNT) return null;
  const expected = selectQuestions(value.seed, value.pack).map((q) => q.id);
  if (JSON.stringify(value.ids) !== JSON.stringify(expected)) return null;
  for (const [i, result] of value.results.entries()) {
    if (!result || result.questionId !== expected[i] || typeof result.raw !== "string" || typeof result.timedOut !== "boolean") return null;
    const answer = result.timedOut ? { answer: null, tier: "miss", score: 0 } : judge(QUESTIONS.find((q) => q.id === expected[i]), result.raw);
    if (!answer || ["answer", "tier", "score"].some((key) => answer[key] !== result[key])) return null;
  }
  if (value.phase === "playing" && (!Number.isFinite(value.deadline) || value.results.length === ROUND_COUNT)) return null;
  if (value.phase === "done" && value.results.length !== ROUND_COUNT) return null;
  if (value.phase === "feedback" && value.results.length === 0) return null;
  if (value.phase === "ready" && value.results.length !== 0) return null;
  return value;
}

export function totalScore(dive) { return dive.results.reduce((sum, r) => sum + r.score, 0); }
export function rank(score) { return score >= 450 ? "krillion" : score >= 351 ? "deepcut" : score >= 251 ? "rare" : score >= 151 ? "schooler" : "plankton"; }
export function shareText(dive) {
  return `万里挑一 · ${dive.mode === "daily" ? "每日下潜" : dive.mode === "archive" ? "往日海域" : "自由下潜"}\n${dive.date} · ${totalScore(dive) * 10} 米 / 7000 米\n${dive.results.map((r) => TIERS[r.tier].emoji).join("")}\n7 道题，寻找记忆里的深海。`;
}
