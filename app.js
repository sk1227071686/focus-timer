/* =============================================
   常量 & 状态
============================================= */
const API = "/api";  // 使用相对路径，兼容任意访问地址

let selectedBreakSec = 300;   // 用户选中的休息时长（秒）
let localRemaining   = 0;     // 前端本地倒计时（减少轮询依赖）
let localPhase       = "idle";
let localStatus      = "idle";
let localFocusDur    = 45 * 60;
let tickInterval     = null;  // 本地每秒 tick（Legacy fallback）
let timerWorker      = null;  // Web Worker 计时（防后台节流）
let phaseDoneReported = false; // 防止重复上报 phase_done
let notifPermission  = "default";
let tickEndTime      = null;  // 时间戳校正：本阶段结束的绝对时间（ms）
let titleFlashInterval = null;  // 任务栏闪烁句柄
let originalTitle    = document.title;

/* =============================================
   任务栏闪烁提醒
============================================= */
function startTitleFlash(flashText) {
  stopTitleFlash();
  let toggle = false;
  titleFlashInterval = setInterval(() => {
    document.title = toggle ? originalTitle : flashText;
    toggle = !toggle;
  }, 700);
}

function stopTitleFlash() {
  if (titleFlashInterval) {
    clearInterval(titleFlashInterval);
    titleFlashInterval = null;
  }
  document.title = originalTitle;
}

/* =============================================
   Web Worker 计时（防浏览器后台节流）
============================================= */
function initWorker() {
  if (typeof Worker === 'undefined') return;
  try {
    const workerCode = `
      let interval = null;
      self.onmessage = function(e) {
        if (e.data === 'start') {
          if (!interval) interval = setInterval(() => self.postMessage('tick'), 1000);
        } else if (e.data === 'stop') {
          clearInterval(interval); interval = null;
        }
      };
    `;
    const blob = new Blob([workerCode], { type: 'application/javascript' });
    timerWorker = new Worker(URL.createObjectURL(blob));
    timerWorker.onmessage = () => {
      if (localStatus !== 'running') return;
      localRemaining = Math.max(0, Math.round((tickEndTime - Date.now()) / 1000));
      renderState(localRemaining, localPhase, localStatus, localFocusDur, selectedBreakSec);
      if (localRemaining === 0 && !phaseDoneReported) {
        phaseDoneReported = true;
        reportPhaseDone(localPhase);
      }
    };
  } catch(e) {
    timerWorker = null;
  }
}

/* =============================================
   预留音频接口（前端侧）
   未来在此函数内调用 Audio API 即可
============================================= */
function playFocusEndSound() {
  // TODO: 专注结束音效（当前静默）
}
function playBreakEndSound() {
  // TODO: 休息结束音效（当前静默）
}

/* =============================================
   桌面通知
============================================= */
async function requestNotifPermission() {
  if (!("Notification" in window)) return;
  // Only request permission when page is visible to avoid intrusive popups
  if (document.hidden) {
    notifPermission = Notification.permission || 'default';
    return;
  }
  if (Notification.permission === "granted") {
    notifPermission = "granted"; return;
  }
  if (Notification.permission !== "denied") {
    try {
      const p = await Notification.requestPermission();
      notifPermission = p;
    } catch(e) {
      notifPermission = Notification.permission || 'default';
    }
  }
}

function sendNotif(title, body, icon) {
  if (notifPermission !== "granted") return;
  try {
    new Notification(title, { body, icon: icon || "" });
  } catch(e) { /* Edge 某些策略下可能失败，静默处理 */ }
}

/* =============================================
   休息时长选择
============================================= */
function selectBreak(el, sec) {
  // 休息阶段进行中不可改（此轮已确定）
  if (localPhase === "break" && localStatus === "running") return;
  selectedBreakSec = sec;
  document.querySelectorAll(".break-btn").forEach(b => b.classList.remove("active"));
  el.classList.add("active");
  updateTitle();
}

function updateTitle() {
  const m = selectedBreakSec / 60;
  document.querySelector(".app-title").innerHTML =
    `<span>专注计时器</span> &nbsp;45 + ${m}`;
}

