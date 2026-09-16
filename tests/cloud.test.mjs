import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { BASE_BANK } from "../src/bank.js";

test("Postgres records, sample deduplication, review eligibility, atomic releases and private permissions", async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec("create role anon; create role authenticated; create role service_role bypassrls;");
  const schema = await readFile(new URL("../supabase/schema.sql", import.meta.url), "utf8");
  await db.exec(schema);
  await db.exec(schema);
  const call = async (name, args) => (await db.query(`select public.${name}(${args.map((_, i) => "$" + (i + 1)).join(",")}) as result`, args)).rows[0].result;
  assert.equal((await call("kr_seed", [BASE_BANK])).version, BASE_BANK.version);
  const visitor = randomUUID(), session = randomUUID();
  await db.query("insert into public.kr_sessions(id,visitor_id,base_version,bank_version) values($1,$2,$3,$4)", [session, visitor, BASE_BANK.baseVersion, BASE_BANK.version]);
  const first = { round: 0, attempt: 0, questionId: "instruments", raw: "鲁特琴", normalized: "鲁特琴", outcome: "unknown", elapsedMs: 5000, spoiled: false, candidate: "鲁特琴" };
  assert.equal(await call("kr_ingest", [session, visitor, "network-1", [first]]), 1);
  assert.equal(await call("kr_ingest", [session, visitor, "network-1", [first]]), 0);
  assert.equal(await call("kr_ingest", [session, visitor, "network-1", [{ ...first, attempt: 1, raw: "钢琴", normalized: "钢琴", outcome: "matched", candidate: null }]]), 1);
  await assert.rejects(call("kr_ingest", [session, randomUUID(), "other", [first]]), /invalid_session/);
  const otherSession = randomUUID();
  await db.query("insert into public.kr_sessions(id,visitor_id,base_version,bank_version) values($1,$2,$3,$4)", [otherSession, visitor, BASE_BANK.baseVersion, BASE_BANK.version]);
  await call("kr_ingest", [otherSession, visitor, "network-1", [{ ...first, raw: "吉他", normalized: "吉他", outcome: "matched", candidate: null }]]);
  let data = await call("kr_automation_data", [BASE_BANK.baseVersion]);
  assert.deepEqual(data.observations, [{ questionId: "instruments", normalized: "鲁特琴", count: 1 }]);
  assert.equal(data.candidates[0].submitters, 1);
  assert.equal(await call("kr_issue_review", [BASE_BANK.baseVersion, visitor]), null);
  for (let n = 0; n < 4; n++) {
    const submitter = randomUUID(), game = randomUUID();
    await db.query("insert into public.kr_sessions(id,visitor_id,base_version,bank_version) values($1,$2,$3,$4)", [game, submitter, BASE_BANK.baseVersion, BASE_BANK.version]);
    await call("kr_ingest", [game, submitter, "network-" + n, [first]]);
  }
  await db.query("update public.kr_attempts set created_at=now()-interval '1 day' where session_id=$1", [session]);
  const reviewer = randomUUID(), reviewSession = randomUUID();
  await db.query("insert into public.kr_sessions(id,visitor_id,base_version,bank_version) values($1,$2,$3,$4)", [reviewSession, reviewer, BASE_BANK.baseVersion, BASE_BANK.version]);
  await call("kr_ingest", [reviewSession, reviewer, "review-network", [0,1,2].map((round, i) => ({
    ...first, round, questionId: ["fruits","shoes","bedding"][i], raw: "known", normalized: "known", outcome: "matched", candidate: null,
  }))]);
  const ticket = await call("kr_issue_review", [BASE_BANK.baseVersion, reviewer]);
  assert.equal(ticket.label, "鲁特琴");
  assert.equal(await call("kr_cast_review", [ticket.ticket, visitor, "own-network", true]), false);
  assert.equal(await call("kr_cast_review", [ticket.ticket, reviewer, "review-network", true]), true);
  assert.equal(await call("kr_cast_review", [ticket.ticket, reviewer, "review-network", true]), true);
  data = await call("kr_automation_data", [BASE_BANK.baseVersion]);
  assert.equal(data.candidates[0].submitters, 5);
  assert.equal(data.candidates[0].days, 2);
  assert.equal(data.candidates[0].yes, 1);
  assert.equal(await call("kr_issue_review", [BASE_BANK.baseVersion, reviewer]), null);
  const secondReviewer = randomUUID(), secondGame = randomUUID();
  await db.query("insert into public.kr_sessions(id,visitor_id,base_version,bank_version) values($1,$2,$3,$4)", [secondGame, secondReviewer, BASE_BANK.baseVersion, BASE_BANK.version]);
  await call("kr_ingest", [secondGame, secondReviewer, "second-review-network", [0,1,2].map((round, i) => ({
    ...first, round, questionId: ["fruits","shoes","bedding"][i], raw: "known", normalized: "known", outcome: "matched", candidate: null,
  }))]);
  const secondTicket = await call("kr_issue_review", [BASE_BANK.baseVersion, secondReviewer]);
  const feedback = { id: randomUUID(), visitor_id: secondReviewer, network_key: "second-review-network", base_version: BASE_BANK.baseVersion,
    bank_version: BASE_BANK.version, question_id: "instruments", kind: "missing", answer: "鲁特琴", normalized: "鲁特琴", note: "一种拨弦乐器", candidate: "鲁特琴" };
  assert.equal(await call("kr_record_feedback", [feedback]), true);
  assert.equal(await call("kr_record_feedback", [feedback]), true);
  assert.equal((await db.query("select count(*)::integer as n from public.kr_feedback")).rows[0].n, 1);
  assert.equal(await call("kr_cast_review", [secondTicket.ticket, secondReviewer, "second-review-network", true]), false);
  assert.equal(await call("kr_issue_review", [BASE_BANK.baseVersion, secondReviewer]), null);
  data = await call("kr_automation_data", [BASE_BANK.baseVersion]);
  assert.equal(data.candidates[0].submitters, 6);
  assert.equal(data.candidates[0].yes, 1);
  assert.equal(await call("kr_rate_limit", ["test-limit", 2, 600]), true);
  assert.equal(await call("kr_rate_limit", ["test-limit", 2, 600]), true);
  assert.equal(await call("kr_rate_limit", ["test-limit", 2, 600]), false);
  const next = { ...BASE_BANK, version: BASE_BANK.version + "~r1" };
  assert.equal(await call("kr_publish", [BASE_BANK.version, next, [], "2026-09-20"]), true);
  assert.equal(await call("kr_publish", [BASE_BANK.version, { ...next, version: next.version + "conflict" }, [], "2026-09-20"]), false);
  assert.equal(await call("kr_publish", [next.version, next, [], "2026-09-20"]), false);
  assert.equal((await call("kr_seed", [BASE_BANK])).version, next.version);
  assert.equal((await db.query("select count(*)::integer as n from public.kr_banks")).rows[0].n, 2);
  await db.exec("set role anon");
  await assert.rejects(db.query("select * from public.kr_attempts"), /permission denied/);
  await assert.rejects(call("kr_seed", [BASE_BANK]), /permission denied/);
  await db.exec("reset role");
});
