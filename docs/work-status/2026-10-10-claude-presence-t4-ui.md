# STATUS — 2026-10-10-claude-presence-t4-ui

更新人：Claude
更新时间：2026-10-11T08:00:00+08:00
发现范围：2026-10-11 通过 GitHub API 查看开放 PR（无开放 PR，含草稿）；`origin/main` = `3bb7b5880e5e0198a9b40ed3070a3d031898f4dc`（含 T1 #109、T2 #110、T3 #111）；已读 `docs/AUDIT_LEDGER.md`（在线系统要求不动首帧布局；F5(a) 首帧闪白为既有问题，未修）。

## 当前任务

Character Presence 第一批 T4：界面接入。待审查，等 Lan 真机验收。

## 谁在改哪里

Claude；分支 `claude/project-thread-459m41`（T3 合并后从最新 main 重建）；PR [#112](https://github.com/yecays-ai/veil/pull/112)；base `3bb7b58`。
新增：`lib/presence/view.ts`（纯函数：状态、Last Seen、下次变化、文字）、`lib/presence/live.ts`（Presence 的应用级读取点）、`components/use-character-presence.ts`（共享 hook）、`tests/presence-view.test.ts`、`tests/presence-ui.test.ts`、本记录。
修改：`components/presence.tsx`、`components/contacts-pages.tsx`、`components/contact-info.tsx`、`components/character-social-profile.tsx`、`components/chat/chat-header.tsx`、`components/chat/chat-room.tsx`、`app/messages/chat.css`、`app/contacts/contact-info.css`、`tests/chat-header.test.ts`、`tests/contact-info.test.ts`（一条源码断言改指向新组件）。
不拆 Header、不接 Messages 列表、不碰 Foundation 数据、不碰角色原有 `presence` 字段（保留，不再显示）。

## 已完成

- 四处显示同一份状态：聊天顶部、通讯录列表（状态点）、Contact Info、社交资料页；全部来自 `useCharacterPresence`，由纯函数 `presenceView` 算出：处境优先于作息；Last Seen = 已存的最近在线时间、已存的最近角色消息时间和当前推算的在线时间三者中最晚的（未来值不计）；在线时只显示 “Online”，其他显示 “Busy · Last seen 1h ago” 这类一行。
- 读取：沿用 Contacts 的应用级读取点（`createLiveDocument`），跨标签页变化会刷新；读失败（损坏或更新版本的数据）不算“已读到”，页面什么都不显示也不写入，下次挂载会重读；数据读到之前 hook 返回 “未就绪、文字为空”，服务端首渲染与客户端首帧一致，不显示猜出来的状态。
- 刷新：只在下一次状态变化的时刻刷新一次；显示 Last Seen 的地方额外每 60 秒刷新一次文字；定时器随组件卸载清除，没有每秒轮询。
- 补写 Last Seen：显示 Last Seen 的地方，若推算的在线时间比已存的更晚且角色当前不在线，写入一次（只增不减，失败不影响显示）；在线时不写，没有数据的角色不会产生记录。
- Header：名字下方加一行小字（11px），名字与状态包在同一列里，列高约 30px，小于头像 40px，所以 56px 的标题行和 Header 的 `min-height` 不变；有联系人时状态行始终存在（数据读到前为空），所以数据读到时名字不会再移动；加载中的 “Chat” 标题没有状态行。`.contact-presence` 加了 `min-height: 1.2em`，只是防止文字为空时塌陷。
- 角色原有 `presence` 字段不再用于任何显示；没有读到作息的角色一律显示 Offline（和原来大多数角色的缺省值一致）。
- 本地检查（2026-10-11 +08:00，Node 24.21.0）：`npm test` 857/857 通过（新增 9 项；全量运行中 foundation-load-recovery 的一条重试用例曾失败一次，单独重跑 3 次与全量再跑 2 次均通过，未追根因）；`npm run typecheck` 通过；`npm run lint` 0 error / 3 条既有 warning；`npm run build` 通过；`git diff --check` 无输出。证据级别：自动化测试（JSDOM 挂载、纯函数），非真机。

## 尚未验证（需 Lan 真机）

- 聊天顶部：从 Chats / Contacts 进入聊天，首帧是否无新增闪动；Header 高度与改前一致；名字位置只上移了一点（为状态行腾位置），长名字是否仍正常省略。
- iPhone 安全区、键盘弹出时 Header 表现。
- 状态行文字：作息生成后，几分钟或几小时后打开，文字是否合理；跨状态切换时是否自动更新。
- 有作息的角色要先保存一次角色资料（T3 触发），否则一律显示 Offline。
- Contact Info / 社交资料页状态行高度是否与改前一致（此处没有测量，只加了不会变高的 `min-height`）。
- 未做 Messages 列表接入（工单明确不做）；`docs/AUDIT_LEDGER.md` 的在线系统条目未改，等 Lan 验收后再登记。

## 下一步

等 Lan 审查并真机验收 T4；确认后第二批 T5（最近角色消息发送时间）、T6（回复上下文）再开工。
