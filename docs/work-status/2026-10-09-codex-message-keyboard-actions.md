# STATUS — Part 5 / F4 Message keyboard actions

更新人：Codex
更新时间：2026-10-09T22:47:57+08:00
发现范围：2026-10-09，通过 GitHub 集成复核 main `30437ae7223b1b03f65ebcef8b6cb83ee6701152`、PR #73 的合并状态、开放 PR（含 drafts）及 PR #75 / `codex/f7-initial-chat-render-20261009` 的文件和 diff。#75 修改 Regex 与初始 history 定位，没有消息键盘操作入口。旧本地 checkout 含其他任务改动，本单使用 main 的独立本地快照及独立分支；远端操作通过 GitHub 集成，本地 DOM 测试不证明 iPhone 实际键盘/触屏表现。CI、Vercel 和真机未验证。

## 当前任务

进行中：仅修复原始 Part 5 / F4 的消息操作键盘入口；禁止自动合并。

## 谁在改哪里

Codex；分支 `fix/chat-message-keyboard-actions`；PR 尚未创建；基线 main `30437ae`。范围：`components/chat/chat-room.tsx`、`app/messages/chat.css`、`tests/chat-message-keyboard.test.ts`、本状态记录。

## 已完成

- main 的气泡只有点击入口；F3 的 #73 已合并，现有 F3 菜单焦点管理可直接复用。
- 保留气泡段落及原生选择事件；新增独立原生按钮，名称含消息序号和发送者，并通过 aria-describedby 关联实际气泡文本。
- Enter / Space 经原有 openActions 打开菜单，Space 阻止默认滚动；streaming 与多选不显示入口，原有保护和 action 禁用规则保留。
- 定向挂载测试修复前缺少入口而失败，修复后通过；覆盖多消息、键盘、Copy/Quote、焦点进入/恢复/入口卸载回退、点击/触屏事件、文本选择、streaming 与多选限制。JSDOM 的默认 Tab 和原生按钮激活由测试模拟，实际键盘事件由挂载组件接收。

## 尚未验证

- 本地全套测试、应用 TypeScript、Lint 和 diff 检查进行中。
- CodeRabbit 尚未审查。
- GitHub Actions/CI 未运行；Vercel 免费额度限制不作为合并阻碍。
- iPhone Safari、VoiceOver、真实键盘与原生长按选择/触屏布局待验。

## 下一步

完成本地检查，提交仅包含 Part 5 / F4 的独立 PR，接受 CodeRabbit 审查；人工决定合并。
