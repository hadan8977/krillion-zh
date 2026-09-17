import { createHash, randomUUID } from "node:crypto";
import { BASE_BANK, validateBank } from "../src/bank.js";
import { createGameEngine, localDate, normalize } from "../src/game.js";
import { PACKS } from "../src/questions.js";
import { candidateName, recalibrate } from "./automation.js";
import { llmConfigured, reviewCandidate } from "./llm_review.js";
import { configured, database, rpc, ServiceError } from "./storage.js";
import { networkKey, rateLimit, readToken, secretEqual, signToken, uuid, visitor } from "./http.js";

const versions = new Map();
let latestCache = null;
function remember(bank) {
  validateBank(bank);
  versions.set(bank.version, { bank, engine: createGameEngine(bank) });
  if (versions.size > 5) versions.delete(versions.keys().next().value);
  return versions.get(bank.version);
}
async function currentBank() {
  if (latestCache && latestCache.expires > Date.now()) return latestCache.bank;
  const channel = await database(`kr_channels?${new URLSearchParams({ base_version: `eq.${BASE_BANK.baseVersion}`, select: "current_version" })}`);
  const bank = channel.length ? (await bankVersion(channel[0].current_version)).bank : await rpc("kr_seed", { p_bank: BASE_BANK });
  remember(bank);
  latestCache = { bank, expires: Date.now() + 30000 };
  return bank;
}
async function bankVersion(version) {
  if (typeof version !== "string" || version.length > 120 || !version.startsWith(BASE_BANK.baseVersion)) throw new ServiceError(400, "题库版本无效。");
  if (versions.has(version)) return versions.get(version);
  const result = await database(`kr_banks?${new URLSearchParams({ version: `eq.${version}`, select: "body" })}`);
  if (!result.length) throw new ServiceError(404, "找不到这份题库，请重新开始。");
  return remember(result[0].body);
}
export async function bank(context) {
  if (!configured()) return { online: false, bank: BASE_BANK };
  const version = context.url.searchParams.get("version");
  return { online: true, bank: version ? (await bankVersion(version)).bank : await currentBank() };
}
export async function session(context) {
  await rateLimit(context, "session", 40, 3600);
  const id = visitor(context, true), input = context.body;
  if (!input || !["daily", "unlimited", "archive"].includes(input.mode) || !Object.hasOwn(PACKS, input.pack) ||
      typeof input.seed !== "string" || input.seed.length > 128 || !/^\d{4}-\d{2}-\d{2}$/.test(input.date) ||
      !Number.isFinite(Date.parse(input.date)) || (input.mode !== "unlimited" && input.seed !== input.date)) throw new ServiceError(400, "下潜信息不完整。");
  await currentBank();
  const rules = await bankVersion(input.version);
  const sid = randomUUID(), exp = Math.floor(Date.now() / 1000) + 2 * 86400;
  await database("kr_sessions", { method: "POST", body: { id: sid, visitor_id: id, base_version: BASE_BANK.baseVersion, bank_version: rules.bank.version } });
  const token = signToken({ purpose: "session", id: sid, visitor: id, version: rules.bank.version, mode: input.mode, seed: input.seed, date: input.date, pack: input.pack, exp });
  return { token };
}
export async function events(context) {
  await rateLimit(context, "events", 100, 60);
  const id = visitor(context), input = context.body, ticket = readToken(input?.token, "session");
  if (!ticket || ticket.visitor !== id || !uuid(ticket.id)) throw new ServiceError(401, "这次下潜的记录凭据已过期。");
  if (!Array.isArray(input.events) || input.events.length < 1 || input.events.length > 20) throw new ServiceError(400, "答题记录格式有误。");
  const { engine } = await bankVersion(ticket.version);
  const chosen = engine.selectQuestions(ticket.seed, ticket.pack);
  const rows = input.events.map(item => {
    if (!item || !Number.isInteger(item.round) || item.round < 0 || item.round > 6 ||
        !Number.isInteger(item.attempt) || item.attempt < 0 || item.attempt > 30 ||
        typeof item.raw !== "string" || item.raw.length > 80 || typeof item.spoiled !== "boolean" ||
        typeof item.timedOut !== "boolean" || !Number.isInteger(item.elapsedMs) || item.elapsedMs < 0 || item.elapsedMs > 25000) throw new ServiceError(400, "答题记录格式有误。");
    const q = chosen[item.round];
    // Do not retain likely credentials, contact details, or arbitrary pasted prose.
    const raw = /@|https?:\/\/|(?:\d[ -]*){7,}|(?:ghp_|sk-|sb_secret_)/i.test(item.raw) ? "" : item.raw;
    const normalized = normalize(raw);
    if (normalized.length > 80) throw new ServiceError(400, "答案规范化后过长。");
    const accepted = item.timedOut ? null : engine.judge(q, raw);
    const outcome = item.timedOut ? "timeout" : accepted ? "matched" : "unknown";
    return { round: item.round, attempt: item.attempt, questionId: q.id, raw, normalized, outcome,
      elapsedMs: item.elapsedMs, spoiled: item.spoiled, candidate: outcome === "unknown" ? candidateName(raw) : null };
  });
  const inserted = await rpc("kr_ingest", { p_session: ticket.id, p_visitor: id, p_network: networkKey(context.request), p_events: rows });
  return { recorded: inserted };
}
export async function feedback(context) {
  await rateLimit(context, "feedback", 8, 600);
  const id = visitor(context, true), input = context.body;
  if (!input || !uuid(input.id) || !["missing", "incorrect", "score", "general"].includes(input.kind) ||
      typeof input.note !== "string" || !input.note.trim() || input.note.length > 1000 ||
      typeof input.answer !== "string" || input.answer.length > 80) throw new ServiceError(400, "反馈内容不完整。");
  await currentBank();
  const { bank: rules, engine } = await bankVersion(input.version);
  if (input.questionId !== null && !rules.questions.some(q => q.id === input.questionId)) throw new ServiceError(400, "请选择对应的题目。");
  const redact = value => value.replace(/(?:ghp_|sk-|sb_secret_)[A-Za-z0-9_-]+/g, "[已省略]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[已省略联系方式]").replace(/(?:\d[ -]*){11,}/g, "[已省略号码]");
  const question = rules.questions.find(q => q.id === input.questionId), answer = redact(input.answer);
  const candidate = input.kind === "missing" && question && !engine.judge(question, answer) ? candidateName(answer) : null;
  await rpc("kr_record_feedback", { p_feedback: {
    id: input.id, visitor_id: id, network_key: networkKey(context.request), base_version: BASE_BANK.baseVersion,
    bank_version: rules.version, question_id: input.questionId, kind: input.kind, answer,
    normalized: normalize(answer), note: redact(input.note.trim()), candidate,
  } });
  return { recorded: true };
}
export async function refresh(context) {
  if (!configured() || !secretEqual(context.request.headers.authorization || "", `Bearer ${process.env.CRON_SECRET}`)) throw new ServiceError(401, "未获授权。");
  const current = await currentBank(), day = localDate();
  const channel = await database(`kr_channels?${new URLSearchParams({ base_version: `eq.${BASE_BANK.baseVersion}`, select: "refreshed_on" })}`);
  if (channel[0]?.refreshed_on >= day) return { updated: false, reason: "already-refreshed", version: current.version };
  const data = await rpc("kr_automation_data", { p_base: BASE_BANK.baseVersion });
  const { bank: next, changes } = await recalibrateWithLlm(current, data.observations, data.candidates);
  if (changes.length) {
    const digest = createHash("sha256").update(JSON.stringify(next.questions)).digest("hex").slice(0, 12);
    next.version = `${BASE_BANK.baseVersion}~${day}-${digest}`;
    next.updatedAt = new Date().toISOString();
    next.automatic = true;
  }
  validateBank(next);
  const published = await rpc("kr_publish", { p_expected: current.version, p_bank: next, p_changes: changes, p_day: day });
  latestCache = null;
  return { updated: published && changes.length > 0, version: published ? next.version : (await currentBank()).version, changes: published ? changes.length : 0 };
}