/* =============================================
   倒计时显示
============================================= */
function fmt(sec) {
  const m = Math.floor(sec / 60).toString().padStart(2, "0");
  const s = (sec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function updateRing(remaining, total) {
  const circ = 502;
  const ratio = total > 0 ? remaining / total : 0;
  const offset = circ * (1 - ratio);
  const ring = document.getElementById("ringProgress");
  if (ring) ring.style.strokeDashoffset = offset;
}

function setAccent(phase) {
  const ring = document.getElementById("ringProgress");
  const dot  = document.getElementById("phaseDot");
  const badge = document.getElementById("phaseBadge");

  let color, label;
  const isRunning = localStatus === "running";
  const isPaused  = localStatus === "paused";

  if (phase === "focus" && isRunning) {
    color = "var(--accent-f)"; label = "专注中 🧠";
  } else if (phase === "focus" && isPaused) {
    color = "var(--accent-f)"; label = "已暂停 ⏸";
  } else if (phase === "break" && isRunning) {
    color = "var(--accent-b)"; label = "休息中 🌿";
  } else if (phase === "break" && isPaused) {
    color = "var(--accent-b)"; label = "休息暂停 ⏸";
  } else {
    color = "var(--accent-idle)"; label = "待机中 ☁";
  }
  if (ring) ring.style.stroke = color;
  if (dot) dot.style.background = color;
  const phaseTextEl = document.getElementById("phaseText");
  if (phaseTextEl) phaseTextEl.textContent = label;
}

function renderState(remaining, phase, status, focusDur, breakDur) {
  const digits = document.getElementById("timerDigits");
  if (digits) digits.textContent = fmt(remaining);
  const total = phase === "focus" ? focusDur : breakDur;
  updateRing(remaining, total);
  setAccent(phase);
  updateButtons(phase, status);
}

/* =============================================
   按钮启用/禁用逻辑
============================================= */
function updateButtons(phase, status) {
  const btnStart = document.getElementById("btnStart");
  const btnPause = document.getElementById("btnPause");
  const btnSkip  = document.getElementById("btnSkip");
  const breakBtns = document.querySelectorAll(".break-btn");

  const isRunning = status === "running";
  const isPaused  = status === "paused";

  // 开始按钮：idle 或 paused 时可点
  if (btnStart) {
    btnStart.disabled = isRunning;
    btnStart.textContent = isPaused ? "继续" : "开始";
  }

  // 暂停：仅 running 时可点
  if (btnPause) btnPause.disabled = !isRunning;

  // 跳过：仅休息阶段可跳过
  if (btnSkip) btnSkip.disabled = phase !== "break";

  // 休息选择：仅休息阶段运行中禁止修改（专注中允许提前选下一轮）
  const breakRunning = localPhase === "break" && isRunning;
  breakBtns.forEach(b => b.disabled = breakRunning);
}

/* =============================================
   本地 Tick（时间戳校正版，防止漂移和后台节流）
============================================= */
function startTick() {
  tickEndTime = Date.now() + localRemaining * 1000;
  if (timerWorker) {
    // 优先使用 Web Worker（不受后台节流）
    timerWorker.postMessage('start');
  } else {
    // 降级：普通 setInterval + 时间戳校正
    if (tickInterval) return;
    tickInterval = setInterval(() => {
      if (localStatus !== "running") return;
      localRemaining = Math.max(0, Math.round((tickEndTime - Date.now()) / 1000));
      renderState(localRemaining, localPhase, localStatus, localFocusDur, selectedBreakSec);
      if (localRemaining === 0 && !phaseDoneReported) {
        phaseDoneReported = true;
        reportPhaseDone(localPhase);
      }
    }, 1000);
  }
}

function stopTick() {
  if (timerWorker) timerWorker.postMessage('stop');
  clearInterval(tickInterval);
  tickInterval = null;
}

/* =============================================
   Phase Done → 通知后端 + 弹窗
============================================= */
async function reportPhaseDone(phase) {
  // 0. 任务栏闪烁提醒
  const flashText = phase === "focus" ? "⏰ 专注结束！休息一下" : "⏰ 休息结束！开始专注";
  startTitleFlash(flashText);

  // 1. 前端音效（预留，当前静默）
  if (phase === "focus") playFocusEndSound();
  else                   playBreakEndSound();

  // 2. 显示弹窗
  showModal(phase);

  // 3. 通知后端切换阶段
  try {
    const res = await apiFetch(`${API}/phase_done`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phase })
    });
    const data = await res.json();
    if (data.ok) applyServerState(data.state);
  } catch(e) {
    setConnStatus(false);
  }

  // 4. 桌面通知（尽量保证在最小化/后台也能提醒）
  if (phase === "focus") {
    // 1) 系统通知（需要授权）
    sendNotif("🧠 专注结束！", "45 分钟完成，去休息一下吧～", "");
    // 2) 退化方案：标题闪烁（已在上方 startTitleFlash）
  } else {
    sendNotif("🌿 休息结束！", "休息结束，开始新一轮专注！", "");
  }

  // 更新统计
  fetchStats();
}

