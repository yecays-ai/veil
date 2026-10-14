# STATUS — 2026-10-12-claude-backup-legacy-remark

更新人：Claude
更新时间：2026-10-11T18:05:00Z（UTC）
发现范围：2026-10-11T17:58Z 基于 `origin/main` 716a78c 读取源码；未发现重叠的开放 PR 改动 `lib/backup/static-export.ts`（GitHub 查询）。

## 当前任务

待审查：iPhone 真机导出失败原因确认为 `chat.sessions[0]` 带有遗留字段 `remark`（提示 `unexpected-field:remark`）。本单只做兼容：导出副本里忽略值恰为 `null` 的 `remark`。

## 谁在改哪里

Claude；分支 `claude/backup-legacy-remark`；PR：https://github.com/yecays-ai/veil/pull/140。涉及：`lib/backup/static-export.ts`、`tests/backup-static-export.test.ts`。

## 核对结论（源码阅读）

- `remark` 来自早期会话行类型 `string | null`（354faf6 引入），创建时恒写 `null`，历史上未找到任何把它写成非空值的代码；9fcdef2 删除该字段，备注名现由 Contact 承担（`lib/contact-storage.ts`）。
- 因此忽略 `null` 不会丢备注。非 `null` 的 `remark` 仍拒绝导出（不静默丢弃）。

## 已完成

- 只在导出副本里去掉 `remark === null`；不改本机库、备份格式、校验规则。其他未知字段仍拒绝。
- 测试：旧 null 字段导出并通过校验且源数据不变；非空 remark、其他未知字段仍 `invalid-data`。
- 验证（Node v22.22.0，本地；CI 为 GitHub Actions `verify`）：`npx tsx --test tests/backup-static-export.test.ts` 15/15 通过；`npm run typecheck` 无输出；`npx eslint .` 0 错误、3 条既有警告（无新增）；`npm test` 1116 项中 1114 通过、2 失败（regex/worldbook 存储安全测试，未改动的 main 上同样失败，非本单引入）；CI `verify` 首次在仅文档提交上因已知不稳定的 `chat-regenerate-lock-ui` 失败，重跑一次后通过。

## 尚未验证

- 真机上该字段值是否确为 `null`（我无法读取你的数据）；若不是，导出仍会拒绝并显示 `unexpected-field:remark`。
- 真机导出与恢复验收。

## 下一步

合并部署后 iPhone 重新导出。
