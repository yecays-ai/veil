# STATUS — 2026-10-15-claude-chat-history-sideways

更新人：Claude
更新时间：2026-10-15T17:40:00Z
发现范围：2026-10-15 17:25Z 起点 `origin/main` 为 `996b53741b6ef3e9c273993cfafbfa51be241aa0`（#210 合并后）；同时间远端开放 PR 未逐个检查改动文件，本任务只改 `app/messages/chat.css` 与 `tests/chat-layout-ui.test.ts`。

## 当前任务

待 lan 在 iPhone 上彼得原会话真机验收（只有那里不能再左右拖动才算通过）。已修复的是容器允许横向滚动的通用缺陷；彼得旧会话里是什么内容触发横向溢出，尚未确认。聊天记录区域可被手指左右拖动（松手后弹回），壁纸、顶部栏、输入框不动。

## 谁在改哪里

Claude；分支 `claude/project-thread-iwht8v`；PR：https://github.com/yecays-ai/veil/pull/211。只改 `.chat-history` 的 CSS 两行与一条回归测试，不碰生活模式、消息生成、会话数据。

## 已完成

- 原因：`.chat-history` 只写了 `overflow-y: auto`，另一个方向按 CSS 规则也算成 `auto`，任何一个比屏幕宽的子元素都会让它能横向滚动。
- 修复：加 `overflow-x: hidden` 与 `touch-action: pan-y`。
- 检查：手机尺寸 Chromium 模拟横向滑动，塞入 520px 宽元素时修复前 `scrollLeft` 变为 154，修复后保持 0；`tests/chat-layout-ui.test.ts` 新增一条回归断言。

## 尚未验证

- iPhone 真机：横向无法拖动、上下滚动正常、消息菜单/表情包/转账/礼物不被裁切。
- 彼得旧会话里到底是哪个元素撑宽：没有他的数据，未定位；本修复只是不让它被拖动，元素本身可能仍超宽被裁掉。

## 下一步

lan 真机验收后再合并。
