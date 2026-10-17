# STATUS — 2026-10-17-claude-voice-marker-echo

更新人：Claude
更新时间：2026-10-17T19:35:00Z
发现范围：2026-10-17T19:30:00Z 基于 origin/main 5aea459；#254 改 `lib/tts/transcribe.ts`，与本任务路径不重叠（以 GitHub 当时的列表为准）。

## 当前任务

角色把历史里的语音标记 `[你发送了一条语音消息：…]` 原样当文字发出来（lan 截图）。回复落库前，把这个标记里的话取出来：提供了语音就做成语音气泡，没有就当普通文字；标记本身不再显示（lan 已说直接合并，CI 与小兔子干净后合并）。

## 谁在改哪里

Claude；分支 `fix/voice-marker-echo`；PR #255（https://github.com/yecays-ai/veil/pull/255）。改动：`lib/chat/attachment.ts`（`takeVoiceMarker`）、`lib/chat/engine.ts`（回复收尾处）、`tests/chat-voice.test.ts`。

## 已完成

- 检查：`chat-voice` 12（新增 2 项：有语音、无语音、已有语音动作、多个标记；流式草稿只显示话）、`chat-user-voice` 11、`voice-message-ui` 4 项通过；`npm run typecheck` 通过；改动文件 eslint 无输出；未运行 build 与全量 `npm test`。

## 尚未验证

- 原因是推断：#250 让历史里的角色语音写成该标记，模型照着写进了文字；没有拿到当时发给模型的提示词，也没有在真机复现。
- 流式输出时完整的标记只显示里面的话（中途停止或失败也不留方括号）；还没写完的半个标记会短暂出现。

## 下一步

合并后 lan 在手机上再让角色发一次语音，看是否只出现一个语音气泡、不再有方括号文字。
