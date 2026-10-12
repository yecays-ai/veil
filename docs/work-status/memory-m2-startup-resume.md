# STATUS — memory-m2-startup-resume

更新人：Claude (Claude Code, session https://claude.ai/code/session_018UGk5R7bjtTckrCwpfw7n4)
更新时间：2026-10-12T08:30:00Z
发现范围：`git fetch origin main` 得到 `198df8412e365e4a5797d1c22c0b71b2aa5cfa81`（含已合并的 #154），分支 base 同此。本次未再列开放 PR；未检查他人未发布的本地工作。

## 当前任务

M2 补充：启动时自动完成未完成的 Memory 清空意图（Lan 2026-10-12T07:13Z 批准；待审查，Lan 手动合并）。

## 谁在改哪里

Claude；分支 `claude/memory-m2-startup-resume`；PR 见 GitHub。
新增 `lib/memory/startup.ts`、`tests/memory-startup.test.ts`；改 `lib/memory/lifecycle.ts`（`completeClear` 增加可选 `cutoff`）、`lib/memory/browser.ts`（`resumeBrowserClears`）、`components/product-bootstrap.tsx`（唯一触发点：挂载时一次，卸载时 abort）。

## 已完成

- 只处理已存在且带 `clearRequestedAt` 的游标，不新建删除；可重复执行。
- 完成前核对聊天数据：Character 已不存在则删除其 Memory；会话已不存在或消息数为 0 则完成清理；会话仍有消息则撤回意图（聊天操作未发生或 id 被复用）；Foundation 或会话列表读不到则什么都不改。
- `cutoff`：意图之后创建的 memory、suppression、undo 记录不会被删（同 id 重建会话的情形）。
- 失败保留记录并在游标写入 `failureCount`/`failureReason`，最多 5 次启动后不再重试；无轮询、无订阅，仅一次游标列表读取加一次 Foundation/会话列表读取。
- 检查（Node v22.22.0）：`typecheck`、`lint`（0 错误）、`build` 通过；`npm test` 1238/1240，2 项为已知 Node 22 锁争用失败。证据等级：仅自动化测试。

## 尚未验证

- 真机/真实浏览器行为；Node 24 未运行。
- 残余风险：意图记录后、清空完成前用户已在原会话继续聊天（会话有消息）时意图被撤回，旧消息来源的 memory 保留；清空后在同 id 会话中创建、且早于意图的 memory 仍按旧规则删除其来源；启动时会打开（必要时创建）空的 Memory 库；失败次数达到 5 后需人工或后续版本处理。

## 下一步

Lan 审查并手动合并。`memory-m2-backup.md` 中“启动恢复未定”的开放项由本单取代。
