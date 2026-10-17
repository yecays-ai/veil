# STATUS — 2026-10-17-claude-m5-ai-voice

更新人：Claude
更新时间：2026-10-17T06:55Z（UTC）
发现范围：2026-10-17T06:50Z 查看 yecays-ai/veil 远端，base 为 origin/main b0c6fa68960543ca93299b0e03728afa1cdc7a1f（含 M1–M4）；没有其它打开的 PR，无重叠路径。

## 当前任务

状态：待审查。M5：AI 语音消息。Character 用动作行里的 `voice` 字段决定这一条说成语音；不新增模型调用，没有"全语音模式"。

## 谁在改哪里

Claude；分支 feat/m5-ai-voice；PR：见本分支在 GitHub 上的 PR（开 PR 后补链接）。涉及：lib/chat/{types,self-context,message-kind,storage,engine}.ts、lib/presence/actions.ts、lib/backup/validation.ts、lib/tts/voice-cache.ts（新）、components/chat/messages/{voice-message(新),message-list}.tsx、components/chat/chat-room.tsx、app/messages/chat.css、tests/{chat-voice,voice-cache,voice-message-ui}.test.ts（新）及三处源码断言更新。

## 做法

- 数据：`ChatMessage.voice?: true`，转写文字就是普通可编辑的 `content`。旧数据没有该字段，不迁移；聊天域版本不变。备份校验只接受 assistant、v≥2、且不与贴纸/附件/转账/礼物/事件/撤回并存的 voice。
- 触发：只有已保存可用的 TTS 配置时，提示词才会告诉 Character 可以用 `voice`（≤300 字）；continue 和上一条已是语音时不提供。回复里 voice 文字变成一条语音气泡，排在贴纸之前。
- 播放：点击气泡才请求一次 TTS，音频存在独立 IndexedDB `veil-voice-cache-v1`（按 messageId，文字/音色/模型/服务不变才复用，上限 64 MiB 按最久未用淘汰）。同一条同时只发一个请求；页面每次加载清理一次已不存在的消息的缓存。同一时间只播一条；可展开/收起文字。
- 编辑文字后 key 变化，指纹不同，会重新合成；撤回、重新生成会清掉 voice。

## 已验证（自动化测试：Node + fake IndexedDB + jsdom；不是真机）

- tests/chat-voice.test.ts（9）、tests/voice-cache.test.ts（7）、tests/voice-message-ui.test.ts（4）。
- typecheck 通过；lint 0 错误；npm test 全量仅 Regex、WorldBook 回滚锁 2 条失败（main 上同样失败）。

## 尚未验证

- 真实模型是否会输出 voice 动作、真实 TTS 服务的音频与 CORS、iOS Safari 播放、气泡真机样式。没有调用任何付费服务。

## 下一步

合并后做 M6（用户语音）。
