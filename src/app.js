import { QUESTIONS, BANK_VERSION, PACKS } from "./questions.js";
import { ROUND_MS, ROUND_COUNT, TIERS, localDate, newDive, beginRound, submitAnswer, restoreDive, totalScore, rank, shareText } from "./game.js";
import { Ocean } from "./ocean.js";
import { DiveAudio } from "./audio.js";

const $ = (id) => document.getElementById(id);
const escape = (value) => String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
// A new bank must not overwrite the previous bank's answers or daily attempt.
const storageKey = (key) => ["settings", "corrections"].includes(key) ? `krillion-zh:${key}` : `krillion-zh:${BANK_VERSION}:${key}`;
let toastTimer, storageWarning = false, dive = null, composing = false, compositionEndedAt = 0, lastSecond = 25;
let landingTimer, nextTimer;
const queuedCorrections = [];

function toast(message) {
  $("toast").textContent = message;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $("toast").hidden = true; }, 5000);
}
function read(key, fallback = null) {
  try { const raw = localStorage.getItem(storageKey(key)); return raw === null ? fallback : JSON.parse(raw); }
  catch { if (!storageWarning) { storageWarning = true; toast("本地存档不可用或已损坏。此次游戏仍可游玩，但进度可能无法保存。"); } return fallback; }
}
function write(key, value) {
  try { localStorage.setItem(storageKey(key), JSON.stringify(value)); }
  catch { if (!storageWarning) { storageWarning = true; toast("浏览器未能保存进度，请保持页面开启。"); } }
}
const savedSettings = read("settings", {});
const settings = {
  muted: savedSettings?.muted === true,
  reducedMotion: typeof savedSettings?.reducedMotion === "boolean" ? savedSettings.reducedMotion : matchMedia("(prefers-reduced-motion: reduce)").matches,
  contrast: savedSettings?.contrast === true,
  character: savedSettings?.character === "krillion-gold" ? "krillion-gold" : "krillion",
};
const audio = new DiveAudio(toast);
const ocean = new Ocean($("ocean"), (depth) => { $("depth").innerHTML = `${depth.toLocaleString("zh-CN")}<small>米</small>`; });
function applySettings() {
  audio.setMuted(settings.muted);
  ocean.reducedMotion = settings.reducedMotion;
  ocean.character = settings.character;
  document.body.classList.toggle("motion-off", settings.reducedMotion);
  document.body.classList.toggle("high-contrast", settings.contrast);
  $("sound-button").innerHTML = `<svg viewBox="0 0 20 20" aria-hidden="true" fill="currentColor" shape-rendering="crispEdges"><path d="M2 7h4l5-4v14l-5-4H2z"/>${settings.muted ? '<path d="m14 6 2 2 2-2 1 1-2 3 2 3-1 1-2-2-2 2-1-1 2-3-2-3z"/>' : '<path d="M14 6h2v8h-2zM18 3h2v14h-2z"/>'}</svg>`;
  $("sound-button").setAttribute("aria-label", settings.muted ? "开启音效" : "关闭音效");
  $("sound-button").setAttribute("aria-pressed", String(!settings.muted));
  write("settings", settings);
}
applySettings();

function keyFor(value) { return value.mode === "unlimited" ? "unlimited" : `${value.mode}:${value.date}`; }
function persist() {
  if (!dive) return;
  write(keyFor(dive), dive);
  write("active", dive);
  if (dive.phase === "done") {
    const previous = read("history", []);
    const records = Array.isArray(previous) ? previous.filter((d) => restoreDive(d) && !(d.mode === dive.mode && d.seed === dive.seed && d.date === dive.date)) : [];
    write("history", [...records, dive].slice(-100));
  }
}

function home() {
  if (dive?.phase === "playing") {
    openModal("下潜正在进行", '<p>本题的 25 秒仍在计时。完成当前题目后，可以返回海面；刷新页面也会继续这次下潜。</p><button class="button-pink" data-action="close">继续答题</button>');
    return;
  }
  closeModal();
  clearTimeout(landingTimer); clearTimeout(nextTimer);
  dive = null;
  write("active", null);
  $("game").dataset.phase = "home";
  for (const id of ["hud", "question", "answer-form", "feedback", "next-dock", "results", "answer-status"]) $(id).hidden = true;
  $("hero").hidden = $("intro").hidden = false;
  const today = localDate();
  const saved = restoreDive(read(`daily:${today}`));
  $("begin").textContent = saved?.phase === "done" ? "▼ 查 看 今 日 潜 航 ▼" : saved ? "▼ 继 续 今 日 下 潜 ▼" : "▼ 开 始 下 潜 ▼";
  $("daily-date").textContent = `${today} · 每日一潜`;
  ocean.set("home", 0);
}

