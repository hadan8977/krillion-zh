import { Converter } from "../vendor/opencc-js/t2cn.js";

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
  const simplified = toSimplified(String(value).normalize("NFKC"));
  return simplified.trim().replace(/^[《〈「『“"']+|[》〉」』”"']+$/gu, "").replace(/\s+/gu, "").toLowerCase();
}
export function answerIndex(question) {
  const index = new Map();
  for (const answer of question.answers) {
    for (const name of [answer.label, ...answer.aliases]) {
      const key = normalize(name);
      if (index.has(key) && index.get(key) !== answer) throw new Error(`Ambiguous answer in ${question.id}: ${name}`);
      index.set(key, answer);
    }
  }
  return index;
}
