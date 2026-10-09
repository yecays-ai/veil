# STATUS — Part 5 / F3 Chat overlay focus

更新人：Codex
更新时间：2026-10-09T21:46:00+08:00

## 当前任务

Part 5 / F3：已修，待 CodeRabbit 意见整改。新增焦点恢复意见已补丁提交并通过本地回归，等待复审；PR #73 open，禁止自动合并。本来源编号不覆盖仓库总账中背景问题的 F3。

## 谁在改哪里

Codex；分支 `fix/chat-overlay-focus-boundaries`，PR [#73](https://github.com/yecays-ai/veil/pull/73)。本次修订基于 PR head `dd527769`，PR 对账基线 `0ee3e2d8ebb07dda12ef3759673aad1b4c40cd71`。本地树为原始 `755c59f` 加 #72 已合并文件更新及本 PR 修改。修改路径：`components/chat/chat-room.tsx`、`tests/chat-overlay-focus.test.ts`、`tests/chat-layout-ui.test.ts`、本状态记录。

2026-10-09 21:44 +08:00 通过 GitHub 集成读取 PR #73 最新代码/行内评论、开放 PR（含 drafts）及 #75 的文件和 diff。#75 也修改 ChatRoom，但范围为 Display Regex 和初始 history 定位，与本次 Chat Info 点击入口、overlay 焦点来源记录不重叠；未接管其改动。#36 已关闭并由 #70 替代，未修改。

## 已完成

- 三类 overlay 的焦点进入、Tab/Shift+Tab 限制、底层 inert、恢复与确认弹窗 Escape 取消已有挂载覆盖。
- CodeRabbit 上一条嵌套 dialog Escape 意见已确认 addressed/resolved；外层仍让嵌套 dialog 自己取消。
- 确认新 finding：ChatInfoScreen 子 layout effect 先聚焦 Back，随后 ChatRoom 才捕获 activeElement，原触发器被误记。
- 在打开 Chat Info 的点击入口、setState 前记录原焦点；父 layout effect 保留这一记录，不覆盖成子页面控件。确认框切换后仍保留 Chat Info 原触发器；连接性检查和安全回退继续工作。
- 新增真实挂载 ChatRoom + StrictMode 回归：另一个按钮激活设置入口，Chat Info 收到焦点，关闭后恢复到该按钮。修复前断言失败，修复后通过。现有子页面、确认框、Escape、触发器卸载用例也通过。
- 更新布局测试中依赖旧 onClick 字面写法的断言；实际打开和焦点恢复由挂载交互验证。
- 测试 TypeScript 编译、应用 `tsc --noEmit`、`git diff --check` 通过。
- 全套本地测试复跑 743/743 通过。首轮一项无关生成测试失败；该测试文件单独复跑 11/11、全套复跑均通过，未修改其代码。
- ESLint 0 errors，3 条既有 `components/chat/use-chat-background.ts` warnings；本次三个代码/测试文件定向 lint 无问题。

## 尚未验证

- 新焦点恢复补丁尚待 CodeRabbit 复审；原评论不由 Codex 自行核销。
- GitHub Actions/CI 未运行；Vercel preview 受免费部署额度限制，本次验收为本地测试 + CodeRabbit。
- iPhone Safari 软键盘、VoiceOver 和真实设备焦点表现未验证。

## 下一步

等待 PR #73 本次补丁复审。用户自行决定合并，之后再进行真机验收。
