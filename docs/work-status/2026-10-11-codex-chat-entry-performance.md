# STATUS — 2026-10-11-codex-chat-entry-performance

更新人：Codex
更新时间：2026-10-11T12:02:29+08:00
发现范围：2026-10-11T10:30:00+08:00 检查 `yecays-ai/veil` 上游与 fork；已获取 `origin/main` 及上游开放 PR（#115）。

## 当前任务

已完成，待审查：修复进入直接聊天时的一帧闪帧；轻微交互延迟未发现独立的额外阻塞点。

## 谁在改哪里

Codex；branch `codex/chat-entry-performance`；PR [#116](https://github.com/yecays-ai/veil/pull/116)；涉及 `components/chat/chat-room.tsx` 及其聚焦回归测试；base `98688132064ec6bf44df4b9602a104fee55d2562`。

开放 PR #115 同时修改 `components/chat/chat-room.tsx` 和 `app/messages/chat.css`，但仅移除消息菜单的省略号控件；已在 PR 评论中协调，本任务不会触及该 UI 范围。

## 已完成

- 将 fork 的 `main` 从 `3258dbe` 快进同步到上游 `9868813`，并已推送至 `origin/main`。
- 源码定位：`frameReady` 成立后以普通 `useEffect` 设置 `publishedSessionId`；该 effect 会在空壳已经绘制后才发布会话帧，是一帧闪烁的直接原因。
- 修复：将会话帧发布改为 `useLayoutEffect`；React 会在浏览器绘制前同步重新渲染完整帧，不再可见地经历一次空壳 → 聊天的切换。
- 增加 `tests/chat-initial-render.test.ts` 回归断言，锁定发布在 layout effect 内执行。
- 已运行 `git diff --check`，通过。
- 修复已直接推送至 fork `Xiaoqiush81/veil` 的 `main`，fork 的 GitHub Actions `verify` 通过；随后按约定向上游创建 PR #116，未自动合并。
- Vercel 配置核对发现 fork 同时连接 `veil` 与 `veil-xiaoqiush-preview` 两个项目；已断开错误的 `veil` Git 连接，并确认正确的 `veil-xiaoqiush-preview` 仍保持连接。

## 尚未验证

- 尚未在 iPhone Safari / Standalone 设备上复现或验收。
- 自动化：Node 24.19.0 下聚焦的 `chat-initial-render` 回归为 4/4 通过；`typecheck` 在 production build 刷新 `.next` 后通过；lint 通过；production build 通过；`git diff --check` 通过。完整 `npm test` 曾启动并完成依赖的测试编译与套件运行，但受本机命令包装器中断输出影响，未取得可靠汇总，故不将全套测试标记为通过。
- 上游 PR #116 的 CI 与 Vercel Preview 正在排队/部署，尚未完成，不记为通过。

## 下一步

等待上游 PR #116 的 CI、预览与人工审查；iPhone 真机验收仍由 owner 决定，PR 不自动合并。