/* =============================================
   弹窗
============================================= */
function showModal(finishedPhase) {
  const overlay = document.getElementById("overlay");
  const btn     = document.getElementById("modalBtn");
  if (finishedPhase === "focus") {
    document.getElementById("modalIcon").textContent  = "🌿";
    document.getElementById("modalTitle").textContent = "专注结束！";
    document.getElementById("modalSub").textContent   =
      `太棒了！完成了 45 分钟专注。\n休息 ${selectedBreakSec/60} 分钟，然后继续。`;
    btn.className = "modal-btn break-color";
    btn.textContent = "开始休息";
    btn.onclick = () => {
      overlay.classList.remove("show");
      // 聚焦页面（在一些浏览器中，用户点击 modal 可聚焦）
      try { window.focus(); } catch(e) {}
      // 休息阶段已由 reportPhaseDone → phase_done 接口自动启动
    };
  } else {
    document.getElementById("modalIcon").textContent  = "🧠";
    document.getElementById("modalTitle").textContent = "休息结束！";
    document.getElementById("modalSub").textContent   = "休息好了吗？下一轮专注马上开始！";
    btn.className = "modal-btn focus-color";
    btn.textContent = "开始专注";
    btn.onclick = () => {
      overlay.classList.remove("show");
      try { window.focus(); } catch(e) {}
      // 专注阶段已由 reportPhaseDone → phase_done 接口自动启动
    };
  }
  overlay.classList.add("show");
}

function closeModal() {
  // 停止任务栏闪烁 + 关闭弹窗
  stopTitleFlash();
  document.getElementById("overlay").classList.remove("show");
}

/* =============================================
   应用服务器返回的状态到本地
============================================= */
function applyServerState(state) {
  localPhase     = state.phase;
  localStatus    = state.status;
  localRemaining = state.remaining;
  localFocusDur  = state.focus_duration;
  // break_duration 保持用户选择的值

  phaseDoneReported = false;  // 重置上报标志

  // 服务端覆盖时重置时间戳基准，确保 tick 从新的剩余值重新计算
  tickEndTime = Date.now() + localRemaining * 1000;

  renderState(localRemaining, localPhase, localStatus, localFocusDur, selectedBreakSec);

  if (localStatus === "running") {
    startTick();
  } else {
    stopTick();
  }
}

