import { BASE_BANK, validateBank } from "./bank.js";
import { localDate } from "./game.js";

const OUTBOX = "krillion-zh:cloud-outbox";
const EXPOSED = "krillion-zh:exposed";
function readLocal(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { console.warn("Cloud cache could not be read."); return fallback; }
}
async function request(path, body) {
  let response;
  try {
    response = await fetch("/api/" + path, {
      method: body === undefined ? "GET" : "POST", credentials: "same-origin",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(5000), keepalive: body !== undefined,
    });
  } catch { throw new Error("暂时无法连接云端。"); }
  let result;
  try { result = await response.json(); } catch { throw new Error("云端记录服务暂时不可用。"); }
  if (!response.ok) { const error = new Error(result.error || "提交失败，请稍后重试。"); error.status = response.status; throw error; }
  return result;
}
export class CloudClient {
  constructor() {
    this.online = false;
    this.running = false;
    this.failures = 0;
    const stored = readLocal(OUTBOX, []);
    this.outbox = Array.isArray(stored) ? stored.filter(item => item && ["events", "feedback"].includes(item.kind)).slice(-200) : [];
    const exposed = readLocal(EXPOSED, {});
    this.exposedDate = localDate();
    this.exposed = new Set(exposed.date === this.exposedDate && exposed.baseVersion === BASE_BANK.baseVersion && Array.isArray(exposed.ids) ? exposed.ids : []);
    window.addEventListener("online", () => { this.failures = 0; void (this.online ? this.flush() : this.latest()); });
    document.addEventListener("visibilitychange", () => { if (document.hidden) void this.flush(); });
  }
  save() {
    try { localStorage.setItem(OUTBOX, JSON.stringify(this.outbox)); }
    catch { console.warn("Pending cloud records could not be saved locally."); }
  }
  expose(ids) {
    this.refreshExposure();
    for (const id of ids) this.exposed.add(id);
    try { localStorage.setItem(EXPOSED, JSON.stringify({ date: localDate(), baseVersion: BASE_BANK.baseVersion, ids: [...this.exposed] })); }
    catch { console.warn("Answer exposure state could not be saved."); }
  }
  refreshExposure() {
    const date = localDate();
    if (date !== this.exposedDate) { this.exposedDate = date; this.exposed.clear(); }
  }
  async latest() {
    try {
      const result = await request("bank");
      const bank = validateBank(result.bank);
      this.online = result.online === true;
      if (this.online) { this.failures = 0; void this.flush(); }
      return bank;
    } catch (error) {
      this.online = false;
      console.warn("Using the saved question bank:", error.message);
      return null;
    }
  }
  async register(dive) {
    if (!this.online) return null;
    try {
      const result = await request("session", { version: dive.version, mode: dive.mode, seed: dive.seed, date: dive.date, pack: dive.pack });
      return { token: result.token, attempts: Array(7).fill(0) };
    } catch (error) {
      console.warn("This dive will remain local:", error.message);
      return null;
    }
  }
  capture(dive, raw, timedOut, elapsedMs) {
    if (typeof dive.telemetry?.token !== "string" || !Array.isArray(dive.telemetry.attempts) || (!raw.trim() && !timedOut)) return;
    this.refreshExposure();
    const round = dive.results.length, attempt = dive.telemetry.attempts[round] ?? 0;
    if (round > 6 || !Number.isInteger(attempt) || attempt < 0 || attempt > 30) return;
    dive.telemetry.attempts[round] = attempt + 1;
    this.outbox.push({ kind: "events", token: dive.telemetry.token, event: {
      round, attempt, raw: raw.slice(0, 80), timedOut, elapsedMs: Math.max(0, Math.min(25000, Math.round(elapsedMs))),
      spoiled: this.exposed.has(dive.ids[round]),
    } });
    this.outbox = this.outbox.slice(-200);
    this.save();
    void this.flush();
  }
  async flush() {
    if (this.running || !this.online || !this.outbox.length) return;
    this.running = true;
    try {
      while (this.outbox.length) {
        const first = this.outbox[0];
        const group = first.kind === "events" ? this.outbox.filter(item => item.kind === "events" && item.token === first.token).slice(0, 20) : [first];
        try {
          await request(first.kind, first.kind === "events" ? { token: first.token, events: group.map(item => item.event) } : first.body);
        } catch (error) {
          if (![400, 401, 404, 413].includes(error.status)) throw error;
          console.warn("An expired or invalid cloud record was discarded:", error.message);
        }
        this.outbox = this.outbox.filter(item => !group.includes(item));
        this.save();
      }
      this.failures = 0;
    } catch (error) {
      if (this.failures === 0) console.warn("Cloud records remain queued:", error.message);
      if (this.failures++ < 4) setTimeout(() => void this.flush(), Math.min(60000, 3000 * 2 ** this.failures));
    } finally { this.running = false; }
  }
  async feedback(body) {
    const item = { kind: "feedback", body };
    this.outbox.push(item);
    this.outbox = this.outbox.slice(-200);
    this.save();
    const result = await request("feedback", body);
    this.online = true;
    this.outbox = this.outbox.filter(entry => entry !== item);
    this.save();
    return result;
  }
}
