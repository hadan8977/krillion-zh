import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { BASE_BANK } from "../src/bank.js";
import { createGameEngine, localDate } from "../src/game.js";
import { cloudFixture } from "./support/cloud-fixture.mjs";
import { endpoint } from "../backend/http.js";

test("Chinese JSON survives UTF-8 transport boundaries and oversized bodies are rejected", async () => {
  const bytes = Buffer.from(JSON.stringify({ answer: "鲁特琴" }));
  const split = bytes.indexOf(Buffer.from("鲁")) + 1;
  for (const [body, expected] of [[undefined, 200], [bytes, 200], ["x".repeat(24001), 413]]) {
    const request = Readable.from([bytes.subarray(0, split), bytes.subarray(split)]);
    Object.assign(request, { body, method: "POST", url: "/api/test", headers: { host: "127.0.0.1", origin: "http://127.0.0.1", "content-type": "application/json" } });
    let result;
    const response = { setHeader() {}, end(text) { result = JSON.parse(text); } };
    await endpoint(["POST"], context => context.body)(request, response);
    assert.equal(response.statusCode, expected);
    if (expected === 200) assert.deepEqual(result, { answer: "鲁特琴" });
  }
});

test("HTTP collection, signed identity, server adjudication, feedback and protected scheduled updates", async t => {
  const fixture = await cloudFixture();
  t.after(() => fixture.close());
  let cookie = "";
  async function request(path, body, headers = {}) {
    const response = await fetch(fixture.url + "/api/" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json", Origin: fixture.url, Cookie: cookie, ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (response.headers.has("set-cookie")) cookie = response.headers.get("set-cookie").split(";")[0];
    return { status: response.status, body: await response.json(), headers: response.headers };
  }
  const initialFeedback = await request("feedback", { id: randomUUID(), version: BASE_BANK.version, questionId: null, kind: "general", answer: "", note: "First visit" });
  assert.equal(initialFeedback.status, 200);
  assert.match(initialFeedback.headers.get("set-cookie"), /HttpOnly; SameSite=Lax/);
  const current = await request("bank");
  assert.equal(current.body.online, true);
  assert.equal(current.body.bank.version, BASE_BANK.version);
  assert.equal(current.headers.get("cache-control"), "no-store");
  const dive = createGameEngine().newDive("unlimited", localDate(), "api-fixture");
  assert.equal((await request("session", dive, { Origin: "https://foreign.invalid" })).status, 403);
  const started = await request("session", dive);
  assert.equal(started.status, 200);
  const token = started.body.token, q = BASE_BANK.questions.find(question => question.id === dive.ids[0]);
  const event = { round: 0, attempt: 0, raw: q.answers[0].label, spoiled: false, timedOut: false, elapsedMs: 1500, score: 999, questionId: "forged" };
  assert.equal((await request("events", { token: token + "x", events: [event] })).status, 401);
  assert.equal((await request("events", { token, events: [event] }, { Cookie: "" })).status, 401);
  assert.deepEqual((await request("events", { token, events: [event] })).body, { recorded: 1 });
  assert.deepEqual((await request("events", { token, events: [event] })).body, { recorded: 0 });
  const stored = (await fixture.db.query("select question_id,raw,outcome,elapsed_ms from public.kr_attempts")).rows;
  assert.deepEqual(stored, [{ question_id: q.id, raw: q.answers[0].label, outcome: "matched", elapsed_ms: 1500 }]);
  assert.equal((await request("events", { token, events: [{ ...event, raw: "x".repeat(81) }] })).status, 400);
  assert.equal((await request("events", { token, events: [{ ...event, round: 7 }] })).status, 400);
  assert.equal((await request("events", { token, events: [{ ...event, attempt: 1, raw: "name@example.com" }] })).status, 200);
  assert.deepEqual((await fixture.db.query("select raw,normalized from public.kr_attempts where attempt_index=1")).rows[0], { raw: "", normalized: "" });
  const feedback = { id: randomUUID(), version: dive.version, questionId: "instruments", kind: "missing", answer: "鲁特琴", note: "这是一种拨弦乐器。联系 name@example.com" };
  assert.equal((await request("feedback", feedback)).body.recorded, true);
  assert.equal((await request("feedback", feedback)).body.recorded, true);
  const records = (await fixture.db.query("select answer,note from public.kr_feedback where kind='missing'")).rows;
  assert.deepEqual(records, [{ answer: "鲁特琴", note: "这是一种拨弦乐器。联系 [已省略联系方式]" }]);
  assert.equal((await fixture.db.query("select label from public.kr_candidates where question_id='instruments'")).rows[0].label, "鲁特琴");
  assert.equal((await request("feedback", { ...feedback, questionId: "invalid" })).status, 400);
  assert.equal((await request("review")).body.candidate, null);
  assert.equal((await request("refresh")).status, 401);
  const refresh = await request("refresh", undefined, { Authorization: `Bearer ${fixture.secret}` });
  assert.equal(refresh.status, 200);
  assert.equal(refresh.body.updated, false);
  assert.equal((await request("refresh", undefined, { Authorization: `Bearer ${fixture.secret}` })).body.reason, "already-refreshed");
  assert.equal(JSON.stringify(current.body).includes(fixture.secret), false);
  const secret = process.env.SUPABASE_SECRET_KEY;
  delete process.env.SUPABASE_SECRET_KEY;
  assert.equal((await request("bank")).body.online, false);
  assert.equal((await request("session", dive)).status, 503);
  process.env.SUPABASE_SECRET_KEY = secret;
});