/* =============================================
   API 调用
============================================= */
async function doStart() {
  try {
    const res = await apiFetch(`${API}/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ break_duration: selectedBreakSec })
    });
    const data = await res.json();
    if (data.ok) applyServerState(data.state);
    setConnStatus(true);
  } catch(e) { setConnStatus(false); }
}

async function doPause() {
  try {
    const res = await apiFetch(`${API}/pause`, { method: "POST" });
    const data = await res.json();
    if (data.ok) {
      stopTick();
      applyServerState(data.state);
    }
    setConnStatus(true);
  } catch(e) { setConnStatus(false); }
}

async function doReset() {
  stopTick();
  closeModal();
  try {
    const res = await apiFetch(`${API}/reset`, { method: "POST" });
    const data = await res.json();
    if (data.ok) applyServerState(data.state);
    setConnStatus(true);
  } catch(e) { setConnStatus(false); }
}

async function doSkip() {
  closeModal();
  try {
    const res = await apiFetch(`${API}/skip_break`, { method: "POST" });
    const data = await res.json();
    if (data.ok) {
      applyServerState(data.state);
      fetchStats();
    }
    setConnStatus(true);
  } catch(e) { setConnStatus(false); }
}

/* =============================================
   今日统计
============================================= */
async function fetchStats() {
  try {
    const res = await apiFetch(`${API}/stats`);
    const d   = await res.json();
    const statFocusEl = document.getElementById("statFocus");
    const statBreakEl = document.getElementById("statBreak");
    const statTotalEl = document.getElementById("statTotal");
    if (statFocusEl) statFocusEl.textContent = d.focus_count;
    if (statBreakEl) statBreakEl.textContent = d.break_count;
    const totalMin = Math.round(d.total_focus_seconds / 60);
    const displayTime = totalMin >= 60
      ? (totalMin / 60).toFixed(1) + " h"
      : totalMin + " 分钟";
    if (statTotalEl) statTotalEl.textContent = displayTime;
  } catch(e) { /* 静默 */ }
}

/* =============================================
   轮询后端状态（兜底同步，每 5 秒）
============================================= */
let pollCount = 0;
async function pollStatus() {
  try {
    const res  = await apiFetch(`${API}/status`);
    const data = await res.json();
    setConnStatus(true);

    // 与本地状态对比，仅在不一致时更新（避免视觉抖动）
    const remDiff = Math.abs(data.remaining - localRemaining);
    if (data.phase !== localPhase || data.status !== localStatus || remDiff > 3) {
      applyServerState(data);
    }
    // 统计每 5 次轮询更新一次
    pollCount++;
    if (pollCount % 1 === 0 && data.stats) {
      const s = data.stats;
      const sf = document.getElementById("statFocus");
      const sb = document.getElementById("statBreak");
      const st = document.getElementById("statTotal");
      if (sf) sf.textContent = s.focus_count;
      if (sb) sb.textContent = s.break_count;
      const totalMin2 = Math.round(s.total_focus_seconds / 60);
      const displayTime2 = totalMin2 >= 60
        ? (totalMin2 / 60).toFixed(1) + " h"
        : totalMin2 + " 分钟";
      if (st) st.textContent = displayTime2;
    }
  } catch(e) {
    setConnStatus(false);
  }
}

/* =============================================
   连接状态
============================================= */
function setConnStatus(ok) {
  const dot   = document.getElementById("connDot");
  const label = document.getElementById("connLabel");
  if (!dot || !label) return;
  if (ok) {
    dot.className = "conn-dot ok";
    label.textContent = "已连接";
  } else {
    dot.className = "conn-dot err";
    label.textContent = "连接失败";
  }
}

/* =============================================
   初始化
============================================= */
async function init() {
  await requestNotifPermission();
  initWorker();
  updateTitle();
  await pollStatus();      // 首次同步
  fetchStats();
  setInterval(pollStatus, 2000);  // 2 秒轮询兜底（缩短感知延迟）

  // 补强措施2：页面从后台恢复时立即从服务端校正，不等下次轮询
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      pollStatus();
    }
  });
}

/* =============================================
   GitHub Pages 静态模式检测
   无 Flask 后端时，所有 API 调用降级到本地 localStorage
============================================= */
let STATIC_MODE = false;  // 自动检测：首次 API 失败后切换

// localStorage key
const LS_KEY = 'focus_timer_state';
const LS_STATS_KEY = 'focus_timer_stats';

function lsGetState() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY)) || null;
  } catch(e) { return null; }
}
function lsSaveState(state) {
  localStorage.setItem(LS_KEY, JSON.stringify(state));
}
function lsGetStats() {
  const today = new Date().toISOString().slice(0,10);
  try {
    const s = JSON.parse(localStorage.getItem(LS_STATS_KEY));
    if (s && s.date === today) return s;
  } catch(e) {}
  return { date: today, focus_count: 0, break_count: 0, total_focus_seconds: 0 };
}
function lsSaveStats(stats) {
  localStorage.setItem(LS_STATS_KEY, JSON.stringify(stats));
}

// 静态模式下的 API 模拟
function staticApiFetch(path, options) {
  const body = options && options.body ? JSON.parse(options.body) : {};
  let state = lsGetState() || {
    phase: 'idle', status: 'idle',
    focus_duration: 2700, break_duration: 300,
    remaining: 2700, paused_remaining: 2700, start_time: null
  };

  const now = Date.now() / 1000;

  if (path === '/api/status') {
    if (state.status === 'running' && state.start_time) {
      const elapsed = now - state.start_time;
      state.remaining = Math.max(0, Math.round(state.paused_remaining - elapsed));
    } else {
      state.remaining = state.paused_remaining || 0;
    }
    const stats = lsGetStats();
    return Promise.resolve({ ok: true, json: () => Promise.resolve({...state, stats}) });
  }

  if (path === '/api/start') {
    if (state.status !== 'running') {
      if (state.phase === 'idle') {
        state.phase = 'focus';
        state.break_duration = body.break_duration || 300;
        state.paused_remaining = state.focus_duration;
      }
      state.status = 'running';
      state.start_time = now;
    }
    state.remaining = state.paused_remaining;
    lsSaveState(state);
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, state }) });
  }

  if (path === '/api/pause') {
    if (state.status === 'running') {
      const elapsed = now - state.start_time;
      state.paused_remaining = Math.max(0, state.paused_remaining - elapsed);
      state.remaining = state.paused_remaining;
      state.status = 'paused';
      state.start_time = null;
      lsSaveState(state);
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, state }) });
  }

  if (path === '/api/reset') {
    state = { phase: 'idle', status: 'idle', focus_duration: 2700, break_duration: state.break_duration || 300, remaining: 2700, paused_remaining: 2700, start_time: null };
    lsSaveState(state);
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, state }) });
  }

  if (path === '/api/phase_done') {
    const finishedPhase = body.phase;
    const stats = lsGetStats();
    if (finishedPhase === 'focus') {
      stats.focus_count++;
      stats.total_focus_seconds += state.focus_duration;
      state.phase = 'break';
      state.paused_remaining = state.break_duration;
    } else {
      stats.break_count++;
      state.phase = 'focus';
      state.paused_remaining = state.focus_duration;
    }
    state.status = 'running';
    state.start_time = now;
    state.remaining = state.paused_remaining;
    lsSaveState(state);
    lsSaveStats(stats);
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, state }) });
  }

  if (path === '/api/skip_break') {
    const stats = lsGetStats();
    stats.break_count++;
    state.phase = 'focus';
    state.status = 'running';
    state.paused_remaining = state.focus_duration;
    state.start_time = now;
    state.remaining = state.paused_remaining;
    lsSaveState(state);
    lsSaveStats(stats);
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, state }) });
  }

  if (path === '/api/stats') {
    return Promise.resolve({ ok: true, json: () => Promise.resolve(lsGetStats()) });
  }

  return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
}

// 统一 fetch 包装：自动检测静态模式
async function apiFetch(path, options) {
  if (STATIC_MODE) return staticApiFetch(path, options);
  try {
    const res = await fetch(path, options);
    // Treat non-2xx responses as backend unavailable in static GitHub Pages
    if (!res.ok) {
      STATIC_MODE = true;
      console.log('[focus-timer] 后端返回非 2xx，切换到静态本地模式', res.status);
      return staticApiFetch(path, options);
    }
    return res;
  } catch(e) {
    STATIC_MODE = true;
    console.log('[focus-timer] 后端不可用，切换到静态本地模式');
    return staticApiFetch(path, options);
  }
}

// Expose functions used by inline attributes
window.selectBreak = selectBreak;
window.doStart = doStart;
window.doPause = doPause;
window.doReset = doReset;
window.doSkip = doSkip;
window.applyServerState = applyServerState;
window.staticApiFetch = staticApiFetch;
window.requestNotifPermission = requestNotifPermission;

// Start when DOM ready
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
