import test from "node:test";
import assert from "node:assert/strict";
import { BASE_BANK, validateBank } from "../src/bank.js";
import { createGameEngine } from "../src/game.js";
import { approvedCandidate, candidateName, knownAlias, recalibrate, wilsonLower } from "../backend/automation.js";

const candidate = { questionId: "instruments", normalized: "鲁特琴", label: "鲁特琴", submitters: 3, days: 2, llmApproved: true };
test("automatic additions need LLM approval, enough submitters and day spread", () => {
  assert.ok(approvedCandidate(candidate));
  for (const change of [{ llmApproved: false }, { submitters: 2 }, { days: 1 }]) assert.equal(approvedCandidate({ ...candidate, ...change }), false);
  for (const raw of ["<script>", "a@example.com", "13812345678", "钢琴、吉他", ""]) assert.equal(candidateName(raw), null);
  const result = recalibrate(BASE_BANK, [], [candidate], new Date("2026-09-20T00:00:00Z"));
  const answer = result.bank.questions.find(q => q.id === "instruments").answers.find(a => a.label === "鲁特琴");
  assert.deepEqual(answer, { label: "鲁特琴", aliases: [], tier: "schooler", addedAt: "2026-09-20T00:00:00.000Z", origin: "community" });
  assert.equal(recalibrate(result.bank, [], [candidate]).changes.length, 0);
  assert.ok(!BASE_BANK.questions.find(q => q.id === "instruments").answers.some(a => a.label === "鲁特琴"));
});
test("a known grammatical wrapper can produce an automatic alias without LLM", () => {
  const question = BASE_BANK.questions.find(q => q.id === "instruments");
  assert.equal(knownAlias(question, "一架钢琴"), "钢琴");
  assert.equal(knownAlias(question, "钢琴吉他"), null);
  assert.equal(knownAlias(question, "钢亲"), null);
  const { bank, changes } = recalibrate(BASE_BANK, [], [{ ...candidate, normalized: "一架钢琴", label: "一架钢琴", submitters: 3, llmApproved: false }]);
  assert.equal(changes[0].type, "alias");
  const engine = createGameEngine(bank);
  assert.deepEqual(engine.judge(question, "一架钢琴"), engine.judge(question, "钢琴"));
});
test("low samples keep scores stable; enough samples update gradually with one gem", () => {
  const few = [{ questionId: "instruments", normalized: "特雷门琴", count: 29 }];
  assert.equal(recalibrate(BASE_BANK, few, []).changes.length, 0);
  const { bank, changes } = recalibrate(BASE_BANK, [{ ...few[0], count: 100 }], []);
  assert.ok(changes.some(c => c.type === "tier"));
  const q = bank.questions.find(q => q.id === "instruments");
  assert.equal(q.answers.find(a => a.label === "特雷门琴").tier, "deepcut");
  assert.equal(q.answers.filter(a => a.tier === "krillion").length, 1);
  const original = BASE_BANK.questions.find(item => item.id === q.id);
  for (const answer of original.answers.filter(a => a.tier === "tooclever")) assert.equal(q.answers.find(a => a.label === answer.label).tier, "tooclever");
  assert.equal(validateBank(bank), bank);
});
test("score releases leave daily question selection and existing dive scores unchanged", () => {
  const old = createGameEngine();
  const original = old.newDive("daily", "2026-09-20");
  const changed = structuredClone(BASE_BANK);
  changed.version += "~test";
  const question = changed.questions.find(q => q.id === original.ids[0]);
  question.answers[0].tier = "schooler";
  const newer = createGameEngine(changed);
  assert.deepEqual(newer.newDive("daily", "2026-09-20").ids, original.ids);
  const played = old.submitAnswer(old.beginRound(original, 1000), question.answers[0].label, 2000).dive;
  assert.equal(played.results[0].score, 10);
  assert.equal(old.restoreDive(played).results[0].score, 10);
  assert.equal(newer.restoreDive(played), null);
  assert.equal(newer.judge(question, question.answers[0].label).score, 30);
});
test("remote bank validation rejects alias collisions, changed categories and injected names", () => {
  const reordered = structuredClone(BASE_BANK);
  for (const q of reordered.questions) if (q.source) q.source = { url: q.source.url, title: q.source.title };
  assert.equal(validateBank(reordered), reordered);
  for (const mutate of [
    b => b.questions[0].answers[1].aliases.push(b.questions[0].answers[0].label),
    b => b.questions[0].prompt = "Different category",
    b => b.questions[0].answers[0].label = "<img>",
    b => b.questions[0].answers[0].tier = "krillion",
  ]) {
    const bank = structuredClone(BASE_BANK);
    mutate(bank);
    assert.throws(() => validateBank(bank));
  }
});
