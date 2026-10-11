# STATUS — 2026-10-11-claude-presence-t6-self-context

更新人：Claude
更新时间：2026-10-11T10:40+08:00
发现范围：2026-10-11T10:25+08:00 起；`origin/main` = `98688132064ec6bf44df4b9602a104fee55d2562`（含 T5 #114）；GitHub 远端开放 PR 在创建时未逐项核对，除本分支外未发现涉及 `lib/chat/prompt.ts`、`lib/chat/engine.ts`、`components/chat/chat-room.tsx` 的在途工作；已读 `docs/AUDIT_LEDGER.md` 与 Presence 工单计划 T6–T8 定稿。本分支从该 `origin/main` 创建。

## 当前任务

Character Presence T6：回复上下文（备注感知 + 角色自己的状态、处境、签名），并在同一 PR 内移除消息气泡旁的 `···` 按钮。待审查，等 CodeRabbit 与 Lan 的预览实机验收。

## 谁在改哪里

Claude；分支 `claude/presence-t6-context`；PR [#115](https://github.com/yecays-ai/veil/pull/115)；base `9868813`。
修改：`lib/chat/prompt.ts`、`lib/chat/engine.ts`、`components/chat/chat-room.tsx`、`app/messages/chat.css`、`tests/chat-layout-ui.test.ts`。新增：`lib/chat/self-context.ts`、`tests/presence-self-context.test.ts`、本记录。`tests/chat-message-keyboard.test.ts` 改名并改写为 `tests/chat-message-actions.test.ts`。不碰 Presence 存储、Header、T7/T8 范围。

## 已完成

- 回复前读取一次 `Contact.remark`（`veil.contacts.v1`）、该角色的 Presence 记录（`veil.presence.v1`）和 Foundation 的 `statusMessage`，组成一条系统事实消息，加在历史和时间之后、待回复输入之前；不增加模型请求，不写入任何存储，Request Reply 不改变状态和处境。读取失败只在控制台给出一行不含内容的警告，回复照常进行。
- 备注分两层（Lan 2026-10-11 确认）：当前备注始终只是低关注度背景（"无需回应，语境合适才提"）；备注刚被修改（含首次设置、清空、连续修改只报最新一次）作为一次性事件，只出现在"晚于上一条已完成角色回复"的第一次回复里，并明确"可以评价、调侃，也可以完全不提"。以引擎里上一条已完成回复的时间判断，不按时间过期；Regenerate 以被替换回复之前的上一条为准，所以仍能感知；Continue 不播报。不新增存储，读取沿用 `Contact.lastRemarkChange`。
- 没有作息也没有生效处境的角色不会被告知"离线"，只告知它确有的签名与备注。
- 用户自己的签名和状态是否进入角色上下文：待产品确认，本 PR 不做。
- 移除 `chat-message-actions-trigger` 按钮（Lan 2026-10-11 明确：私人应用，不需要为键盘或读屏保留入口）及其专属 CSS、`aria` 属性、`Ellipsis` 引用；轻点气泡打开菜单的逻辑不变。移除后气泡不再是可聚焦控件，键盘与读屏用户没有菜单入口；这是 Lan 的明确决定（私人应用），不是疏漏。该按钮由 Part 5 F4 的 #76 引入。
- 测试：新增 8 项（含备注变更事件的正常回复、Regenerate、清空、首次设置、连续修改、Continue）；原 4 项（状态文案、处境优先、提示词只多一条系统消息、一次请求只读一次且无额外模型请求）；键盘测试改写为气泡点按测试，并断言不再渲染该按钮；布局测试同步。

## 尚未验证

- 真机：角色回复是否按备注/状态/处境/签名行事（模型行为，由 Lan 预览验收）；`···` 消失、轻点气泡菜单正常。
- GitHub CI、CodeRabbit 与 Vercel 预览：创建时尚未运行。

## 下一步

等 CodeRabbit 与 Lan 验收并手动合并；T7 等 Lan 确认。