async function start(mode = "daily", date = localDate(), pack = "all") {
  if (dive?.phase === "playing") { toast("请先完成当前题目，计时仍在继续。"); return; }
  closeModal();
  clearTimeout(landingTimer); clearTimeout(nextTimer);
  const saved = mode !== "unlimited" ? restoreDive(read(`${mode}:${date}`)) : null;
  const seed = mode === "unlimited" ? crypto.randomUUID() : date;
  dive = saved || newDive(mode, date, seed, pack);
  await audio.unlock();
  if (dive.phase === "ready") { dive = beginRound(dive); audio.play("sink"); }
  persist(); render();
  if (dive.phase === "playing") $("answer").focus({ preventScroll: true });
}

function render() {
  if (!dive) return;
  const phase = dive.phase;
  const finished = phase === "done";
  $("game").dataset.phase = phase;
  $("hero").hidden = $("intro").hidden = true;
  $("hud").hidden = finished;
  $("question").hidden = phase !== "playing";
  $("answer-form").hidden = phase !== "playing";
  $("feedback").hidden = phase !== "feedback";
  $("next-dock").hidden = phase !== "feedback";
  $("results").hidden = !finished;
  $("answer-status").hidden = true;
  const current = Math.min(dive.results.length, ROUND_COUNT - 1);
  $("score").textContent = totalScore(dive);
  $("round-count").textContent = `${dive.mode === "daily" ? "每日" : dive.mode === "archive" ? "回溯" : "自由"} · ${Math.min(dive.results.length + (phase === "playing" ? 1 : 0), ROUND_COUNT)} / 7`;
  $("dots").innerHTML = Array.from({ length: ROUND_COUNT }, (_, i) => `<i class="${i === current && phase === "playing" ? "current" : ""}" ${dive.results[i] ? `style="background:${TIERS[dive.results[i].tier].color}"` : ""}></i>`).join("");
  ocean.set(phase, totalScore(dive) * 10);
  if (phase === "playing") {
    const q = QUESTIONS.find((item) => item.id === dive.ids[current]);
    $("prompt-number").textContent = `第 ${current + 1} / 7 题 · ${q.category}`;
    $("prompt-text").textContent = q.prompt;
    $("prompt-scope").textContent = q.scope;
    $("answer").value = "";
    lastSecond = 25;
    updateClock();
  } else if (phase === "feedback") {
    const result = dive.results.at(-1), tier = TIERS[result.tier];
    $("feedback").style.setProperty("--tier-color", tier.color);
    $("feedback").innerHTML = `<div class="eyebrow">第 ${dive.results.length} / 7 题 · ${result.timedOut ? "时间到了" : "答案已确认"}</div>
      ${result.tier === "miss" ? '<div class="depth-result">○</div>' : `<img src="./assets/${result.tier}.png" alt="">`}
      <h2>${tier.name}</h2><p class="accepted-answer">${result.answer ? escape(result.answer) : "这一题，未能下潜"}</p>
      <p class="points">+${result.score} 分 <span>↓ ${result.score * 10} 米</span></p><p class="blurb">${tier.blurb}</p>
      <button class="text-button" data-action="question-detail" data-id="${result.questionId}">看看其他答案 →</button>`;
    $("next").textContent = dive.results.length === ROUND_COUNT ? "查看潜航记录 ▼" : "继续下潜 ▼";
    $("next").disabled = false;
  } else if (finished) renderResults();
}

function updateClock() {
  if (dive?.phase !== "playing") return;
  const remaining = Math.max(0, dive.deadline - Date.now());
  const seconds = Math.ceil(remaining / 1000);
  $("seconds").textContent = seconds;
  $("seconds").parentElement.setAttribute("aria-label", `剩余 ${seconds} 秒`);
  $("fuse-fill").style.transform = `scaleX(${remaining / ROUND_MS})`;
  $("answer-form").classList.toggle("hot", seconds <= 5);
  if (seconds !== lastSecond && seconds > 0 && seconds <= 5) audio.play("tick");
  lastSecond = seconds;
  if (remaining === 0) commitAnswer($("answer").value);
}

