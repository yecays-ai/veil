# STATUS — 2026-10-15-claude-sticker-display-scroll

更新人：Claude
更新时间：2026-10-15T18:50:00Z
发现范围：2026-10-15T18:25Z 通过 GitHub API 查看开放 PR：#212（聊天卡片/Reaction 布局，改 chat 卡片样式）和 #213（Life V1.5，不碰聊天 UI）。基线 origin/main c07dddbc21fd5a043a8582f39275d6dd1b8b9cbb。#212 若也改 app/messages/chat.css，合并时可能需要处理冲突。

## 当前任务

表情包无气泡显示、发送后滚动到底部。待审查，等 lan 真机验收，不自行合并。键盘问题已查明原因，等 lan 决定是否改。

## 谁在改哪里

Claude；分支 claude/sticker-display-scroll-fix；PR 见 GitHub。涉及 app/messages/chat.css（表情包气泡规则）、components/chat/chat-room.tsx（表情包图片加载后跟随滚动）、tests/chat-layout-ui.test.ts。

## 已完成

- typecheck、eslint（改动文件，仅有改动前就存在的 2 条 warning）通过。
- chat-layout-ui、chat-stickers、message-module-split 共 33 项通过（Node v22.22.0）。
- 在真实 Chromium 中验证：默认样式下表情包气泡无背景/内边距/边框；会话自定义 CSS 加了背景和内边距时，新规则仍能压住；捕获阶段的 load 监听能收到子图片的 load。

## 尚未验证

- 真机：无气泡、发送后滚动到底部、连续发送。
- 没有在默认样式下复现"有气泡"，真机上的原因是推断（见 PR）。
- 键盘行为未改动。

## 下一步

lan 验收并回答键盘问题。
