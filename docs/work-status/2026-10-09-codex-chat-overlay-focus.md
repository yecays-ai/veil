# STATUS — Part 5 / F3 Chat overlay focus

更新人：Codex
更新时间：2026-10-09T20:43:04+08:00
发现范围：2026-10-09；基线 `main` / `origin/main` `755c59f68e2199657853514c4be8aa7025596394`。检查默认分支与开放 PR 搜索；开放 PR #72 无范围重叠。#36 已关闭并由 #70 替代；其改动和状态记录均为会话预取/首帧，不含焦点边界。未发布远端分支无法由 PR 搜索发现，默认分支记录未显示相同工作。

## 当前任务

待审查：Part 5 / F3 键盘焦点边界修复已完成并本地验证，准备发布独立 PR；禁止自动合并。

## 谁在改哪里

Codex；分支 `fix/chat-overlay-focus-boundaries`，基于 `755c59f`；PR 尚未创建。范围为 ChatRoom、Chat Info 的三个子页面根节点、ConfirmDialog、布局契约断言和定向挂载测试。

## 已完成

- 只读确认 Chat Info、Message Actions、删除/清空确认框此前都没有焦点进入、Tab 限制或恢复；ConfirmDialog 只有 `aria-modal`，没有 Escape 行为。
- 实现 Chat Info、消息菜单、确认框的焦点进入、Tab/Shift+Tab 环绕、背景 `inert`、合理焦点恢复和 Escape 取消；Chat Info 子页面切换时将焦点转入当前页面，动态读取当前覆盖层根节点。
- 挂载回归测试通过：真实 ChatRoom + React StrictMode + JSDOM 键盘事件；覆盖 Chat Info 与搜索子页面、Message Actions、清空/删除确认、Esc 不删除、确认仍删除、覆盖层切换和原焦点触发器被卸载时回退。
- `node node_modules/typescript/bin/tsc --project tsconfig.tests.json`：通过。
- `node scripts/run-tests.mjs`：742/742 通过。
- `node node_modules/typescript/bin/tsc --noEmit`：通过。
- `node node_modules/eslint/bin/eslint.js .`：0 errors，3 条既有 `components/chat/use-chat-background.ts` warnings。
- `git diff --check`：通过。

## 尚未验证

- GitHub Actions/CI 未运行；本次验收按本地测试与 CodeRabbit。
- iPhone Safari 软键盘、VoiceOver 和真实触屏焦点表现尚未验证。
- CodeRabbit 尚未审查；PR 创建后等待其 review。

## 下一步

创建独立 PR 并等待 CodeRabbit；按审查意见做必要范围内修订，不自动合并。

