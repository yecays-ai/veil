# STATUS — memory-m3-bank

更新人：Claude (Claude Code, session https://claude.ai/code/session_01AEbw2AVwwn2bDPHTkp36wA)
更新时间：2026-10-12T08:05:00Z
发现范围：2026-10-12 07:35Z，`git fetch origin main` 得到 `5002239c756a050741b727cd3409e5b484ef8e2a`；GitHub API 列出开放 PR（含草稿）为空，无路径重叠。

## 当前任务

Memory M3：Memory Bank（手动）。Lan 2026-10-12 07:30Z 授权。main 上无 M3 书面工单，范围取自已批准 v2 方案 M3 行与“Memory Bank”小节。待审查，Lan 手动合并。

## 谁在改哪里

Claude；分支 `claude/memory-m3-bank-daase9`，base `5002239`。PR：https://github.com/yecays-ai/veil/pull/156
- 新增：`lib/memory/bank.ts`、`components/memory-bank.tsx`、`app/characters/[characterId]/memory/{page.tsx,memory.css}`、`tests/memory-bank.test.ts`、`tests/memory-bank-ui.test.ts`、`docs/memory-m4-m8-handoff.md`、本文件。
- 修改：`lib/memory/storage.ts`（`MemoryConflictError`、`applyChange` 的 `expectUpdatedAt`、`undoLastOperation` 的 `expected`）、`components/profile-pages.tsx`（资料页 Memory 入口）。

## 已完成

- 新增/编辑/删除/撤销最近 5 条；编辑改 text 时写 corrected 压制，删除写 deleted 压制；撤销恢复快照并撤回压制，保留原 origin。
- 跨标签：编辑/删除按读到的 updatedAt 校验，撤销按显示的操作校验；冲突时不写入，编辑草稿保留。
- 本地搜索与类型/状态/来源筛选；来源只显示会话名与消息是否仍在。
- 检查（Node v22.22.0）：`npm run typecheck` 通过；`npm run lint` 0 错误（3 条既有 warning）；`npm run build` 通过；定向测试 memory-bank 14、memory-bank-ui 4、memory-storage/backup/startup、character-deletion、资料页 UI 共 80 项通过。未跑全量 `npm test`。
- 证据等级：自动化测试（fake-indexeddb + JSDOM）。

## Lan 的决定（2026-10-12 07:36Z）

- 手动可新增全部五类，含对话延续（`MANUAL_MEMORY_KINDS`）。
- subject：Character 自己 / 用户 / 其他，默认 Character 自己（依据 v2“记忆属于 Character”）。“其他”关联对象留给 M5。

## 尚未验证

- 真机（iPhone Safari）使用、真实多标签页；Node 24。

## 下一步

Lan 审查并手动合并。M4 起由 Codex 接手，见 `docs/memory-m4-m8-handoff.md`。
