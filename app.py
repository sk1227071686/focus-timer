"""
学校模式专注节律提醒工具 - 后端服务
Flask 轻量后端，提供计时状态 API + 本地数据持久化（JSON）

启动命令：
    pip install -r requirements.txt
    python app.py
访问地址：http://localhost:5000
"""

import json
import os
import threading
import time
from datetime import date
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS

app = Flask(__name__, static_folder="static")
CORS(app)  # 允许跨域，方便本地开发

# ─────────────────────────────────────────
# 数据文件路径
# ─────────────────────────────────────────
DATA_FILE = os.path.join(os.path.dirname(__file__), "data.json")

# ─────────────────────────────────────────
# 计时器状态（内存中）
# ─────────────────────────────────────────
# phase: "focus" | "break" | "idle"
# status: "running" | "paused" | "idle"
timer_state = {
    "phase": "idle",          # 当前阶段
    "status": "idle",         # 运行状态
    "focus_duration": 45 * 60,  # 专注时长（秒）
    "break_duration": 5 * 60,   # 休息时长（秒），可由前端选择
    "remaining": 0,           # 剩余秒数
    "start_time": None,       # 本段开始的 time.time()
    "paused_remaining": 0,    # 暂停时保存的剩余秒数
}

# 线程锁，防止并发写入错误
lock = threading.Lock()


# ─────────────────────────────────────────
# 本地数据读写（今日统计）
# ─────────────────────────────────────────

