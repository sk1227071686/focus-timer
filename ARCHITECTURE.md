# 学校模式专注节律提醒工具 — 完整架构分析

生成时间：2025年  
仓库：https://github.com/sk1227071686/focus-timer  
运行地址：http://localhost:8080

---

## 一、整体架构概览

本工具采用经典 B/S（Browser/Server）架构，分为三层：

```
┌──────────────────────────────────────────────────────────────┐
│  浏览器（Microsoft Edge）                                      │
│  index.html — HTML + CSS + JavaScript（单文件）               │
│  · 本地倒计时 tick（setInterval）                             │
│  · 每 2 秒轮询后端状态（fetch /api/status）                   │
│  · 用户操作通过 fetch AJAX 调用后端 API                       │
└───────────────────────┬──────────────────────────────────────┘
                        │  HTTP / REST（JSON）
                        │  端口 8080
┌───────────────────────▼──────────────────────────────────────┐
│  Flask 后端（app.py）                                         │
│  · 维护内存中的 timer_state（字典）                           │
│  · 提供 REST API（/api/...）                                  │
│  · 读写本地 JSON 文件（data.json）进行今日统计持久化          │
└───────────────────────┬──────────────────────────────────────┘
                        │  文件读写
┌───────────────────────▼──────────────────────────────────────┐
│  本地磁盘                                                     │
│  data.json — 今日统计（专注次数/休息次数/总时长）             │
│  · 次日自动清零（比对 date 字段）                             │
└──────────────────────────────────────────────────────────────┘
```

---

## 二、后端架构（app.py）

### 2.1 技术栈

| 组件        | 说明                          |
|-------------|-------------------------------|
| Flask       | 轻量 Python Web 框架          |
| flask-cors  | 允许跨域（本地开发便利）       |
| threading   | 线程锁（Lock），防并发写冲突  |
| json / os   | 本地 JSON 数据持久化          |
| time        | 计时基准（UNIX 时间戳）        |

### 2.2 核心状态结构（内存）

```python
timer_state = {
    "phase":            "idle",        # idle | focus | break
    "status":           "idle",        # idle | running | paused
    "focus_duration":   2700,          # 45 × 60 秒（固定）
    "break_duration":   300,           # 5/10/15 分钟（前端可选）
    "remaining":        0,             # 当前剩余秒数（快照用）
    "start_time":       None,          # time.time() 记录本段开始时刻
    "paused_remaining": 0,             # 暂停/idle 时保存的剩余秒数
}
```

**重要设计：后端不运行实际定时器线程。**  
后端通过「起始时刻 + 经过时间」动态计算剩余秒数：

```python
# 运行中：实时计算
elapsed   = time.time() - start_time
remaining = paused_remaining - elapsed

# 暂停中：直接返回保存值
remaining = paused_remaining
```

这样避免了后台线程的复杂性，同时保证了计时精度。

### 2.3 REST API 接口清单

| 方法   | 路径               | 说明                                     |
|--------|--------------------|------------------------------------------|
| GET    | /                  | 返回前端 index.html                      |
| GET    | /api/status        | 获取当前计时器状态 + 今日统计            |
| POST   | /api/start         | 开始（idle→focus）或从暂停恢复           |
| POST   | /api/pause         | 暂停当前计时（保存 paused_remaining）    |
| POST   | /api/reset         | 完全重置 → idle，显示 45:00             |
| POST   | /api/skip_break    | 跳过休息，直接进入下一轮专注             |
| POST   | /api/phase_done    | 前端倒计时归零时上报，后端切换阶段       |
| GET    | /api/stats         | 获取今日统计数据                         |
| POST   | /api/stats/reset   | 重置今日统计（调试用）                   |

### 2.4 阶段切换逻辑（state machine）

```
         /api/start
  idle ──────────────→ focus（running）
                           │
              倒计时归零，前端调用 /api/phase_done
                           │
                           ▼
                       break（running）
                           │
              倒计时归零，前端调用 /api/phase_done
              或用户点击「跳过」调用 /api/skip_break
                           │
                           ▼
                       focus（running）  ← 循环
                           
  任意阶段 ──/api/pause──→ 当前阶段（paused）
  任意阶段 ──/api/reset──→ idle
```

### 2.5 数据持久化（data.json）

存储结构：
```json
{
  "date": "2025-07-15",
  "focus_count": 3,
  "break_count": 3,
  "total_focus_seconds": 8100
}
```

- 每次调用 /api/status、/api/phase_done、/api/skip_break 时读取。
- 每次阶段完成时（focus/break 结束）写入更新。
- 程序启动时若文件 date 与今日不符，自动清零重建。

### 2.6 预留音效接口（后端）

```python
def play_focus_end_sound():
    pass  # TODO: 未来可用 pygame / TTS 播放

def play_break_end_sound():
    pass
```

---

## 三、前端架构（index.html）

### 3.1 整体结构

单文件，包含：HTML 结构 + CSS 样式（内联 style 块）+ JavaScript 逻辑（内联 script 块）

### 3.2 UI 布局层次

