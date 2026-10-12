# STATUS — memory-m2-backup

更新人：Claude (Claude Code, session https://claude.ai/code/session_018UGk5R7bjtTckrCwpfw7n4)
更新时间：2026-10-12T08:00:00Z
发现范围：2026-10-12，`git fetch origin main` 得到 `c2062684147265b11dcbe247af19da7f83230101`（分支 base 同此）；GitHub API 列出 `yecays-ai/veil` 开放 PR（含草稿）为空，未发现路径重叠。#153（PR A）已合并。关系 `kind` 的 M1 工单为独立记录（`2026-10-12-claude-memory-m1-relation-kind.md`），本 PR 未改 `lib/foundation*.ts`；`lib/backup/validation.ts` 仅在新增区块与 `validateDomain`/`references` 内加小块。未检查他人未发布的本地工作。

## 当前任务

M2 PR B：`veil-memory-v1` 完整备份接入 + Character 删除/清空会话接入（待审查；Lan 手动合并）。

## 谁在改哪里

Claude；分支 `claude/memory-m2-backup`；PR：见 GitHub（分支名 `claude/memory-m2-backup`）。
- 备份：`lib/backup/{format,static-source,static-export,validation,restore-preview,restore}.ts`（新备份格式版本 2，新增 `memory` 域；版本 1 备份以 `unsupported-format` 在任何写入前拒绝，无兼容层）；入口域摘要 `components/settings/backup-restore.tsx` 仅加一个标签。
- 删除：`lib/character-deletion.ts`（新增 `memory` 清理步骤与 `CleanupDeps.memory`）、`lib/character-leftovers.ts`（确认删除孤儿会话/联系人时同时 `deleteCharacterMemory`）。
- 清空/删除会话：新增 `lib/memory/browser.ts`（`browserMemoryStorage`、`withMemoryClear`），接入 `components/chat/chat-room.tsx`、`components/chat/messages-home.tsx`；`lib/memory/{storage,lifecycle}.ts` 增加 `replaceAllRows`、`cancelClearIntent`、`deleteCharacterMemory` 的 scope 参数。
- 测试：新增 `tests/memory-backup.test.ts`；更新 `tests/{backup-fixture,backup-validation,backup-static-export,backup-safety-closeout,character-deletion,character-deletion-fixture,backup-character-delete-scope,stale-editor-ui}.test.ts`。

## 已完成

- 导出含四个 store；校验严格（字段白名单、指纹须等于文本归一化指纹、Character/会话/消息引用规则；来源消息已删除允许，来源会话已删除仅在有待处理清空意图时允许，不伪造源消息）；空环境恢复、确认覆盖恢复、注入失败回滚、中断继续/回滚均保留稳定 ID；未知库版本/store 拒绝；旧格式不写设备。
- 清空会话/删除会话：先 `recordClearIntent`，再执行聊天操作，再 `completeClear`；聊天操作失败则撤回意图并保留 Memory。群会话对每个成员处理。
- 检查（Node v22.22.0，仓库要求 Node 24）：`npm run typecheck` 通过；`npm run lint` 0 错误（3 条既有 warning）；`npm run build` 通过；`npm test` 1231/1233 通过，2 项失败为已知 Node 22 锁争用测试（Regex/WorldBook failed cleanup）。
- 证据等级：仅自动化测试（fake-indexeddb / JSDOM）。

## 尚未验证

- 真机/真实浏览器行为（IndexedDB 升级、多标签页、真机中断恢复）。
- Node 24 未运行；Node 22 上两项已知锁争用测试（Regex/WorldBook failed cleanup）失败，与本 PR 无关。
- 开放项（需 Lan 决定设计）：无调用方会在启动时调用 `resumePendingClears`，崩溃或清理失败遗留的清空意图暂不会自动完成；恢复应在哪里运行（启动、打开会话、设置页）未定，本 PR 有意不接入。`withMemoryClear` 在清理失败时返回 `cleanupIncomplete`，界面提示“Memory cleanup is pending”，意图保留可续做。
- `findLeftovers` 现在列出只剩 Memory 的已删除 Character（`memories`）；确认删除界面的摘要文案未改，仅有 Memory 的情形摘要会显示 0 个会话。
- 升级前遗留的未完成恢复日志（不含 `memory` 单元）会被判为 `journal-invalid`（按 Lan 决定不做旧格式兼容）。

## 下一步

Lan 审查并手动合并；M2 其余项（启动恢复调用方等）与 M3 未开工，须另行授权。
