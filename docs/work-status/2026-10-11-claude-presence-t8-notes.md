# STATUS — 2026-10-11-claude-presence-t8-notes

更新人：Claude
更新时间：2026-10-11T18:25+08:00
发现范围：2026-10-11T18:10+08:00 起；`origin/main` = `cbe117bc9b12da1f075b88f5e4aabedf6a329a2c`（含 T7 #117）；已读 `docs/AUDIT_LEDGER.md`、T6–T8 定稿；GitHub 开放 PR 只有 #126（`codex/backup-database-open-gate`，四库 open 协调）。#126 同样修改 `lib/chat/storage.ts`，但改的是 open/transaction 段；本任务在该文件只新增一个独立方法 `appendSystemEvent`（不改 `transaction` 签名），预期可自动合并；本任务不碰总账 S11 行。

## 当前任务

状态：待审查（等待 Lan 真机验收）。

Character Presence T8：两个方向的备注各自独立保存；两个方向的变更都在聊天里产生一条灰色居中的系统事件；角色通过受控结构化动作修改自己对用户的备注。顺带修复验收中发现的小问题：打开消息菜单时，本应浮在菜单上方保持清晰的那条消息消失，只剩菜单。

## 谁在改哪里

Claude；分支 `claude/presence-t8-notes`；base `cbe117b`。
新增：`lib/presence/note-events.ts`、`tests/presence-notes.test.ts`、本记录。修改：`lib/presence/storage.ts`、`lib/presence/actions.ts`、`lib/chat/self-context.ts`、`lib/chat/engine.ts`、`lib/chat/storage.ts`、`lib/chat/prompt.ts`、`components/chat/chat-room.tsx`、`components/contact-info.tsx`、`app/messages/chat.css`，以及三处旧测试断言（`presence-self-context`、`presence-actions`、`chat-layout-ui`）。

## 已完成

- 两份备注分开存：用户给角色的备注沿用 `Contact.remark`（未改）；角色给用户的备注是 Presence 记录里的可选字段 `userNote {text, changedAt, source}`，角色首次设置前不存在，旧数据和旧备份包按原样通过备份校验（备份校验用 `normalizePresenceDocument` 比对，已测）。清空时保留 `text: ""` 以便冷却仍然生效。
- 角色改备注：回复末尾标签新增 `userNote` 字段（清洗同签名：控制/不可见字符去掉、折叠空白，最多 100 字）。沿用 T7 的规则：只有收尾标签生效、提交后才应用、Continue 不提示也不应用、不增加模型请求。冷却按角色自己上一次改备注起算 12 小时（暂定），无变化不消耗冷却，冷却中该字段不出现在提示词里。检查和写入在同一个 Presence 事务里完成。
- 上下文：角色看到自己对用户的当前备注（低注意力一行，"只在自然时才用"）。用户改备注的"变更事件仅一次"沿用 T6，未改。
- 系统事件：存成对话里的 `role: "system"` 消息（该角色类型本来就在类型和备份校验里，无需改备份），正文即显示文字：`Ghost has changed your nickname to “X”` / `You changed Ghost's nickname to “X”`，删除时为 `…has removed your nickname` / `You removed …`。新增 `ChatStorage.appendSystemEvent`：只在该角色已有对话时写入，不改会话的预览、更新时间、最后一条消息。两个方向都写：用户在 Contact Info 保存成功后写；角色的变更在备注写入成功后写；事件写失败只在控制台警告，不回滚备注。
- 事件不影响聊天：提示词历史过滤 system 消息；Regenerate/Continue 只看 user/assistant，事件在后不影响可用性（有测试，重新生成后事件仍在）；聊天室里是居中浅灰胶囊、无头像、不是气泡，不参与气泡分组，"已读"标记落在最后一条真实用户消息；菜单里 Edit/Quote 对它禁用，可复制/选择/删除；搜索本来就只搜 user/assistant。
- 菜单消息消失：原因是历史区本身是 `z-index:1` 的层叠上下文，被抬起的消息（`z-index:65`）被困在里面，在模糊遮罩（`z-index:40`）之下。菜单打开期间让历史区 `z-index:auto`。用最小页面在 Chromium 复现：修复前遮罩盖住消息，修复后消息在最上。这是对层叠关系的复现，不是整页真机验证。

## 本地验证（Node v24.21.0）

typecheck、lint（3 条既有警告，0 错误）、`npm test`（982/982，新增 9 条）、`npm run build` 通过。

## 尚未验证

- 真机：灰色事件的观感、两个方向实际出现、菜单里被抬起的消息是否恢复清晰；模型是否会在合适时机给用户起/改备注而不乱改。
- 暂定常量：备注冷却 12 小时。
- GitHub verify / CodeRabbit / Vercel 预览待发布后记录；不能读 Vercel 状态，由 Lan 确认部署。

## 下一步

开 PR，同步验收分支，等 Lan 真机验收并手动合并。
