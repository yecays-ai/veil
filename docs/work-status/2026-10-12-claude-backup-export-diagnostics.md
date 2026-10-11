# STATUS — 2026-10-12-claude-backup-export-diagnostics

更新人：Claude
更新时间：2026-10-11T17:50:00Z（UTC）
发现范围：2026-10-11T17:35Z 基于 `origin/main` bc501b8 读取源码；当时远端 #135、#134 均已合并，未发现重叠的开放 PR（本地 worktree 与 GitHub 查询均未显示）。

## 当前任务

待审查：iPhone 真机验收阻塞——导出一直提示“有未完成回复”。本单只做第 1 步（精确诊断），不改存储数据、备份格式或校验规则；旧标记过滤（第 2 步）等真机拿到准确原因后再定。

## 谁在改哪里

Claude；分支 `claude/backup-export-diagnostics`；PR 见 PR 页。涉及：`lib/backup/format.ts`（`BackupValidationError` 增加可选 `detail`）、`lib/backup/validation.ts`（`keys` 与会话行校验给出规则名/字段名，条件本身未变）、`lib/backup/backup-flow.ts`（`describeBackupError` 不再把所有 `chat.sessions` 的 `invalid-data` 解释成旧标记）、`tests/backup-validation.test.ts`、`tests/backup-flow.test.ts`。

## 已完成

- 只有 `unexpected-field:generation` 才显示“未完成回复”；其余显示“Stored conversation N cannot be backed up (chat.sessions[i]: <规则>)”。`detail` 只含固定规则词和字段名，字段名非普通标识符时显示 `?`，不含任何值。
- 测试：新增 15 种会话行异常 + 2 种群聊规则的诊断断言，并断言消息不含存储内容；校验仍然拒绝导出（`code` 仍为 `invalid-data`）。
- 命令与结果见 PR 描述（Node 24：`tsc --project tsconfig.tests.json` + 相关测试文件）。

## 尚未验证

- 真机上到底是哪条规则失败：需要 iPhone 更新后重新导出读取新提示。
- 未实现、未评估旧标记过滤或任何数据兼容方案。

## 下一步

Lan 在真机重新导出，回报新提示里的规则名；据此再决定第 2 步。
