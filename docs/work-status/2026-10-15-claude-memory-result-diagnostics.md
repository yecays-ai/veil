# STATUS — 2026-10-15-claude-memory-result-diagnostics

更新人：Claude
更新时间：2026-10-15T08:00:00Z
发现范围：origin/main 93a0b5c20446cd8e9850660e28d3a0f6eb909795；2026-10-15 通过 GitHub API 查看远程 open PR，无（含草稿）；未发现重叠任务。

## 当前任务

待审查：Memory 维护只记录计数的结果诊断（lan 2026-10-15 授权）。不改 600 字限制、筛选、提示词、模型调用频率。

## 谁在改哪里

Claude；分支 `claude/project-thread-18lv2g`；PR 见创建后的链接。
涉及：`lib/memory/maintenance-{operations,diagnostics,runner,browser}.ts`、`components/settings/memory-maintenance-settings.tsx`、`tests/memory-maintenance-results.test.ts`。

## 已完成

- 每次维护请求记录：阶段（ok/provider-error/truncated/json/format/commit-failed/too-large/preflight/all-redacted）、模型返回操作数、IGNORE、created、updated、state、被丢弃（超 600 字/保护规则/重复/手动目标）、消息序号范围。只有数字和枚举，不含聊天原文、候选文本或模型响应。
- 复用现有 `createMaintenanceDiagnostics`，浏览器端用 localStorage `veil.memory-maintenance-results.v1` 保留最近 20 条，读写时按白名单字段重建校验。
- Settings → Memory Maintenance 的 Recent maintenance requests 每条请求多一行结果；没有发请求的批次单独列出。
- 自动化测试（fake IndexedDB）：`tests/memory-maintenance-results.test.ts` 6 项；相关 memory/maintenance/state 回归 141 项通过；eslint 通过；tsc 仅有已有的 `emoji-picker-react` 缺失报错（与本任务无关）。
- 失败批次分析（源码阅读）：失败范围留作空洞，不会被自动重试；失败时没有提交任何记忆，重试不会产生重复记忆；仅在请求已发出时才会产生费用。

## 尚未验证

- 真机：新诊断需要在 iPhone 上跑一次维护后才有数据；lan 现有两个失败批次发生在诊断之前，原因无记录，不能事后推断。
- 未做真实模型调用，未自动重跑任何批次。

## 下一步

lan 在真机触发一次维护后查看结果行，再决定是否处理失败批次的手动重试或其他规则。