async function recalibrateWithLlm(current, observations, candidates) {
  if (!llmConfigured() || !candidates.length) return recalibrate(current, observations, candidates);
  const questions = current.questions;
  const questionById = new Map(questions.map(q => [q.id, q]));
  const reviewed = [];
  for (const candidate of candidates) {
    const question = questionById.get(candidate.questionId);
    if (!question || !candidateName(candidate.label)) continue;
    if (candidate.submitters < 3 || candidate.days < 2) continue;
    // Only review unreviewed candidates every day; previously approved candidates are kept.
    if (candidate.llmApproved === true) {
      reviewed.push(candidate);
      continue;
    }
    const verdict = await reviewCandidate(question, candidate.label, question.answers.flatMap(a => [a.label, ...a.aliases]));
    if (verdict?.approved) {
      reviewed.push({ ...candidate, llmApproved: true, llmReason: verdict?.reason });
      // Persist verdict so we don't re-review this entry tomorrow.
      const existing = await database(`kr_candidates?${new URLSearchParams({
        base_version: 'eq.' + BASE_BANK.baseVersion,
        question_id: 'eq.' + candidate.questionId,
        normalized: 'eq.' + candidate.normalized,
      })}`);
      if (existing.length) {
        await database(`kr_candidates?${new URLSearchParams({
          base_version: 'eq.' + BASE_BANK.baseVersion,
          question_id: 'eq.' + candidate.questionId,
          normalized: 'eq.' + candidate.normalized,
        })}`, { method: "PATCH", body: { llm_approved: true, llm_reason: verdict.reason, reviewed_at: new Date().toISOString() } });
      }
    } else if (verdict && !verdict.approved) {
      const existing = await database(`kr_candidates?${new URLSearchParams({
        base_version: 'eq.' + BASE_BANK.baseVersion,
        question_id: 'eq.' + candidate.questionId,
        normalized: 'eq.' + candidate.normalized,
      })}`);
      if (existing.length) {
        await database(`kr_candidates?${new URLSearchParams({
          base_version: 'eq.' + BASE_BANK.baseVersion,
          question_id: 'eq.' + candidate.questionId,
          normalized: 'eq.' + candidate.normalized,
        })}`, { method: "PATCH", body: { llm_approved: false, llm_reason: verdict?.reason || "rejected", reviewed_at: new Date().toISOString() } });
      }
    }
  }
  return recalibrate(current, observations, reviewed);
}

