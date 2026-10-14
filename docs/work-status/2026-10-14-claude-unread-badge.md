# STATUS — 2026-10-14-claude-unread-badge

更新人：Claude
更新时间：2026-10-14T11:30:00Z
发现范围：2026-10-14 11:25Z 查看 `yecays-ai/veil` 开放 PR（含草稿）；起点 `origin/main` 为 `e6d52bdcf7cba6a40a19c060bafa8e6ad968f4ac`（#189 合并后）。未检查其他分支上的未发布记录。

## 当前任务

待审查。Character Life & Autonomy 第一阶段 PR 3：Chats 列表头像右上角的未读红点，按气泡计数。只做未读数，不改回复触发规则，不碰 `lib/memory/*`。

## 谁在改哪里

Claude；分支 `claude/project-thread-iwht8v`；PR 链接待创建后补充。涉及 `lib/chat/storage.ts`、`lib/chat/types.ts`、`lib/backup/validation.ts`、`components/chat/use-chat-session.ts`、`components/chat/messages-home.tsx`、`app/messages/chat.css`、`tests/chat-unread.test.ts`。

## 已完成

- 会话新增可选字段 `unreadCount`（首次有未读前不存在；读完后移除）；已加入备份校验白名单（正整数，群聊不允许）。
- 计数：回复写入（`finalizeReply`）时，若没有聊天页正在显示该会话，则在同一事务里加上本次存下的气泡数（一条消息 = 一个气泡）；重新生成只替换已看过的气泡，不增加。
- 显示中不计数：聊天页（`useChatSession`）显示该会话期间登记在 `chatStorage.viewSession`，离开时释放；进入时清零未读并通知列表。
- 清空聊天一并清零。
- 列表：未读数显示在头像右上角的红色小圆，与右下角状态点分开；超过 99 显示 99+。
- 检查（Node 24.21.0）：`tsc --noEmit`、eslint（0 错误）、`npm run build`、chat/generation/backup/regression 相关 498 条测试全过（含新增 6 条）。

## 尚未验证

- 真机：红点位置与大小、进入聊天后清零的时机、切后台后回来的表现。
- 登记"正在显示"是页面内存状态：另一个标签页打开的聊天不会让本页的回复免计数（单标签使用不受影响）。
- 群聊没有 AI 回复，故不计未读。

## 下一步

lan 真机验收；第一阶段三张 PR 完成后，等待下一步安排。
