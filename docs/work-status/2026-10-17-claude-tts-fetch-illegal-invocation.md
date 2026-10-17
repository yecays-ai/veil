# STATUS — 2026-10-17-claude-tts-fetch-illegal-invocation

更新人：Claude
更新时间：2026-10-17T17:45:00Z
发现范围：2026-10-17T17:35:00Z 基于 origin/main 4769627；通过 GitHub 看到开放 PR #247（credentials，按 lan 要求不合并、不带入）；本任务只改 lib/tts/speech.ts、tests/tts-providers.test.ts 和本记录，与 #247 都动 speech.ts，但不在同一行（#247 改 `post` 的 credentials 参数），合并顺序不同可能需要手动解决冲突。

## 当前任务

修复浏览器 TTS 的 `fetch` Illegal invocation（待审查，按 lan 要求不自动合并）。

## 谁在改哪里

Claude；分支 `fix/tts-fetch-illegal-invocation`；PR #248（https://github.com/yecays-ai/veil/pull/248）；`lib/tts/speech.ts`、`tests/tts-providers.test.ts`。

## 已完成

- `post()` 与失败探测不再以 `call.fetchImpl(...)` 方法形式调用 fetch，改为先取局部变量再调用（保持 `options.fetchImpl` 注入）。
- 新增回归测试：用「被当作方法调用就抛 Illegal invocation」的宿主绑定 fetch 替身，覆盖三个 provider 的正常请求和探测路径；在旧实现上 2 项失败，新实现通过。
- 未动 MiniMax relay、payload、Region、错误分类。

## 尚未验证

- iPhone Safari 真机（Preview、角色语音、二次播放走缓存）和真实 MiniMax / OpenAI / ElevenLabs API。

## 下一步

lan 在测试链接验收；通过后再决定 relay 是否保留、#247 是否关闭。
