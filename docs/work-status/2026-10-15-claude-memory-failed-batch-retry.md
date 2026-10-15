# STATUS — 2026-10-15-claude-memory-failed-batch-retry

更新人：Claude
更新时间：2026-10-15T20:30:00Z
发现范围：origin/main bad238f977f718a28ea3432fae87d80d5c04bbef；通过 GitHub API 查看远程 open PR（含草稿），本任务开始时无重叠的 Memory 维护任务；未读取真机数据库。

## 当前任务

待审查：Memory 维护失败批次的 JSON 解析容错、失败形状诊断与受限自动重试（lan 2026-10-15 批准的最小方案）。

## 谁在改哪里

Claude；分支 `claude/project-thread-18lv2g`；PR 见创建后的链接。
涉及：`lib/memory/maintenance-{operations,diagnostics,runner}.ts`、`tests/memory-maintenance-results.test.ts`、`tests/memory-maintenance-runner.test.ts`。无持久化结构变更。

## 已完成

- 解析容错：先严格 `JSON.parse`；失败后仅在文本中恰有一个完整顶层 JSON 对象（括号按字符串外计数）时提取，之后仍走原有严格校验。多个对象、括号不平衡、无对象仍判为 JSON 失败。
- 失败形状诊断：只记响应长度、首尾字符类型、是否有代码围栏、顶层对象数、结束原因枚举、解析报错位置、尝试次数。不保存响应或聊天原文。
- 自动重试：failed 且已请求次数小于 2 的批次，在下一次正常维护触发时（仍为累计 20 条新消息，无定时器）作为同一范围重新处理，每次维护最多一个；沿用原有持久化的尝试次数上限（每个范围最多 2 次）。uncertain 批次不重试。
- 已有测试 `preflight secret rejection retains a failed hole…` 的预期随之调整：本地拦截的失败批次也会获得一次无请求的重试，随后才处理新消息。
- 自动化测试（fake IndexedDB、假模型输出，无真实模型调用）：提取规则、完整校验仍生效、失败后同范围重试且不混入新消息、提交后来源关联与范围完成、不重复写入、两次失败后不再请求、uncertain 不重试、诊断不含原文。memory/backup 相关回归 841 项；eslint 通过；tsc 仅有已有的 `emoji-picker-react` 缺失报错。

## 尚未验证

- 真机：lan 的 3 个旧失败批次能否被补跑，以及 Failed 数字是否下降（按代码和同一结构判断可补跑，未在真机验证）。
- 真实模型是否会因解析容错而减少失败，未验证；未调用真实模型。
- 无法区分旧失败批次里"没有发请求"与"已发请求"的类型，重试可能是一次无费用的本地拦截。

## 下一步

lan 真机验证后，根据状态页的结果行（含失败形状）决定是否还需要其他处理。
