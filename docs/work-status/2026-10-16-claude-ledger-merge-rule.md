# STATUS — 2026-10-16-claude-ledger-merge-rule

更新人：Claude
更新时间：2026-10-16T08:35:00Z
发现范围：2026-10-16 通过 GitHub API 查看 yecays-ai/veil；仅改 `docs/AUDIT_LEDGER.md` 固定规则第 3 条与本记录，与 #222–#224 不重叠；基于 origin/main 7713223。

## 当前任务

把总账“固定规则”第 3 条（原为“不自动合并，由 Lan 人工决定”）同步为 AGENTS.md 的现行规则（执行 AI 自行合并）。待审查。

## 谁在改哪里

Claude；分支 `claude/ledger-merge-rule`；PR https://github.com/yecays-ai/veil/pull/225；只改规则第 3 条。各板块里的历史状态（“待 Lan 手动合并”等）按规则 9 保留原样，不改。

## 已完成

- 规则 3 改写：CI 绿、线程已答复、可合并时执行 AI 用合并 API 合并；不直推 main；不部署；Lan 对具体 PR 说先不合并时以其为准；额度不足的未运行检查须如实列出并给本地替代。

## 尚未验证

- 文档改动，无代码检查；未全文复核其它板块是否还有规范性（非历史）的旧合并措辞，grep 只命中历史状态行。

## 下一步

CI 绿后按 AGENTS.md 合并。
