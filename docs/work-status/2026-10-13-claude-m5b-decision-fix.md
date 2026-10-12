# STATUS — 2026-10-13-claude-m5b-decision-fix

更新人：Claude
更新时间：2026-10-12T19:50Z (UTC)
发现范围：施工前 `git fetch origin main` = 68f003320b59b2fba85e2e0ca68f6dfc8485d4c4（#163 合并后）；仅检查了本地分支与该 main，未逐个枚举远端其他开放 PR，所有权视为未知，改动范围限于 lib/memory/maintenance-* 与测试/文档。

## 当前任务

M5b 记忆决策规则与来源修复：待审查（等 Lan 手动审核与合并）。

## 谁在改哪里

Claude；分支 `claude/m5b-enable-entry-r3vr44`；PR https://github.com/yecays-ai/veil/pull/164。涉及：`lib/memory/maintenance-operations.ts`、`lib/memory/maintenance-input.ts`、`tests/memory-maintenance.test.ts`、`tests/memory-maintenance-source.test.ts`、`docs/memory-m5b-decision-fix.md`、`docs/memory-m5a-construction.md`、`docs/memory-m5b1-construction.md`、`docs/AUDIT_LEDGER.md`。

## 已完成

- UPDATE 来源继承 + 单元素 mergedFrom；SUPERSEDE 不变；决策提示词；候选预算只计 active。
- 定向测试：memory-* 与 backup-validation 共 310/310 通过，零跳过；新增测试在旧代码上失败 6 项；`tsc --noEmit`、改动文件 eslint 通过。

## 尚未验证

- 真实模型行为、iPhone 真机、CI/CodeRabbit 以 PR 实际结果为准；现有重复记忆未清理；手机 Memory Maintenance 开关是否已关闭未确认。

## 下一步

Lan 审核并手动合并；真实模型小规模评估需另行批准。