def load_data() -> dict:
    """读取本地 JSON 数据，自动处理日期切换"""
    today = str(date.today())
    if os.path.exists(DATA_FILE):
        try:
            with open(DATA_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
            # 如果不是今天，重置统计
            if data.get("date") != today:
                data = _empty_stats(today)
        except (json.JSONDecodeError, KeyError):
            data = _empty_stats(today)
    else:
        data = _empty_stats(today)
    return data


def save_data(data: dict):
    """写入本地 JSON 数据"""
    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def _empty_stats(today: str) -> dict:
    return {
        "date": today,
        "focus_count": 0,       # 完成的专注次数
        "break_count": 0,       # 完成的休息次数（含跳过）
        "total_focus_seconds": 0,  # 累计专注秒数
    }


# ─────────────────────────────────────────
# 计时辅助函数
# ─────────────────────────────────────────

def _get_remaining() -> int:
    """计算当前剩余秒数（考虑运行/暂停两种状态）"""
    with lock:
        if timer_state["status"] == "running" and timer_state["start_time"]:
            elapsed = time.time() - timer_state["start_time"]
            remaining = max(0, int(timer_state["paused_remaining"] - elapsed))
        else:
            remaining = int(timer_state["paused_remaining"])
    return remaining


def _current_snapshot() -> dict:
    """返回当前计时器快照（供前端轮询）"""
    remaining = _get_remaining()
    with lock:
        snap = {
            "phase": timer_state["phase"],
            "status": timer_state["status"],
            "remaining": remaining,
            "focus_duration": timer_state["focus_duration"],
            "break_duration": timer_state["break_duration"],
        }
    return snap


# ─────────────────────────────────────────
# 预留音频接口（服务器端占位，实际播放由前端 JS 触发）
# ─────────────────────────────────────────

def play_focus_end_sound():
    """预留：专注结束音效接口（当前静默）"""
    # TODO: 未来可调用系统 TTS 或 pygame 播放提示音
    pass


def play_break_end_sound():
    """预留：休息结束音效接口（当前静默）"""
    # TODO: 未来可调用系统 TTS 或 pygame 播放提示音
    pass


# ─────────────────────────────────────────
# API 路由
# ─────────────────────────────────────────

@app.route("/")
def index():
    """返回前端主页"""
    return send_from_directory(".", "index.html")


@app.route("/api/status", methods=["GET"])
def api_status():
    """获取当前计时器状态"""
    snap = _current_snapshot()
    stats = load_data()
    snap["stats"] = {
        "focus_count": stats["focus_count"],
        "break_count": stats["break_count"],
        "total_focus_seconds": stats["total_focus_seconds"],
    }
    return jsonify(snap)


@app.route("/api/start", methods=["POST"])
def api_start():
    """
    开始计时。
    Body（可选）：{ "break_duration": 300 }  单位秒，仅在 idle 阶段有效
    """
    body = request.get_json(silent=True) or {}
    with lock:
        if timer_state["status"] == "running":
            return jsonify({"ok": False, "msg": "已在运行中"})

        if timer_state["phase"] == "idle":
            # 全新开始：进入专注阶段
            break_dur = int(body.get("break_duration", 5 * 60))
            timer_state["phase"] = "focus"
            timer_state["break_duration"] = break_dur
            timer_state["paused_remaining"] = timer_state["focus_duration"]

        # 从暂停恢复 或 新阶段开始
        timer_state["status"] = "running"
        timer_state["start_time"] = time.time()

    return jsonify({"ok": True, "state": _current_snapshot()})


@app.route("/api/pause", methods=["POST"])
def api_pause():
    """暂停计时（专注/休息均可暂停）"""
    with lock:
        if timer_state["status"] != "running":
            return jsonify({"ok": False, "msg": "当前未在运行"})
        elapsed = time.time() - timer_state["start_time"]
        timer_state["paused_remaining"] = max(0, timer_state["paused_remaining"] - elapsed)
        timer_state["status"] = "paused"
        timer_state["start_time"] = None

    return jsonify({"ok": True, "state": _current_snapshot()})


@app.route("/api/reset", methods=["POST"])
def api_reset():
    """完全重置计时器（回到 idle 状态，不清除今日统计）"""
    with lock:
        timer_state["phase"] = "idle"
        timer_state["status"] = "idle"
        timer_state["remaining"] = 0
        timer_state["start_time"] = None
        timer_state["paused_remaining"] = 0

    return jsonify({"ok": True, "state": _current_snapshot()})


@app.route("/api/skip_break", methods=["POST"])
def api_skip_break():
    """
    跳过当前休息阶段，直接进入下一轮专注。
    仅在 phase == "break" 时有效。
    """
    with lock:
        if timer_state["phase"] != "break":
            return jsonify({"ok": False, "msg": "当前不在休息阶段"})

        # 记录一次休息（跳过也算）
        stats = load_data()
        stats["break_count"] += 1
        save_data(stats)

        # 进入新一轮专注
        timer_state["phase"] = "focus"
        timer_state["status"] = "running"
        timer_state["paused_remaining"] = timer_state["focus_duration"]
        timer_state["start_time"] = time.time()

    return jsonify({"ok": True, "state": _current_snapshot()})


@app.route("/api/phase_done", methods=["POST"])
def api_phase_done():
    """
    前端倒计时归零后调用此接口，通知后端切换阶段并更新统计。
    Body: { "phase": "focus" | "break" }  — 刚结束的阶段
    """
    body = request.get_json(silent=True) or {}
    finished_phase = body.get("phase")

    with lock:
        stats = load_data()

        if finished_phase == "focus":
            # 专注结束 → 统计 + 切换到休息
            stats["focus_count"] += 1
            stats["total_focus_seconds"] += timer_state["focus_duration"]
            save_data(stats)
            play_focus_end_sound()  # 预留音效

            timer_state["phase"] = "break"
            timer_state["status"] = "running"
            timer_state["paused_remaining"] = timer_state["break_duration"]
            timer_state["start_time"] = time.time()

        elif finished_phase == "break":
            # 休息结束 → 统计 + 切换到专注
            stats["break_count"] += 1
            save_data(stats)
            play_break_end_sound()  # 预留音效

            timer_state["phase"] = "focus"
            timer_state["status"] = "running"
            timer_state["paused_remaining"] = timer_state["focus_duration"]
            timer_state["start_time"] = time.time()

        else:
            return jsonify({"ok": False, "msg": "未知阶段"})

    return jsonify({"ok": True, "state": _current_snapshot()})


@app.route("/api/stats", methods=["GET"])
def api_stats():
    """获取今日统计数据"""
    return jsonify(load_data())


@app.route("/api/stats/reset", methods=["POST"])
def api_stats_reset():
    """重置今日统计（调试用）"""
    today = str(date.today())
    save_data(_empty_stats(today))
    return jsonify({"ok": True})


# ─────────────────────────────────────────
# 启动入口
# ─────────────────────────────────────────

if __name__ == "__main__":
    print("=" * 50)
    print("  学校模式专注节律提醒工具")
    print("  访问地址: http://localhost:5000")
    print("=" * 50)
    app.run(host="0.0.0.0", port=5000, debug=False)
