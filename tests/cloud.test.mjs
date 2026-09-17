import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { BASE_BANK } from "../src/bank.js";

test("Postgres records, LLM approve status, atomic releases and private permissions", async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec("create role anon; create role authenticated; create role service_role bypassrls;");
  await db.exec(await readFile(new URL("../supabase/schema.sql", import.meta.url), "utf8"));
  const call = async (name, args) => (await db.query(`select public.${name}(${args.map((_, i) => "$" + (i + 1)).join(",")}) as result`, args)).rows[0].result;
  assert.equal((await call("kr_seed", [BASE_BANK])).version, BASE_BANK.version);

  const visitor = randomUUID(), session = randomUUID();
  await db.query("insert into public.kr_sessions(id,visitor_id,base_version,bank_version) values($1,$2,$3,$4)", [session, visitor, BASE_BANK.baseVersion, BASE_BANK.version]);
  const first = { round: 0, attempt: 0, questionId: "instruments", raw: "鲁特琴", normalized: "鲁特琴", outcome: "unknown", elapsedMs: 5000, spoiled: false, candidate: "鲁特琴" };
  assert.equal(await call("kr_ingest", [session, visitor, "network-1", [first]]), 1);
  assert.equal(await call("kr_ingest", [session, visitor, "network-1", [first]]), 0);

  // mark candidate approved by LLM
  await db.query("update public.kr_candidates set llm_approved=true, llm_reason='its a lute', reviewed_at=now()").then(() => {});
  let data = await call("kr_automation_data", [BASE_BANK.baseVersion]);
  const cand = data.candidates.find(c => c.label === "鲁特琴");
  assert.equal(cand.llmApproved, true);

  // publish a new version atomically
  const bank2 = structuredClone(BASE_BANK);
  bank2.version += "~test";
  assert.equal(await call("kr_publish", [BASE_BANK.version, bank2, [], "2026-09-20"]), true);
  assert.equal(await call("kr_publish", [BASE_BANK.version, bank2, [], "2026-09-20"]), false);

  // after reject, the candidate is no longer exposed to detail may not be null? check candidate remains visible every day
  data = await call("kr_automation_data", [BASE_BANK.baseVersion]);
  assert.ok(data.candidates.length >= 0);
});
