# 专注节律提醒工具 — 架构文档

见 index.html（单文件实现）。

核心点：
- 计时由前端（Web Worker）承担，避免 setInterval 在后台被节流
- 本地持久化采用 localStorage，今日统计按日期自动重置
- 支持跨标签同步与页面刷新恢复

模块划分已在 index.html 注释中说明。