# STATUS — 2026-10-17-claude-m6-user-voice

更新人：Claude
更新时间：2026-10-17T07:10Z（UTC）
发现范围：2026-10-17T07:05Z 查看 yecays-ai/veil 远端；M5（#238）尚未合并，本分支暂叠在 M5 之上，合并后会改基到 main。没有其它打开的 PR，无重叠路径。

## 当前任务

状态：待审查。M6：用户语音消息。用户录音、试听、写好文字后发送；Character 读到的是文字，气泡复用 M5 的语音样式。

## 谁在改哪里

Claude；分支 feat/m6-user-voice；PR：见本分支在 GitHub 上的 PR（开 PR 后补链接）。涉及：lib/chat/attachment.ts（`MessageAttachment` 变成 image / audio 两种）、lib/chat/{storage,engine,message-kind,voice-recorder(新)}.ts、lib/tts/{config,transcribe(新)}.ts、components/chat/{voice-recorder-panel(新),chat-plus-panel,chat-room}.tsx、components/chat/messages/{audio-message(新),message-list,image-message,voice-message}.tsx、components/settings/tts-settings.tsx、app/messages/chat.css、tests/{chat-user-voice,voice-recorder-ui}.test.ts（新）及两处断言更新。

## 做法

- 数据：`attachment` 加一种 `{kind:"audio", assetId, mime, durationMs, bytes}`（5 个字段，webm/mp4/ogg，≤10 MiB，≤120 秒），录音字节放进已有的 `assets`，与消息同事务写入、同事务删除；`content` 是文字（≤1000 字）。旧数据与备份格式不变，备份校验按种类检查。
- 录音：`MediaRecorder`（webm/opus 优先，Safari 用 mp4），时长用开始到停止的真实时间，到 120 秒自动停；停止、取消、离开页面都会释放麦克风。
- 发送：+ 面板的 Voice → 录音 → 可试听 → 写文字 → Send。没有文字不能发（模型只读文字）。Voice 设置里新增可选的 Speech-to-text model；填了就在录完后发一次 `/audio/transcriptions` 自动填入文字，用户可改；失败只提示，不阻止手写。
- 显示：用户语音气泡播放自己的录音，时长是真实录音时长，可展开文字；与 Character 语音共用一个"同时只响一条"。语音消息不可编辑（文字固定）；Photos 列表不含语音。

## 已验证（自动化测试：Node + fake IndexedDB + jsdom；不是真机）

- tests/chat-user-voice.test.ts（9）、tests/voice-recorder-ui.test.ts（4）。
- typecheck 通过；lint 0 错误；npm test 全量仅 Regex、WorldBook 回滚锁 2 条失败（main 上同样失败）。

## 尚未验证

- 真机麦克风权限、iOS Safari 的 MediaRecorder（mp4）录音与回放、真实语音识别服务的 CORS 与返回格式。没有调用任何付费服务。

## 下一步

M5 合并后改基到 main、开 PR；之后做 M7（AI 生图）。
