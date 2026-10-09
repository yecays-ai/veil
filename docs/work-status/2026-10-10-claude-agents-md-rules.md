# STATUS — 2026-10-10-claude-agents-md-rules

更新人：Claude
更新时间：2026-10-09T19:56Z
发现范围：基于 origin/main 575132e（#84 已合并）；只读了 AGENTS.md 与 .github/workflows 的文件名；未重新枚举其他开放 PR，本任务只改 AGENTS.md 与本记录。

## 当前任务

待审查：按 Lan 的要求小幅修订 AGENTS.md——去掉 automerge 授权、要求记录最新 origin/main 完整 SHA、指定 docs/AUDIT_LEDGER.md 为唯一当前总账、区分证据等级；不改其他规则，不改生产代码。

## 谁在改哪里

Claude；分支 claude/agents-md-rules；PR https://github.com/yecays-ai/veil/pull/85；涉及 AGENTS.md、docs/work-status/2026-10-10-claude-agents-md-rules.md；base 575132e。

## 已完成

- AGENTS.md：删除三处 automerge 相关授权，改为“所有 PR 由仓库所有者手动合并，不得加 automerge 标签/启用自动合并/调用合并 API”；新增额度不足时检查记为“未运行”的规则；启动时记录最新 origin/main 完整 SHA；新增“Audit status and evidence”一节。
- 检查：仅文档改动，无构建/测试需要运行。

## 尚未验证

- 仓库里的 Safe PR auto-merge 工作流本身未改动，它仍会在 PR 带 automerge 标签时运行；本次只改了 AGENTS.md 对执行器的指示。
- 未验证其他窗口（GPT、Codex）是否会读取修订后的 AGENTS.md。

## 下一步

等待 Lan 手动合并，不使用 automerge。
