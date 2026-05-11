# 学校模式专注节律提醒工具

> 45 分钟专注 + 可选 5 / 10 / 15 分钟休息，帮你建立健康的工作节律。

## 功能特性

- 固定 45 分钟专注倒计时 + 环形进度条
- 可选休息时长：5 / 10 / 15 分钟
- 专注 → 休息 → 专注自动循环
- 页面弹窗 + 浏览器桌面通知（Edge 兼容）
- 支持开始 / 暂停 / 重置 / 跳过休息
- 今日统计：专注次数、休息次数、专注时长
- 数据本地 JSON 持久化，次日自动清零
- 预留音效接口 `playFocusEndSound()` / `playBreakEndSound()`
- 低饱和度深色护眼配色，长期使用不疲劳

## 快速开始

```bash
# 1. 安装依赖
python3 -m pip install -r requirements.txt

# 2. 启动服务
python3 app.py

# 3. 打开浏览器访问
# http://localhost:5000
```

## 项目结构

```
focus-timer/
├── app.py           # Flask 后端，REST API + 计时逻辑
├── index.html       # 前端单文件（HTML + CSS + JS）
├── requirements.txt # 依赖列表
└── data.json        # 今日统计数据（运行后自动生成）
```

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET  | /api/status | 获取计时器状态 + 今日统计 |
| POST | /api/start  | 开始 / 继续计时 |
| POST | /api/pause  | 暂停 |
| POST | /api/reset  | 重置到初始状态 |
| POST | /api/skip_break | 跳过当前休息 |
| POST | /api/phase_done | 前端通知阶段结束 |
| GET  | /api/stats  | 今日统计数据 |
| POST | /api/stats/reset | 重置统计（调试用）|

## 依赖

- Python 3.8+
- Flask >= 2.3.0
- Flask-CORS >= 4.0.0
