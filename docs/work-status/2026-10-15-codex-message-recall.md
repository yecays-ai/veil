# STATUS — 2026-10-15-codex-message-recall

更新人：Codex
更新时间：2026-10-15T00:00:00+08:00
发现范围：从最新 GitHub `main` `0ca16e87191df9958b74a06401a5f224f67c8b56` 开始；该 SHA 是 PR #200 合并提交。

## 当前任务

消息撤回（待回归、PR 与合并）。

## 谁在改哪里

Codex；分支 `codex/message-recall-20261015`；PR 尚未创建；base `origin/main` `0ca16e87191df9958b74a06401a5f224f67c8b56`。范围：ChatMessage 撤回语义、ChatStorage 持久化与 Memory v2 来源失效、搜索/摘要/Prompt 过滤、引用预览、Character 自主撤回 Action、菜单 UI、备份验证。

## 已完成

- 用户只能撤回本人已发送消息；Character Action 只能撤回其上一个已完成回复。
- 撤回后清空正文，原位置显示 “Message recalled”；引用预览同步变为撤回文案。
- 搜索、上下文、摘要与 Memory 来源均不再读取撤回正文；摘要及 Memory lineage 按现有清理接口失效。
- Character 正常回复可通过已解析的 `recallPrevious` Action 撤回；Continue 不提供该 Action。
- 撤回、搜索/摘要/Prompt、引用、Memory v2 相关既有行为、Character Action、备份和覆盖层回归共 48 项通过。
- ESLint 改动文件 0 error；`chat-room.tsx` 保留两条已有 Hook 依赖 warning。

## 尚未验证

- PR CI、真实浏览器与设备验收尚未完成。

## 下一步

完成该阶段限定回归后创建独立 PR；CI 与审查通过后合并。
