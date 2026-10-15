# STATUS — 2026-10-15-codex-message-module-split

更新人：Codex
更新时间：2026-10-15T00:00:00+08:00
发现范围：2026-10-15 以 GitHub `main` 的 `732c6a7d5789a3e22e6e3ac19c2353510588d3c8` 为基线；开始前已检查 open PR，无未关闭 PR。

## 当前任务

Message 模块最小等价拆分（待本地回归与 PR 审查）。

## 谁在改哪里

Codex；分支 `codex/message-module-split-20261015`；PR #200；base `origin/main` `732c6a7d5789a3e22e6e3ac19c2353510588d3c8`。涉及 `components/chat/chat-room.tsx`、`components/chat/messages/message-list.tsx`、`components/chat/message-actions/message-actions-overlay.tsx` 及相关回归测试。

## 已完成

- 将消息时间线展示移至 `components/chat/messages/message-list.tsx`。
- 将消息操作菜单、Reaction bar 和完整 Reaction picker 移至 `components/chat/message-actions/message-actions-overlay.tsx`。
- `chat-room.tsx` 保留 session、状态协调、回调和两个模块的接线；未改变消息持久化或业务规则。
- 更新既有消息展示、Reaction、引用、贴纸和布局回归测试，并新增模块边界检查。
- 目标回归：61/61 通过，覆盖消息菜单、Reaction、引用、贴纸、多选、覆盖层焦点、聊天布局和首帧。
- ESLint：0 error；`chat-room.tsx` 保留已有的两条 `react-hooks/exhaustive-deps` warning。
- PR 首次 CI 的 typecheck 与 lint 已通过；测试中有一条旧源码断言仍要求消息循环留在 `chat-room.tsx`，已改为验证新的薄接线与时间线组件，等待重跑。

## 尚未验证

- 完整 TypeScript 检查受本地缺失 `emoji-picker-react` 依赖阻塞（`components/chat/reaction-picker.tsx`）；并非此次变更引入。PR CI 的完整 typecheck 已通过。
- 尚未在真实浏览器或移动设备验证。

## 下一步

等待 PR #200 的 CI 和审查通过，再按授权合并。
