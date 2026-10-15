# STATUS — Chat card and Reaction layout

更新人：Codex
更新时间：2026-10-16T02:20:00+08:00
发现范围：基于 VEIL `main` `996b53741b6ef3e9c273993cfafbfa51be241aa0`；核对 PR #212、CodeRabbit 两轮评论、GitHub CI、Vercel 预览及本地任务分支。真机行为仅由用户验收。

## 当前任务

待用户在 iPhone 真机验收：修复转账卡片、礼物卡片和 Reaction 的聊天布局。

## 谁在改哪里

Codex；分支 `codex/chat-card-reaction-layout-20261016`；PR [#212](https://github.com/yecays-ai/veil/pull/212)；涉及 `app/messages/chat.css`、转账/礼物/消息展示组件、定向测试、截图及本记录。

## 已完成

- 范围仅包含聊天 UI；未修改业务状态、持久化结构、消息语义、Character Actions、Life Mode 或聊天横向拖动。
- 转账和礼物卡片共享稳定的 `260px` 宽度上限；不强制固定高度，原始转账、转账结果、原始礼物、礼物结果分别按自身内容自然收口。
- 窄屏时按头像空间收缩；`.chat-message` 负责用户靠右、角色靠左。
- 卡片通过 `display: contents` 包装层继承角色气泡最终背景和文字色。
- 正常金额保持醒目；长金额使用紧凑字号适配宽度。转账备注最多占两行高度并可滚动阅读全文。
- 礼物正文限制两行；原卡可通过点击、Enter 或 Space 打开已有详情弹窗查看全文，并保留可见键盘焦点。
- Reaction 位于角色消息右上、用户消息左上；顶部预留 `10px`，继续使用现有消息间距。
- 定向 ESLint、`git diff --check`、6 项布局测试及礼物详情键盘挂载测试通过；Chromium 夹具覆盖正常/极端内容、320px、Georgia 字体及自定义气泡配色。
- 截图：修改前 `docs/work-status/assets/2026-10-16-chat-ui-before.png`；修改后 `docs/work-status/assets/2026-10-16-chat-ui-after.png`；320px `docs/work-status/assets/2026-10-16-chat-ui-after-narrow.png`。

## 尚未验证

- iPhone 真机上的长金额、滚动备注、自定义字体、多个 Reaction、连续消息、首条消息、时间分隔线及表情包邻接布局。
- 本地完整 TypeScript 测试编译受工作树缺少 `emoji-picker-react` 阻断；clean install 的完整结果以 GitHub CI 为准。

## 下一步

等待用户完成 iPhone 真机验收；不自行合并 PR #212。
