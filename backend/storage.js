export class ServiceError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function configured() {
  return Boolean(process.env.SUPABASE_URL && (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY) && process.env.CRON_SECRET?.length >= 32);
}
export async function database(resource, { method = "GET", body, prefer } = {}) {
  if (!configured()) throw new ServiceError(503, "云端服务尚未配置。");
  const base = process.env.SUPABASE_URL.replace(/\/$/, "");
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  const headers = { apikey: key, "Content-Type": "application/json" };
  if (key.startsWith("eyJ")) headers.Authorization = `Bearer ${key}`;
  if (prefer) headers.Prefer = prefer;
  let response;
  try {
    response = await fetch(`${base}/rest/v1/${resource}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000) });
  } catch (error) {
    throw new ServiceError(503, error.name === "TimeoutError" ? "云端响应超时，请稍后重试。" : "暂时无法连接云端。");
  }
  if (!response.ok) throw new ServiceError(503, "云端记录服务暂时不可用。");
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}
export const rpc = (name, body) => database(`rpc/${name}`, { method: "POST", body });
