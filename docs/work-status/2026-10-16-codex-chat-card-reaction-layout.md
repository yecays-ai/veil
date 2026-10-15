# STATUS — Chat card and Reaction layout

更新人：Codex  
更新时间：2026-10-16 Asia/Shanghai  
基线：VEIL `main` `996b53741b6ef3e9c273993cfafbfa51be241aa0`。

## 范围

仅修复转账卡片、礼物卡片和 Reaction 的聊天布局。不修改业务状态、持久化结构、消息语义、Character Actions、Life Mode 或聊天横向拖动。

## 实现

- 转账原卡和结果卡共享 `260px` 上限、`248px` 高度；礼物原卡和结果卡共享 `260px` 上限、`190px` 高度。
- 窄屏时，用户和角色卡片共同按角色头像双侧预留空间收缩，保持同宽并避免横向溢出。
- `.chat-message` 明确负责发送方对齐：用户靠右，角色靠左。
- 卡片通过 `display: contents` 的颜色来源包装层继承 `.chat-bubble-role-user` / `.chat-bubble-role-assistant` 的最终背景和文字色，不让自定义 bubble padding 改坏卡片内部尺寸。
- 金额完整保留，使用容器自适应字号；极端字体或宽度下可横向滚动，不裁切数字。
- 转账备注保留完整 DOM 文本并在固定区域内滚动，支持键盘聚焦；没有新增详情弹窗。
- 礼物卡正文限制三行，已有详情弹窗继续显示完整内容。
- Reaction 改为角色右上、用户左上；独立 flex stack 处理多个 Reaction。Bubble shell 为顶部超出部分预留 `10px`，继续由现有 `.chat-turn` 间距规则控制消息间距。

## 验证

- 定向 ESLint：0 error。
- 定向编译后测试：35 项通过（新布局 6、贴纸/Reaction 15、聊天布局 13、消息操作 1）。
- 本地 TypeScript 测试编译仍受工作树缺少 `emoji-picker-react` 阻断；相关测试产物已生成并单独执行，完整 clean install 交由 GitHub CI。
- Chromium 静态布局夹具覆盖 390px 自定义气泡 CSS/Georgia 字体及 320px 默认主题窄屏。

## 截图

- 修改前：`docs/work-status/assets/2026-10-16-chat-ui-before.png`
- 修改后，自定义气泡 CSS 与字体：`docs/work-status/assets/2026-10-16-chat-ui-after.png`
- 修改后，320px 默认主题：`docs/work-status/assets/2026-10-16-chat-ui-after-narrow.png`

## 待验收

iPhone 真机上的自定义字体、滚动备注、多个 Reaction、连续消息、首条消息、时间分隔线及表情包邻接布局。
