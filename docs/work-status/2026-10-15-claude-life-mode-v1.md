# STATUS — 2026-10-15-claude-life-mode-v1

更新人：Claude
更新时间：2026-10-15T17:10:00Z
发现范围：2026-10-15 16:05Z 查看 `yecays-ai/veil` 开放 PR 为空（含草稿）；起点 `origin/main` 为 `db61f376089938656f73680edaf2864674aaede5`（#209 合并后）。未检查其他分支上的未发布记录。

## 当前任务

待审查。生活模式 V1：每个会话一个开关；开启后用户只管发消息，角色按当前 Presence/Life 状态决定何时回复。方案、两点确认（按会话开关；离线等恢复在线）和后续调整均来自 lan 2026-10-15 的消息。

## 谁在改哪里

Claude；分支 `claude/project-thread-iwht8v`；PR：https://github.com/yecays-ai/veil/pull/210。涉及 `lib/chat/life-reply.ts`（回复时间，纯函数）、`lib/chat/life-reply-watcher.ts`（页面生命周期调度器）、`lib/chat/life-reply-browser.ts`（接线）、`components/proactive-contact-gate.tsx`（同一入口再启动一个）、`lib/chat/self-context.ts` 与 `lib/chat/engine.ts`（"要去忙了"背景行）、`lib/chat/storage.ts` / `types.ts` / `lib/backup/validation.ts`（`ChatSession.lifeMode`）、`components/chat/chat-room.tsx`（开关与旧入口提示）、`lib/chat/request-diagnostics.ts`（来源 `life-reply`）、`tests/life-reply.test.ts`。不碰 `lib/memory/*`、主动联系的调度与预算。

## 已完成

- `ChatSession.lifeMode`：仅直聊，开启时为 `true`，关闭时字段删除；备份校验只接受 `true` 且非群聊。
- 回复时间从"第一条未回复消息"算起，由该消息 id 固定随机，刷新不变：空闲 2–8 秒；Busy 约三成 1–8 分钟偷看，其余 10–90 分钟，且不晚于这段 Busy 结束；刚进入 Busy（15 分钟内）且 5 分钟内刚聊过，则 10–60 秒内继续；DND、离线一律等到在线或离开状态再回，不限时；找不到可用状态则"停放"，消息保留。
- 调度器：每个会话最多一个计时器；页面隐藏时清除，重新可见时重新计算并补回过期的；长等待每 30 分钟重看一次；同一条未回复消息只尝试一次，失败不重试，用户再发新消息才算新请求；关闭生活模式不补发。
- 生活模式下"请求回复"不生成而是提示，"收起键盘自动回复"置灰且不触发；关闭后原样恢复。
- 一次本来就要发生的回复里，如果 Busy 10 分钟内开始或刚开始 10 分钟内，加一行"可以自然收尾"背景；不新增模型调用。
- 检查（Node 24.21.0）：`tsc --noEmit`、`npm run build` 通过；eslint 0 错误（chat-room 两条原有 warning）；chat/backup/presence/proactive/life/generation 等 91 个测试文件共 748 条通过，其中新增 `tests/life-reply.test.ts` 14 条。

## 尚未验证

- 真机：iOS 前后台切换后过期回复补发、计时器行为、忙里偷闲/连续聊天/离线恢复的实际观感、开关与提示文案。
- 角色在"要去忙了"背景下是否自然、是否过于频繁。
- 另一个标签页同时到点只生成一次：依赖现有生成占用，未单独做浏览器级验证。

## 下一步

lan 真机验收；通过后做 Character Life & Autonomy 的剩余审计与基础验收。后台回复与锁屏推送延期。
