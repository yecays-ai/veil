# STATUS — Part 5 / F3 Chat overlay focus

更新人：Codex
更新时间：2026-10-09T21:15:00+08:00
发现范围：2026-10-09；最初本地基线 `755c59f68e2199657853514c4be8aa7025596394`；发布前复核 PR #73 最新基线为 `0ee3e2d8ebb07dda12ef3759673aad1b4c40cd71`（#72）。#72 在任务进行中合并，更新 `app/mobile-foundation.css`、`components/diagnostics/chat-diagnostics.tsx` 与 `tests/chat-layout-ui.test.ts`；PR 分支以 #72 后的 main 为基线，并保留其测试断言，只加适配 Chat Info 子页面 ref 的两项断言。#36 已关闭并由 #70 替代；其改动和状态记录为会话预取/首帧，不含焦点边界。开放 PR #73 已创建；PR 搜索未发现其他焦点边界改动。

## 当前任务

Part 5 / F3：已修，CodeRabbit 发现 1 个回归点，补丁已提交 PR #73，待补丁复审；禁止自动合并。

## 谁在改哪里

Codex；分支 `fix/chat-overlay-focus-boundaries`，PR [#73](https://github.com/yecays-ai/veil/pull/73)，以最新 main `0ee3e2d` 为基线。范围为 ChatRoom、Chat Info 的三个子页面根节点、ConfirmDialog、布局契约断言和定向挂载测试。

## 已完成

- 只读确认 Chat Info、Message Actions、删除/清空确认框此前都没有焦点进入、Tab 限制或恢复；ConfirmDialog 只有 `aria-modal`，没有 Escape 行为。
- 实现 Chat Info、消息菜单、确认框的焦点进入、Tab/Shift+Tab 环绕、背景 `inert`、合理焦点恢复和 Escape 取消；Chat Info 子页面切换时将焦点转入当前页面，动态读取当前覆盖层根节点。
- 挂载回归测试通过：真实 ChatRoom + React StrictMode + JSDOM 键盘事件；覆盖 Chat Info 与搜索子页面、Message Actions、清空/删除确认、Esc 不删除、确认仍删除、覆盖层切换和原焦点触发器被卸载时回退。
- `node node_modules/typescript/bin/tsc --project tsconfig.tests.json`：通过。
- `node scripts/run-tests.mjs`：743/743 通过；本地测试树已纳入 #72 合并的移动布局与 DIAG 改动，与 PR #73 的 `0ee3e2d` 基线一致。
- `node node_modules/typescript/bin/tsc --noEmit`：通过。
- `node node_modules/eslint/bin/eslint.js .`：0 errors，3 条既有 `components/chat/use-chat-background.ts` warnings。
- `git diff --check`：通过。

## 尚未验证

- GitHub Actions/CI 未运行；本次验收按本地测试与 CodeRabbit。
- iPhone Safari 软键盘、VoiceOver 和真实触屏焦点表现尚未验证。
- CodeRabbit 在 PR #73 指出：ChatRoom 捕获阶段的 Escape handler 会抢先阻止嵌套 dialog（如 ImageCropDialog）收到 Escape。已增加嵌套 dialog 所有权检查；只有 Escape 不属于嵌套 dialog 时才由当前 Chat overlay 关闭。
- 新增 mounted ChatRoom 回归断言：嵌套 dialog 的 Escape handler 收到未被外层 preventDefault 的事件，且 Chat Info 仍保持打开；本地定向测试通过。当前 PR head 已更新，等待 CodeRabbit 补丁复审。

## 下一步

等待 PR #73 的 CodeRabbit 最终审查；仅处理本单范围内的意见，不自动合并。

