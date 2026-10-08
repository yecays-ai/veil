# STATUS — 2026-10-08-claude-foundation-load-recovery

更新人：Claude
更新时间：2026-10-08T11:30:00+00:00
发现范围：2026-10-08 通过 GitHub API 与本地分支查看：开放 PR 仅 #36（Chat 首帧，只改 Chat 文件）；Codex 的 C6（#44）已合并，本单基于其合并后的 main `4b4f636`。本地无未提交改动。

## 当前任务

待审查：工单 07 — R5 Foundation 加载失败恢复。

## 谁在改哪里

Claude；分支 `claude/brave-davinci-ws2ruk`；PR [#45](https://github.com/yecays-ai/veil/pull/45)（人工审查，不加 automerge）；涉及 `components/foundation-provider.tsx`、`tests/foundation-load-recovery.test.ts`（新）。不改 `lib/foundation-storage.ts`，不改存储格式、资源 ID 与业务语义。

## 已完成

- 复现（main，#44 合并前）：首次读取失败后 Provider 把默认文档当作已就绪（`ready=true`、显示默认资料、0 个角色），没有重试入口；存储恢复后不会重新加载；用户在空白表单保存会把真实资料 “Alice” 覆盖成 “Bob”。#44 合并后 `finally { setReady(true) }` 仍在，问题依旧。
- 修复：`ready` 只表示“已成功读取过一次”；读取失败保留最后一次成功的文档，不再发布默认值；错误提示条带 Retry，复用 #44 的合并刷新与版本号；读取失败状态下 `commit` 先重新读取一次，仍失败则拒绝写入且不调用 `transact`；从未读取成功时 `commit` 同样拒绝。
- 没有新增存储层、缓存或全局状态；旧结果晚到仍由 #44 的版本号丢弃。
- Node v24.21.0：`npm test` 575/575（新增 8 个），`npx tsc --noEmit`、`npx eslint .`、`npm run build`、`git diff --check` 均退出码 0。旧 Provider 上 4 个新测试失败；三种变异（失败也置就绪、取消写入门禁、失败时清空文档）各使对应测试失败。

## 尚未验证

- 真机 iPhone / 真实浏览器多标签页；测试用 JSDOM 与假 IndexedDB，仅在 `load` 上注入故障。
- `components/chat/group-room.tsx` 不检查 `ready`，加载失败时成员列表显示为空；未在本单修改。

## 下一步

等待 CodeRabbit 与人工审查；不自动合并。
