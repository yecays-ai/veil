# STATUS — 2026-10-08-claude-chat-first-frame-complete

更新人：Claude
更新时间：2026-10-08T06:30:00+00:00
发现范围：2026-10-08T06:25Z 通过 GitHub API 与本地分支查看；开放 PR 里没有与聊天会话/首屏相关的改动；未检查未开 PR 的远端分支；本地无未提交改动。

## 当前任务

进行中：进入聊天时第一帧就显示完整界面（壁纸加聊天记录），不再"先空壁纸、后聊天记录"。

## 谁在改哪里

Claude；分支 `fix/chat-first-frame-complete`；PR 尚未创建；涉及 `lib/chat/session-prefetch.ts`（新）、`lib/chat/storage.ts`（`peekExistingSession`、`changeRevision`）、`lib/chat/session-lifecycle.ts`（`seed`）、`components/chat/use-chat-session.ts`、`components/chat/messages-home.tsx`、`tests/chat-session-prefetch.test.ts`。

## 已完成

- 用户录屏（iOS）与 Chromium 逐帧测量都确认：#33 之后壁纸已在第一帧，但聊天记录要晚 10~190ms，形成"空壁纸帧"。
- 在 Chromium（按住 100ms 后点按，CPU 1x/4x/6x）测量：从 Chats 列表进入聊天，每次都没有空壁纸帧，也没有回退帧。
- `npm run typecheck`、`npm run lint`、`npm test`（480/480）在本地通过；去掉预取种子、去掉生命周期种子、让种子忽略修订号三种改动各自让对应测试失败。

## 尚未验证

- iOS Safari 真机：未测（环境无设备）。
- 只有从 Chats 列表按下进入会预取；从联系人页等入口进入没有提前量，行为与以前相同（第一帧仍可能有空壁纸帧）。
- 首次打开页面、第一次进入某个角色仍需读存储并解码。

## 下一步

开 PR，处理 CodeRabbit 评论；由用户在 iOS 真机上验收后决定是否合并。