function commitAnswer(raw) {
  if (dive?.phase !== "playing") return;
  const outcome = submitAnswer(dive, raw);
  if (outcome.error) {
    if (outcome.error === "unknown") {
      audio.play("reject");
      $("answer-status").hidden = false;
      $("answer-status").replaceChildren(document.createTextNode(raw.trim() ? "未匹配到题库中的答案，可以继续尝试。" : "先输入一个答案吧。"));
      if (outcome.suggestion) {
        const button = document.createElement("button");
        button.type = "button"; button.textContent = `改为“${outcome.suggestion}”`;
        button.onclick = () => { $("answer").value = outcome.suggestion; $("answer-status").hidden = true; $("answer").focus(); };
        $("answer-status").append(button);
      }
    }
    return;
  }
  const before = totalScore(dive) * 10;
  dive = outcome.dive;
  persist(); render();
  audio.play(outcome.result.tier === "miss" ? "miss" : "submit");
  if (outcome.result.score > 0) {
    ocean.depth = before;
    ocean.set("feedback", totalScore(dive) * 10, outcome.result.tier);
    audio.play("sink");
    landingTimer = setTimeout(() => audio.play(outcome.result.tier), 750);
  }
  $("next").disabled = !settings.reducedMotion;
  nextTimer = setTimeout(() => { $("next").disabled = false; if (!$("dialog").open) $("next").focus({ preventScroll: true }); }, settings.reducedMotion ? 0 : 1000);
}

function renderResults() {
  const score = totalScore(dive), tier = TIERS[rank(score)];
  $("results").innerHTML = `<div class="results-inner">
    <img class="results-mascot" src="./assets/${rank(score)}.png" alt="${tier.name}">
    <div class="eyebrow">${dive.date} · ${dive.mode === "daily" ? "每日下潜完成" : dive.mode === "archive" ? "往日海域完成" : "自由下潜完成"}</div>
    <h2 id="results-title">${tier.name}</h2><div class="depth-result">${(score * 10).toLocaleString("zh-CN")}<small> 米</small></div>
    <p class="result-subtitle">${score} / 700 分 · ${dive.results.filter((r) => r.score > 0).length} / 7 题答对<br>你的每一个答案，都在海里留下了回声。</p>
    <div class="depth-chart" aria-label="七题稀有度分布">${dive.results.map((r, i) => `<div class="chart-col" style="--drop:${Math.max(5, r.score * 1.25)}px;--color:${TIERS[r.tier].color}">${r.tier === "miss" ? '<span style="top:5px">○</span>' : `<img src="./assets/${r.tier}.png" alt="第${i + 1}题${TIERS[r.tier].name}">`}<span>${i + 1}</span></div>`).join("")}</div>
    <div class="result-actions"><button class="button-pink" data-action="share">分享潜航记录 ↗</button><button class="button-quiet" data-action="unlimited">再潜一次 ∞</button></div>
    <div class="result-rows">${dive.results.map((r, i) => {
      const q = QUESTIONS.find((item) => item.id === r.questionId);
      return `<div class="result-row" style="--color:${TIERS[r.tier].color}">${r.tier === "miss" ? "○" : `<img src="./assets/${r.tier}.png" alt="">`}<div><h3>${i + 1}. ${q.prompt}</h3><p>${escape(r.answer || "超时未答")} · <button data-action="question-detail" data-id="${q.id}">查看答案</button></p></div><strong>+${r.score}</strong></div>`;
    }).join("")}</div>
    <p class="source-note">当前稀有度为题库策划分级，尚未经过中文玩家群体校准。<br>成绩保存在此浏览器中。<button class="text-button" data-action="quality">了解题库 →</button></p>
    <button class="text-button" data-action="home">↑ 返回海面</button>
  </div>`;
  $("results").scrollTop = 0;
}

