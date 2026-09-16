import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { ServiceError, configured, rpc } from "./storage.js";

const seconds = () => Math.floor(Date.now() / 1000);
export const uuid = value => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export const secretEqual = (a, b) => timingSafeEqual(createHash("sha256").update(String(a)).digest(), createHash("sha256").update(String(b)).digest());
function mac(text) { return createHmac("sha256", process.env.CRON_SECRET).update(text).digest("base64url"); }
export function signToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${mac(body)}`;
}
export function readToken(raw, purpose) {
  if (typeof raw !== "string" || raw.length > 3000 || !configured()) return null;
  const [body, signature, extra] = raw.split(".");
  if (!body || !signature || extra || !secretEqual(signature, mac(body))) return null;
  try {
    const value = JSON.parse(Buffer.from(body, "base64url").toString());
    return value.purpose === purpose && Number.isFinite(value.exp) && value.exp > seconds() ? value : null;
  } catch { return null; }
}
export function visitor(context, create = false) {
  const raw = String(context.request.headers.cookie || "").split(/;\s*/).find(item => item.startsWith("kr_visitor="))?.slice(11);
  const existing = readToken(raw, "visitor");
  if (existing && uuid(existing.id)) return existing.id;
  if (!create) throw new ServiceError(401, "请先开始一局游戏，再提交。");
  if (!configured()) throw new ServiceError(503, "云端服务尚未配置。");
  const id = randomUUID(), token = signToken({ purpose: "visitor", id, exp: seconds() + 30 * 86400 });
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(context.request.headers.host || "");
  context.response.setHeader("Set-Cookie", `kr_visitor=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${local ? "" : "; Secure"}`);
  return id;
}
export function networkKey(request) {
  const address = process.env.VERCEL ? String(request.headers["x-vercel-forwarded-for"] || request.headers["x-forwarded-for"] || request.socket?.remoteAddress || "").split(",")[0].trim() : request.socket?.remoteAddress || "local";
  return mac(`network:${new Date().toISOString().slice(0, 10)}:${address}`);
}
export async function rateLimit(context, operation, limit, windowSeconds) {
  if (!configured()) throw new ServiceError(503, "云端服务尚未配置。");
  const allowed = await rpc("kr_rate_limit", { p_key: `${operation}:${networkKey(context.request)}`, p_limit: limit, p_seconds: windowSeconds });
  if (!allowed) throw new ServiceError(429, "提交过于频繁，请稍后再试。");
}
async function jsonBody(request) {
  if (!String(request.headers["content-type"] || "").startsWith("application/json")) throw new ServiceError(415, "请以 JSON 格式提交。");
  if (Number(request.headers["content-length"] || 0) > 24000) throw new ServiceError(413, "提交内容过长。");
  if (request.body !== undefined && typeof request.body === "object" && !Buffer.isBuffer(request.body)) {
    if (Buffer.byteLength(JSON.stringify(request.body)) > 24000) throw new ServiceError(413, "提交内容过长。");
    return request.body;
  }
  const chunks = [];
  let size = 0;
  if (typeof request.body === "string" || Buffer.isBuffer(request.body)) chunks.push(Buffer.from(request.body));
  else for await (const chunk of request) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > 24000) throw new ServiceError(413, "提交内容过长。");
    chunks.push(bytes);
  }
  const bytes = Buffer.concat(chunks);
  if (bytes.length > 24000) throw new ServiceError(413, "提交内容过长。");
  const text = bytes.toString("utf8");
  try { return JSON.parse(text); } catch { throw new ServiceError(400, "提交内容格式有误。"); }
}
export function endpoint(methods, action) {
  return async (request, response) => {
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    try {
      if (!methods.includes(request.method)) { response.setHeader("Allow", methods.join(", ")); throw new ServiceError(405, "不支持该请求方式。"); }
      if (request.method === "POST") {
        const host = request.headers.host || "";
        const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
        const expected = `${local ? "http" : "https"}://${host}`;
        if (request.headers.origin !== expected) throw new ServiceError(403, "请从游戏页面提交。");
      }
      const context = { request, response, body: request.method === "POST" ? await jsonBody(request) : null, url: new URL(request.url, "http://localhost") };
      const result = await action(context);
      response.statusCode = 200;
      response.end(JSON.stringify(result));
    } catch (error) {
      response.statusCode = error instanceof ServiceError ? error.status : 500;
      if (!(error instanceof ServiceError)) console.error("Game API failed:", error.name);
      response.end(JSON.stringify({ error: error instanceof ServiceError ? error.message : "服务暂时不可用，请稍后重试。" }));
    }
  };
}