```
body（flex, 垂直居中）
├── .conn-bar（右上角连接状态指示）
│     └── conn-dot + connLabel
├── .app-title（标题「学校模式专注计时器 45+X」）
├── .card（主卡片，max-width: 420px）
│     ├── .timer-wrap（倒计时区域）
│     │     ├── .timer-ring（SVG 圆形进度环 + 数字）
│     │     │     ├── circle.ring-track（灰色背景环）
│     │     │     ├── circle.ring-progress（彩色进度环）
│     │     │     └── .timer-digits（大字号数字，如 45:00）
│     │     └── .phase-badge（状态标签：专注中/休息中/待机中）
│     ├── .break-btns（休息时长选择：5/10/15 分钟）
│     └── .ctrl-btns（控制按钮：开始/暂停/重置/跳过）
└── .stats-card（今日统计：专注次数/休息次数/专注时长）

.overlay（全屏弹窗遮罩，阶段切换时显示）
    └── .modal（弹窗卡片，含图标/标题/说明/确认按钮）
```

### 3.3 倒计时机制（双轨制）

这是本工具最关键的设计之一：**前端本地 tick + 后端轮询兜底**

#### 主轨：前端本地 setInterval（每秒 -1）

```javascript
// 每秒触发
tickInterval = setInterval(() => {
    localRemaining = Math.max(0, localRemaining - 1);
    renderState(...);

    // 归零时上报后端
    if (localRemaining === 0 && !phaseDoneReported) {
        phaseDoneReported = true;
        reportPhaseDone(localPhase);
    }
}, 1000);
```

优点：视觉丝滑，不依赖网络延迟。  
依赖：服务器初始化时同步一次 remaining 值作为起点。

#### 辅轨：后端轮询（每 2 秒）

```javascript
setInterval(pollStatus, 2000);

async function pollStatus() {
    // 与本地状态比较，差异 > 3 秒时强制同步
    const remDiff = Math.abs(data.remaining - localRemaining);
    if (data.phase !== localPhase || data.status !== localStatus || remDiff > 3) {
        applyServerState(data);
    }
}
```

作用：处理刷新页面/多标签/网络抖动场景下的状态恢复。容差 3 秒内不覆盖（防止视觉跳动）。

#### 两轨协同时序图

```
前端 tick:   [0s] [1s] [2s] [3s] [4s] ... 每秒自减，丝滑显示
后端轮询:    [0s]           [2s]           [4s] ... 每2秒校准
                               ↑
                         如差异>3秒则覆盖本地值
                         如 phase/status 不同则立即覆盖
```

### 3.4 前端状态变量

```javascript
let selectedBreakSec  = 300;    // 用户选中的休息时长（秒）
let localRemaining    = 0;      // 本地倒计时剩余秒（主显示源）
let localPhase        = "idle"; // 当前阶段（本地缓存）
let localStatus       = "idle"; // 当前状态（本地缓存）
let localFocusDur     = 2700;   // 专注总时长（45*60）
let tickInterval      = null;   // setInterval 句柄
let phaseDoneReported = false;  // 防止重复上报 /api/phase_done
let notifPermission   = "default"; // 桌面通知权限
```

### 3.5 阶段结束通知流程

当前端本地 tick 检测到 localRemaining === 0 时：

```
localRemaining → 0
      │
      ├─→ playFocusEndSound() / playBreakEndSound()   （预留，当前静默）
      ├─→ showModal(phase)                             （页面弹窗）
      ├─→ POST /api/phase_done                         （通知后端切换阶段）
      │         后端返回新阶段状态 → applyServerState()
      └─→ sendNotif(...)                               （浏览器桌面通知）
```

### 3.6 按钮状态逻辑

| 按钮   | 可用条件                          |
|--------|-----------------------------------|
| 开始   | status == idle 或 paused（idle 时显示「开始」，paused 时显示「继续」）|
| 暂停   | status == running                 |
| 重置   | 任何时候均可点击                  |
| 跳过   | phase == break（专注阶段不允许跳过）|
| 休息选择按钮 | 非「休息阶段运行中」均可选 |

### 3.7 视觉设计（配色系统）

采用低饱和度深色系，适合长期工作护眼：

| CSS 变量        | 色值      | 用途             |
|-----------------|-----------|------------------|
| --bg            | #1a1d23   | 主背景（深蓝灰）  |
| --surface       | #23272f   | 卡片背景          |
| --border        | #30343d   | 边框              |
| --text-pri      | #d4d8e0   | 主文字            |
| --text-sec      | #7e8494   | 次文字            |
| --accent-f      | #7c9fd4   | 专注强调（柔蓝）  |
| --accent-b      | #7dc49a   | 休息强调（柔绿）  |
| --accent-idle   | #5a5f6e   | 待机强调（灰）    |
| --danger        | #c47b7b   | 重置按钮（柔红）  |

进度环（SVG）：半径 80px，周长 ≈ 502px，用 stroke-dashoffset 控制进度比例。

### 3.8 预留音效接口（前端）

```javascript
function playFocusEndSound() {
    // TODO: new Audio('/static/focus_end.mp3').play();
}
function playBreakEndSound() {
    // TODO: new Audio('/static/break_end.mp3').play();
}
```