function openModal(title, html) {
  $("dialog-title").textContent = title;
  $("dialog-body").innerHTML = html;
  if (!$("dialog").open) $("dialog").showModal();
  $("dialog").scrollTop = 0;
}
function closeModal() { $("dialog").close(); }
function menu() {
  openModal("选择你的海域", `<nav class="nav-list" aria-label="游戏菜单">
    <button data-action="home"><span>↓</span>每日下潜</button><button data-action="unlimited"><span>∞</span>自由下潜</button>
    <button data-action="archive"><span>⟲</span>往日海域</button><button data-action="packs"><span>▦</span>主题海域</button>
    <button data-action="stats"><span>♙</span>我的潜航</button><button data-action="settings"><span>⚙</span>设置</button>
    <button data-action="quality"><span>◇</span>中文题库</button><button data-action="help"><span>?</span>常见问题</button></nav>
    <p>七道题。二十五秒。你的答案能抵达多深？</p>${dive?.phase === "playing" ? '<p>当前题目仍在计时。</p>' : ""}`);
}
function showSettings() {
  openModal("下潜设置", `<label class="settings-row">播放音效<input type="checkbox" id="setting-sound" ${!settings.muted ? "checked" : ""}></label>
    <label class="settings-row">减少动态效果<input type="checkbox" id="setting-motion" ${settings.reducedMotion ? "checked" : ""}></label>
    <label class="settings-row">增强文字对比<input type="checkbox" id="setting-contrast" ${settings.contrast ? "checked" : ""}></label>
    <p>设置保存在当前浏览器。手机需先点按页面才能播放音效。计时不会因打开菜单或切换标签页暂停。</p>`);
  $("setting-sound").onchange = async (event) => { settings.muted = !event.target.checked; applySettings(); await audio.unlock(); audio.play("submit"); };
  $("setting-motion").onchange = (event) => { settings.reducedMotion = event.target.checked; applySettings(); };
  $("setting-contrast").onchange = (event) => { settings.contrast = event.target.checked; applySettings(); };
}
function showTiers() {
  openModal("越冷门，潜得越深", Object.entries(TIERS).filter(([id]) => id !== "miss").map(([id, tier]) => `<div class="tier-row" style="--color:${tier.color}"><img src="./assets/${id}.png" alt=""><div><b>${tier.name}</b><p>${tier.blurb}</p></div><strong>${tier.score}</strong></div>`).join("") + '<p>每一分代表10米。“万里挑一”是每题指定的珍宝答案。当前分级来自策划，不代表实测答题比例。</p>');
}
function answerDetails(q) {
  const reference = q.source ? `<p><a href="${escape(q.source.url)}" target="_blank" rel="noopener noreferrer">品类参考：${escape(q.source.title)} ↗</a></p>` : "";
  return `<p class="scope">${escape(q.scope)}</p><p>已收录 ${q.answers.length} 个答案 · 别名计作同一个答案</p><div class="answer-chips">${[...q.answers].sort((a, b) => TIERS[b.tier].score - TIERS[a.tier].score).map((a) => `<span style="--color:${TIERS[a.tier].color}" title="${escape(a.aliases.length ? `也接受：${a.aliases.join("、")}` : "常用名称")}">${a.label} · ${TIERS[a.tier].score}</span>`).join("")}</div>${reference}<p>这是一道日常开放题，答案按生活场景整理，可能有合理答案尚未收录。参考资料用于说明物品或品类，不是完整答案名单。分值为初始策划分级。</p><details><summary>支持的别名与常用叫法</summary><p>${q.answers.filter((a) => a.aliases.length).map((a) => `${escape(a.label)}：${escape(a.aliases.join("、"))}`).join("<br>") || "本题使用常用名称即可。"}</p></details>`;
}
function showQuality() {
  const total = QUESTIONS.reduce((n, q) => n + q.answers.length, 0);
  openModal("认真对待每一个答案", `<p>这片海域有 <b>${QUESTIONS.length} 道日常开放题、${total} 个答案条目（按题计）</b>，围绕吃喝、居家、日常小事与户外生活。每道题都能从熟悉的东西想起，再找一个意料之外、又合情合理的答案。</p>
    <h3>判对与稀有度，分开处理</h3><p>答案按题目场景整理，可能有合理答案尚未收录。繁简体、全半角以及列明的别名会归到同一答案；疑似错字仅提示，由你修改后重新提交。</p>
    <p>稀有度目前由策划分级，没有使用虚构的答题人数、百分位或热度数据。“万里挑一”也兼顾答案趣味性。</p>
    <h3>发现漏收或不同意见</h3><p>可导出勘误条目交给题库维护者；条目只保存在本机，不会自动联网发送。</p>
    <form id="correction-form"><label for="correction-text">题目、你的答案和参考出处</label><textarea class="share-copy" id="correction-text" maxlength="1500" required placeholder="例如：某题中的某个别名未被接受；出处是……"></textarea><button class="button-quiet" type="submit">保存勘误条目</button> <button class="text-button" type="button" data-action="export-corrections">导出勘误</button></form>
    <h3>已收录答案与常用叫法</h3>${QUESTIONS.map((q) => `<details class="library-entry"><summary>${escape(q.prompt)} <small>(${q.answers.length})</small></summary>${answerDetails(q)}</details>`).join("")}`);
  $("correction-form").onsubmit = (event) => {
    event.preventDefault();
    const text = $("correction-text").value.trim();
    if (!text) return;
    const previous = read("corrections", []);
    const entry = { date: new Date().toISOString(), bankVersion: BANK_VERSION, text };
    const existing = Array.isArray(previous) ? previous : [];
    queuedCorrections.push(entry);
    write("corrections", [...existing, entry].slice(-100));
    $("correction-text").value = "";
    toast("勘误条目已记录，可点击“导出勘误”下载。尚未发送给任何人。");
  };
}
function archive() {
  const today = localDate();
  const dates = Array.from({ length: 14 }, (_, i) => new Date(Date.parse(`${today}T12:00:00+08:00`) - (i + 1) * 86400000).toISOString().slice(0, 10));
  openModal("往日海域", `<p>回到过去14天的题目。这里的回溯成绩单独记录。</p><div class="archive-grid">${dates.map((date) => `<button data-action="play-archive" data-date="${date}">${date.slice(5)}<small>${restoreDive(read(`archive:${date}`))?.phase === "done" ? "已完成 · 查看" : "回到这一天"}</small></button>`).join("")}</div><p>每日海域以北京时间零点更新。题库版本 ${BANK_VERSION}。</p>`);
}
function packs() {
  openModal("主题海域", `<p>选一片海，每次随机抽取七道日常题。</p>${Object.entries(PACKS).filter(([id]) => id !== "all").map(([id, pack]) => `<button class="pack-card" data-action="play-pack" data-pack="${id}"><b>${pack.name}</b><p>${pack.description}</p></button>`).join("")}`);
}
function stats() {
  const stored = read("history", []);
  const records = Array.isArray(stored) ? stored.filter((d) => restoreDive(d) && d.phase === "done") : [];
  const daily = records.filter((d) => d.mode === "daily");
  const best = Math.max(0, ...records.map(totalScore));
  openModal("我的潜航", `<div class="stats-grid"><div><strong>${records.length}</strong><span>已完成下潜</span></div><div><strong>${best * 10}</strong><span>最深纪录 · 米</span></div><div><strong>${daily.length}</strong><span>每日挑战</span></div></div><p>仅显示本机当前题库最近100次已完成的潜航。每日挑战与自由下潜分开标记。</p>${records.slice(-10).reverse().map((d) => `<div class="settings-row"><span>${d.date} · ${d.mode === "daily" ? "每日" : d.mode === "archive" ? "回溯" : "自由"}</span><span>${totalScore(d) * 10} 米</span></div>`).join("") || '<p>海洋还在等待你的第一条记录。</p>'}`);
}
async function share() {
  if (!dive || dive.phase !== "done") return;
  const text = shareText(dive);
  try { await navigator.clipboard.writeText(text); toast("潜航记录已复制，分享内容不会透露答案。"); }
  catch { openModal("分享潜航记录", `<p>请复制下面的文字：</p><textarea class="share-copy" id="share-text" readonly>${escape(text)}</textarea>`); $("share-text").select(); }
}
function exportCorrections() {
  const stored = read("corrections", []);
  const entries = Array.isArray(stored) && stored.length ? stored : queuedCorrections;
  if (!entries.length) { toast("还没有勘误条目。"); return; }
  const url = URL.createObjectURL(new Blob([JSON.stringify(entries, null, 2)], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = "krillion-zh-corrections.json"; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const actions = {
  home, close: closeModal, archive, packs, stats, share, settings: showSettings, tiers: showTiers, quality: showQuality,
  unlimited: () => start("unlimited"), "play-archive": (button) => start("archive", button.dataset.date),
  "play-pack": (button) => { if (Object.hasOwn(PACKS, button.dataset.pack)) start("unlimited", localDate(), button.dataset.pack); },
  "question-detail": (button) => { const q = QUESTIONS.find((item) => item.id === button.dataset.id); if (q) openModal(q.prompt, answerDetails(q)); },
  "export-corrections": exportCorrections,
  help: () => openModal("关于这片海", '<h3>怎样得分？</h3><p>七道题，每题25秒，只提交一个正确答案。答案的稀有度决定得分，每一分下潜10米。无效答案可以在剩余时间内重试。</p><h3>为什么我的答案没有被接受？</h3><p>请先检查题目范围；也可能是别名漏收。结算后可以查看已收录答案与判题范围，在中文题库页导出勘误。游戏不会声称未收录的答案一定错误。</p><h3>每日什么时候更新？</h3><p>北京时间零点。同一题库版本中，每天七题相同。每日进度保存在当前浏览器，刷新继续计时；想多玩几次，请选择自由下潜。</p><h3>数据会传到哪里？</h3><p>当前版本在本机判题和保存进度，没有账户、全球排行榜或跨设备同步。</p><h3>关于原作</h3><p>玩法与像素海洋视觉参考 <a href="https://krillion.io/" target="_blank" rel="noopener noreferrer">Krillion</a>。本版本为独立中文适配，不代表原站官方版本。中文像素字体为 Fusion Pixel。</p>'),
};

document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (button) actions[button.dataset.action]?.(button);
});
$("begin").onclick = () => start();
$("menu-button").onclick = menu;
$("settings-button").onclick = showSettings;
$("wardrobe-button").onclick = () => {
  openModal("你的潜水伙伴", `<p>选一只磷虾，陪你潜入记忆深处。</p><div class="wardrobe">${[["krillion", "珊瑚红"], ["krillion-gold", "流光金"]].map(([id, label]) => `<button data-character="${id}" aria-pressed="${settings.character === id}"><img src="./assets/${id}.png" alt="">${label}</button>`).join("")}</div>`);
  $("dialog-body").querySelectorAll("[data-character]").forEach((button) => { button.onclick = () => { settings.character = button.dataset.character; applySettings(); $("dialog-body").querySelectorAll("[data-character]").forEach((item) => item.setAttribute("aria-pressed", String(item === button))); }; });
};
$("sound-button").onclick = async () => { settings.muted = !settings.muted; applySettings(); await audio.unlock(); audio.play("submit"); };
$("next").onclick = async () => {
  if (dive?.phase !== "feedback") return;
  closeModal();
  await audio.unlock();
  dive = beginRound(dive);
  persist(); render();
  if (dive.phase === "done") audio.play("done");
  else $("answer").focus({ preventScroll: true });
};
$("answer").addEventListener("compositionstart", () => { composing = true; });
$("answer").addEventListener("compositionend", () => { composing = false; compositionEndedAt = performance.now(); });
$("answer").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.isComposing || composing || event.keyCode === 229 || performance.now() - compositionEndedAt < 80)) event.preventDefault();
});
$("answer").addEventListener("input", () => { $("answer-status").hidden = true; });
$("answer-form").onsubmit = (event) => {
  event.preventDefault();
  if (composing || performance.now() - compositionEndedAt < 80) return;
  audio.unlock();
  commitAnswer($("answer").value);
};
$("dialog").querySelector(".close-dialog").onclick = closeModal;
$("dialog").addEventListener("click", (event) => { if (event.target === $("dialog")) { const box = $("dialog").getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) closeModal(); } });
document.addEventListener("pointermove", (event) => { if (event.pointerType === "mouse") ocean.pointer = { x: Math.max(0.05, Math.min(0.92, event.clientX / innerWidth)), y: event.clientY / innerHeight }; });
document.addEventListener("visibilitychange", () => { audio.visibility(document.hidden); if (!document.hidden) updateClock(); });
window.addEventListener("storage", (event) => {
  if (!dive || event.key !== storageKey(keyFor(dive))) return;
  const latest = restoreDive(read(keyFor(dive)));
  if (latest && latest.seed === dive.seed && (latest.results.length > dive.results.length || latest.results.length === dive.results.length && latest.phase !== dive.phase)) {
    dive = latest; render(); toast("已同步另一个标签页的下潜进度。");
  }
});
setInterval(updateClock, 100);
const active = restoreDive(read("active"));
if (active && active.phase !== "done") { dive = active; if (dive.phase === "ready") dive = beginRound(dive); persist(); render(); }
else home();
