# STATUS — chat-list-prefetch

更新人：Codex
更新时间：2026-10-09T19:28:00+08:00
发现范围：2026-10-09；核对 yecays-ai/veil 最新 main（dfb0f6e，含 #63/#67）、开放 PR #36 与 #68、相关远端分支和工作状态记录。#68 仅改审计文档；#36 保持开放且仅作能力参考。generation-safety 远端分支也涉及 storage，但未发现与本任务 dispatch revision / readonly peek 新逻辑直接重叠的改动。

## 当前任务

迁移 Chats 列表按下预读会话能力；本地实现和验证已完成，但发布被自动审查阻止，当前受阻。

## 谁在改哪里

Codex；分支 `feat/chat-session-prefetch-main`；PR 尚未创建；本地基于 `dfb0f6e`，本地提交 `dd11b20`。常规 Git push 因无法解析 github.com 失败。GitHub 接口创建的同名远端分支仍指向 main，没有任务提交。

## 已完成

- 添加只读、拒绝生成中会话的 session peek；不触发 generation recovery。
- 添加容量为 4、按通用 chat change revision 校验的一次性预读 seed；保留独立的 `chatBackgroundRevision` F4 递增规则。
- 在 Chats 列表已有单聊主指针按下时启动预读，保留现有 swipe row 手势。
- 将 seed 接入 Chat session lifecycle 初始消息状态，同时继续用当前生命周期读取作权威更新，并在离开/切换时清理。
- `node node_modules/typescript/bin/tsc --noEmit`：通过。
- `node node_modules/typescript/bin/tsc --project tsconfig.tests.json`：通过。
- `node scripts/run-tests.mjs`：736/736 通过。
- `node node_modules/eslint/bin/eslint.js .`：通过，0 errors；3 条既有 `use-chat-background.ts` warnings。
- `next build`（`NEXT_TELEMETRY_DISABLED=1`）：通过，所有路由构建完成。
- `git diff --check`：通过。
- 发布提交时，自动审查拒绝了 `lib/chat/storage.ts` blob 上传，理由是源内容被截断并包含输出警告标记；审查明确禁止通过替代路径绕过。其余文件的 blob 上传已成功，但尚未创建 tree/commit/PR。

## 尚未验证

- PR 未创建，GitHub CI 和 CodeRabbit 状态不可检查。
- 未进行 iPhone 真机验收；需确认进入时消息可见时机和快速切换角色的实际视觉行为。

## 下一步

等待可安全、经审查许可的方式发布 `lib/chat/storage.ts` 后再创建独立 PR；PR #36 保持开放。