---

## 四、倒计时完整时序分析

### 4.1 一轮完整流程（45+5 分钟）

```
用户点击「开始」
    │
    ▼
前端 doStart() → POST /api/start { break_duration: 300 }
    │
    ▼
后端：phase=focus, status=running, start_time=now, paused_remaining=2700
    │
    ▼
前端 applyServerState() → localRemaining=2700, localPhase=focus
    │
    ▼
前端 startTick() → 每秒 localRemaining--，更新 UI 数字 + 进度环
（同时后端每 2 秒被 pollStatus 查询，差异 ≤3s 不覆盖）
    │
    ▼ （约 45 分钟后）
前端 localRemaining 到达 0
    │
    ├─→ showModal("focus")：弹窗「专注结束！」
    ├─→ POST /api/phase_done { phase: "focus" }
    │       后端：focus_count+1, total_focus_seconds+=2700
    │             phase=break, status=running, paused_remaining=300
    │       返回新状态 → applyServerState()
    ├─→ sendNotif("🧠 专注结束！", ...)  桌面通知
    └─→ startTick() 继续，此时 localRemaining=300 开始休息倒计时
    │
    ▼ （约 5 分钟后）
前端 localRemaining 到达 0
    │
    ├─→ showModal("break")：弹窗「休息结束！」
    ├─→ POST /api/phase_done { phase: "break" }
    │       后端：break_count+1
    │             phase=focus, status=running, paused_remaining=2700
    │       返回新状态 → applyServerState()
    ├─→ sendNotif("🌿 休息结束！", ...)  桌面通知
    └─→ 进入下一轮专注倒计时（循环）
```

### 4.2 暂停/继续时序

```
用户点击「暂停」
    │
    ▼
doPause() → POST /api/pause
    后端：elapsed = now - start_time
          paused_remaining -= elapsed
          status = paused, start_time = None
    │
    ▼
applyServerState() → localStatus=paused
stopTick()：clearInterval，本地 tick 停止

用户点击「继续」
    │
    ▼
doStart() → POST /api/start
    后端：status=running, start_time=now（从 paused_remaining 继续）
    │
    ▼
applyServerState() → localRemaining=paused_remaining（服务端计算值）
startTick()：重新开始每秒自减
```

### 4.3 重置时序

```
用户点击「重置」
    │
    ▼
doReset() → stopTick() + closeModal() + POST /api/reset
    后端：phase=idle, status=idle, start_time=None
          paused_remaining=2700（=45*60，确保重置后显示 45:00）
    │
    ▼
applyServerState() → localRemaining=2700, localPhase=idle
renderState() → 显示 45:00，进度环满，状态标签「待机中」
```

---

## 五、前后端协作边界划分

| 职责               | 前端                      | 后端                      |
|--------------------|---------------------------|---------------------------|
| 倒计时主驱动       | setInterval 每秒 -1       | 不运行定时器              |
| 剩余时间计算       | 本地维护 localRemaining   | 按时间戳动态计算          |
| 状态权威来源       | 快速显示用                | 权威（POST 操作后以它为准）|
| 阶段切换触发       | 归零时主动上报 phase_done | 被动接收，切换并持久化统计|
| 今日统计存储       | 无（每次从后端读取）       | data.json 持久化           |
| 次日清零           | 无                        | 读取 data.json 时自动检查  |
| 桌面通知           | Notification API          | 无                        |
| 音效（预留）       | playFocusEndSound() 等    | play_focus_end_sound() 等 |

---

## 六、文件结构

```
focus-timer/
├── app.py              后端主程序（Flask，约 290 行）
├── index.html          前端单文件（HTML+CSS+JS，约 800 行）
├── requirements.txt    Python 依赖列表
├── README.md           项目说明 & 启动指南
├── test_timer.py       Playwright 自动化端到端测试脚本
├── .gitignore          排除 data.json、__pycache__ 等
└── data.json           今日统计（运行时生成，不纳入 git）
```

---

## 七、依赖清单

### 后端（requirements.txt）

```
flask
flask-cors
```

### 前端

纯原生（HTML5 / CSS3 / ES6+），无任何第三方库依赖。

---

## 八、本地启动步骤

```bash
cd /root/focus-timer
python3 -m pip install -r requirements.txt
python3 app.py
# 浏览器打开 http://localhost:8080
```

---

## 九、已知限制 & 可扩展点

| 项目                  | 当前状态          | 扩展方向                               |
|-----------------------|-------------------|----------------------------------------|
| 声音提醒              | 静默（接口预留）  | 前端 Audio API + /static/*.mp3         |
| 多设备同步            | 不支持            | WebSocket / SSE 替代轮询               |
| 历史统计（多日）      | 仅今日            | SQLite 替代 JSON，按日期分组           |
| 自定义专注时长        | 固定 45 分钟      | 增加 /api/config PATCH 接口            |
| 后端定时提醒          | 无                | APScheduler + 系统通知（notify-send）  |
| 移动端适配            | 基本响应式        | 完整 PWA 支持（service worker）        |
| GitHub Actions CI     | 未配置            | 加入 .github/workflows/test.yml        |
