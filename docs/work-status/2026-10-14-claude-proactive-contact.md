# STATUS — 2026-10-14-claude-proactive-contact

更新人：Claude
更新时间：2026-10-14T11:15:00Z
发现范围：2026-10-14 11:10Z 查看 `yecays-ai/veil` 开放 PR 为空（含草稿）；起点 `origin/main` 为 `167b24b861b7d02785f3d1a617666a0a4e88b8f4`（#188 合并后）。未检查其他分支上的未发布记录。

## 当前任务

待审查。Character Life & Autonomy 第一阶段 PR 2：无用户输入的一轮生成（Character 先开口，或选择沉默）。不含未读数（PR 3）、不改任何现有回复触发规则。

## 谁在改哪里

Claude；分支 `claude/project-thread-iwht8v`；PR：见 PR 页面（创建后补链接）。涉及 `lib/chat/proactive.ts`、`lib/chat/proactive-scheduler.ts`、`lib/chat/proactive-browser.ts`、`lib/chat/engine.ts`、`lib/chat/storage.ts`、`lib/chat/types.ts`、`lib/chat/request-diagnostics.ts`、`lib/backup/validation.ts`、`components/proactive-contact-gate.tsx`、`app/layout.tsx`、`tests/proactive-contact.test.ts`。未改 `lib/memory/*`。

## 已完成

- 试运行默认值（lan 2026-10-14 确定）：每个 Character 每天最多 2 次主动模型尝试，两次至少相隔 3 小时；Online / Away 可以主动，Busy / DND / Offline 不可以；没有作息表的角色按可联系处理；模型选择沉默也计入预算；过期机会不补发（不存任何错过记录）。
- 预算账本是会话上的 `proactiveAttempts`（时间戳列表，首次尝试前不存在），在 `beginReply("initiate")` 的同一事务里占用，清空聊天不重置；已加入备份校验白名单（最多 10 项、非负整数、群聊不允许）。
- 引擎新增 `initiate(sessionId)`：不要求用户待回复消息；有未回复的用户消息、群聊、预算不足时直接返回 null，不占预算、不发请求。沉默约定为整条回复只有 `<veil-silence/>`（或空）；流式阶段不显示该标记，沉默时草稿被删除并恢复会话的更新时间和预览。请求失败或被停止且没有任何文字时同样静默删除草稿，不留 "Generation failed"，不重试，预算仍记一次。
- 触发器：页面生命周期内，启动 10 秒后一次、每 15 分钟一次、页面重新可见时一次；只在可见时运行、不重叠；每个符合条件的 Character 一次，依次进行。
- 检查（Node 24.21.0）：`tsc --noEmit`、`eslint lib tests/proactive-contact.test.ts components/proactive-contact-gate.tsx app/layout.tsx`、`npm run build`、chat/generation/backup/presence/restore 等相关 674 条测试全过。新增 13 条测试覆盖预算、状态、沉默、失败、清空保留、有待回复消息、触发器与备份。

## 尚未验证

- 真机：iOS 前台/切后台时触发器与请求是否按预期；Character 在你正看着聊天页时先开口的呈现（消息一次性出现，无逐条动画）。
- 没有真实模型验证：Character 是否能稳定遵守 `<veil-silence/>` 约定、主动消息的质量与频率。
- 没有设置里的开关；试运行默认开启，随时可按需要加。
- 关闭 App 后不会主动联系（第二阶段）。

## 下一步

合并后做 PR 3（Chats 头像右上角未读红点，按气泡）。
