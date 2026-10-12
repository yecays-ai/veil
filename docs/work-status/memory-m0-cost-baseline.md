# STATUS — memory-m0-cost-baseline

更新人：Claude
更新时间：2026-10-12T04:45:00+00:00
发现范围：2026-10-12T04:19Z 通过 `git fetch origin main` 读取 origin/main = 978904d4396eda51377bc83284d2db940ca27655；同时刻经 GitHub MCP 列出 yecays-ai/veil 的 open PR（含 draft）为空，未发现并行 PR 或其工作记录；M1（Lan 同日授权并行）尚未见分支/PR，无法确认其路径，视为所有权未知，本任务不触碰 lib/foundation*、Universe 关系编辑器、Foundation 关系备份校验。

## 当前任务

M0 成本基线（docs/memory-m0-m2-tickets.md）：待审查（PR 创建后见下）。只做 M0，不进入 M1/M2/M3。

## 谁在改哪里

Claude；分支 `claude/memory-m0-cost-baseline`，base 978904d4396eda51377bc83284d2db940ca27655；PR：见 PR 描述/分支。
涉及：`lib/chat/usage-baseline.ts`（新）、`lib/chat/request-diagnostics.ts`（startCompletionTerminal 增加可选 meta/usage）、`lib/chat/provider.ts`、`lib/settings/text-api.ts`（各传一次 meta 和 usage）、`tests/usage-baseline.test.ts`（新）、本文件。

## 已完成

- 每次真实模型请求在既有 `startCompletionTerminal` 的“只记第一次结局”处最多追加一条无内容数值记录到 localStorage `veil.usage-baseline.v1`（300 条上限，旧的先丢）；未知 usage 保持 null，不估算 token、不存价格/费用。
- 该键是非权威诊断：不在 BACKUP_LOCAL_KEYS，不进入备份导出/恢复，不触碰 IndexedDB 与未知库护栏，不建 veil-memory-v1，业务 Prompt 未改。
- 写入失败/存储已满/损坏数据均吞掉，不影响回复。
- 数字汇总：仅提供纯函数 `summarizeUsageBaseline`（含测试），未接 UI（现有诊断 UI 是首屏聊天诊断，不适配）。
- 检查（Node v22.22.0，base 978904d）：`npm run typecheck` 通过；`npm run lint` 0 error（3 条既有 warning）；`npm run build` 通过；`npm test` 1195 项中 1193 通过，2 项失败（regex-worldbook-storage-safety 的 rollback lock contention，原因是 Node 22 无 `navigator.locks`，项目要求 Node 24；与本改动无关，未在 Node 24 复跑）。新增 tests/usage-baseline.test.ts 全部通过。证据级别：自动化测试（fake storage + 模拟 fetch）。

## 尚未验证

- 真机/浏览器实际使用后的记录量、localStorage 配额行为、多标签并发写（读-改-写，可能丢一条，已接受）。
- Node 24 下完整 `npm test`；CI 状态在 PR 上以实际结果为准。
- 未在 Lan 的真实 provider 上看过 usage/cache 字段的真实返回。

## 下一步

Lan 审查并手动合并；之后用几天真实使用后再以汇总函数得出预算依据（此前不宣告预算）。
