# STATUS — 2026-10-17-claude-m4-tts-settings

更新人：Claude
更新时间：2026-10-17T06:40Z（UTC）
发现范围：2026-10-17T06:20Z 查看 yecays-ai/veil 远端，base 为 origin/main 305964b76d50040f07ad4dc01562a5810376746f（含 M1–M3）；当时没有其它打开的 PR，无重叠路径。

## 当前任务

状态：待审查。M4：语音（TTS）设置与调用。不碰任何消息、聊天界面或气泡（那是 M5）。

## 谁在改哪里

Claude；分支 feat/m4-tts；PR 见 GitHub 上本分支的 PR。涉及：lib/tts/{config,config-storage,speech}.ts（新）、components/settings/tts-settings.tsx（新）、app/settings/tts/page.tsx（新）、app/settings/page.tsx（加入口）、lib/bindings.ts（BindingSlot 加可选 `ttsVoice`、`BindingField`）、lib/chat/provider.ts（把 URL 校验抽成 `endpointUrl`，`completionUrl` 行为不变）、tests/{tts,tts-settings-ui}.test.ts（新）。

## 做法

- 设置：Settings → Voice (TTS)。Base URL、API Key、Model、默认音色。存在设备上单独的 IndexedDB（`veil-tts-config-v1`，一行），不进备份、不进恢复、不出现在 Text API 列表里。
- 调用：`synthesizeSpeech` 发一次 OpenAI 兼容的 `POST {base}/audio/speech`（要 mp3），无重试、无缓存，60 秒超时，音频上限 25 MiB，非音频/空响应当作无效。错误分类：config / network / auth(401,403) / rate-limit(429) / http / timeout / invalid-audio；不显示也不记录响应正文和 Key。停止信号原样抛出，不当作失败。
- 音色：`ttsVoice` 作为 binding 的可选标量，优先级 Character > 全局 > 设置里的默认音色 > `alloy`。Bindings 页面不展示它，只在 Voice 设置页里按 Character 编辑（失焦保存）。备份的 bindings 域已经用同一个规范化函数，旧备份照常恢复；带 `ttsVoice` 的新备份放进旧版 VEIL 会因未知字段被拒绝。
- 试听：用屏幕上当前填的值发一次请求并播放，离开页面时停止并释放音频。

## 已验证（自动化测试：Node + fake IndexedDB + jsdom；不是真机）

- tests/tts.test.ts（9 条）：URL 规则、请求体与头、错误分类且不带正文/Key、超时与停止、配置缺失不发请求、音色优先级、配置存储、备份往返。
- tests/tts-settings-ui.test.ts（4 条）：加载与试听、Save 才落盘、Character 音色写入 bindings 并用于试听、Key 被拒时的提示。
- typecheck 通过；lint 0 错误（3 条原有警告）；npm test 全量仅 Regex、WorldBook 回滚锁 2 条失败（main 上同样失败）。

## 尚未验证

- 真实语音服务：没有调用任何付费服务；跨域（CORS）、iOS Safari 播放 mp3 都需要在真机上用 lan 自己的服务验证。
- Voice 设置页的真机样式。

## 下一步

合并后做 M5（AI 语音消息）。
