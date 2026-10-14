# STATUS — 2026-10-14-claude-memory-p1-2-input-budget

更新人：Claude
更新时间：2026-10-14T07:20:00Z
发现范围：2026-10-14T07:00Z；origin/main = 1993c1aed3d349bfdbb428416d93c38a949539b2（含 PR-A #184）；通过 GitHub API 与本地克隆检查，未发现其他开放 PR 占用 lib/memory 的维护输入路径；未检查本地未发布工作。

## 当前任务

进行中：PR-B（审计 P1-2）—— 记忆维护输入预算、State 预留、Backstory 核心优先、手动记忆相关子集、本地脱敏、too-large 重评估。

## 谁在改哪里

Claude；分支 `claude/project-thread-18lv2g`；PR https://github.com/yecays-ai/veil/pull/185。涉及：`lib/memory/{maintenance-input,maintenance-runner,maintenance-diagnostics,maintenance-browser,progress,progress-types}.ts`、`tests/memory-input-budget*.test.ts`、`tests/memory-progress-backup.test.ts`、`tests/memory-maintenance*.test.ts`、`docs/AUDIT_LEDGER.md`。

## 已完成

- 请求按“规则与 State → 消息 → 角色文本 / Backstory / 相关手动记忆 → 候选”编排；32,000 字符是工程护栏，不是 token 数。每批消息份额 10,000 字符，按请求实际序列化大小计算。
- State 通道不会被跳过：放不下时批次为 too-large；自动提交在 State 开启但未读取 State 快照时拒绝。
- Backstory 放不下时核心段优先、再按相关性补充，并带省略标记；放得下则原文发送。
- 只发送与本次对话相关的手动记忆；suppression 不再发给模型，本地保护仍检查全部。
- 疑似密钥本地脱敏（带标签的到行尾，前缀类仅替换自身），过半被脱敏的消息不发送，整批不会因一处敏感内容丢失；全部消息都敏感时保留失败空洞、零请求。诊断只记计数。
- too-large：批次新增可选字段 `sizeAttempts` / `budgetKey`（已加入严格校验与备份往返测试）；同一预算下每次正常触发最多重评估 2 次后暂停，预算输入变化（模型、Character 文本、Backstory、用户名）后恢复评估，永不标记完成，不阻塞后续范围。
- 检查（本地 Node 22.22，自动化，非真机；CI `verify` 在仓库声明的 Node 24.x 上通过）：`npm run typecheck` 通过；`npm run lint` 0 错误、3 个既有警告；memory + backup 定向测试 826 通过；新增 `memory-input-budget`（600 种组合的预算网格：Backstory × State 数 × 角色文本 × 消息形态 × 手动记忆）、`memory-input-budget-runner`（常见 12,000 字 Backstory + State 下恰好 1 次请求且范围完成、单条正常消息必过、too-large 两次后暂停并可恢复、不饿死后续消息、无 State 快照提交被拒）。全量测试见 PR 描述。

## 尚未验证

- 本地检查用 Node 22.22，与 `package.json` 声明的 24.x 不同；以 CI（24.x）的 `verify` 结果为准。
- iPhone/Safari、真实模型、真实供应商的上下文窗口与 token 参数（待 Lan 提供，未宣称适配任何具体模型）。
- 暂停的 too-large 范围只在下一次正常触发（20 条新消息）时恢复评估，不会在编辑 Backstory 后立即重试。
- 词汇相关性会漏掉纯语义关联的手动记忆（已知边界）。

## 下一步

CI 绿、评审线程答复后按 AGENTS.md 合并（Lan 已同意合并触发 Production 部署）；之后统一汇报测试、合并、部署结果与真机验收项。
