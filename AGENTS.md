# AGENTS.md — 投递舱 ApplyDeck

给未来的 AI/人类协作者的约定。项目刻意保持"无聊"：Node 内置模块 + 原生 ES Module，零 npm 依赖。

## 改代码前

- 读 `README.md` 的「设计原则」：本地优先、固定 6 状态、统计只从事件历史算、不做 streak/排行榜。不要加字段和状态。
- 数据唯一真相源是 `data/applydeck.db`（SQLite）；Markdown 只是单向导出产物，不做双向同步。
- 版本号三处要同步：`server/app.mjs` 的 `VERSION`、`server/index.mjs` banner、`package.json`（e2e 会断言 health.version）。

## 测试与验收（必须全绿再交付）

```bash
npm test                        # node:test 单测
node tests/e2e.mjs              # 端到端（自己起 8799 端口，不碰正式数据）
node scripts/theme-check.mjs    # 主题：持久化 / 循环切换 / 跨标签同步（需 8788 在跑）
node extension/verify.mjs       # Chrome 扩展解析 fixtures（无需服务）
```

前端改动后**必须截图人工过目**（单测发现不了渲染层 bug，例如渠道标签全显示"其他"）：

```bash
node scripts/cdp-shot.mjs "http://127.0.0.1:8788/#/board" out.png 1500 950 1 dark ".job-card"
# 参数：url 输出 宽 高 dpr [light|dark] [点击选择器] [滚动到选择器]
```

移动端视口必须走 CDP `Emulation.setDeviceMetricsOverride`，不要用 `--window-size=390`（Chrome 实际 innerWidth=512）。

## 主题与样式

- 颜色只允许出现在 `web/style.css` 顶部两组令牌：`:root`（浅色）和 `html[data-theme="dark"]`（深色）。
- 状态色用 `--st-{wishlist|applied|test|interview|offer|closed}` 及其 `-bg/-line` 变体，经 `.st-xxx` 类映射到 `.pill/.st-btn/.st-dot`。
- **禁止在 JS 里写内联颜色**（`style="color:#..."`）；需要状态外观就加 `.st-xxx` 类。
- 新增页面要保证两种主题都可读；`web/style.css` 末尾的响应式规则（1180px / 900px / 760px）不要破坏。
- 首屏主题由 `web/index.html` 的 pre-paint 脚本从 `localStorage['applydeck-theme']` 读取；`theme.js` 的 `initTheme` 必须把服务端设置也写回缓存，否则刷新会闪白。

## 服务端约定

- SQLite 的 `StatementSync.run` 用展开参数：`stmt.run(...params)`，不要 `apply`。
- 备份只能用 `VACUUM INTO`（WAL 模式下复制 .db 会坏），保留最近 10 份。
- `PATCH /api/settings` 只接受 `DEFAULT_SETTINGS` 里的键；theme 额外校验 `light|dark|system`。
- 重启服务才加载 `server/*.mjs` 的改动；`web/` 是静态文件，刷新即生效。

## 学习记录

- 新的错误/纠正/更优做法写进 `.learnings/`（格式见 `LEARNINGS.md`，用 `Pattern-Key: area.symptom` 去重）。
- 本文件只放"下一个人必须知道"的规则，不写事故复盘细节。
