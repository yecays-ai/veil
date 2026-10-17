# STATUS — 2026-10-17-claude-stt-error-diagnosis

更新人：Claude
更新时间：2026-10-17T19:10:00Z
发现范围：2026-10-17T19:00:00Z 基于 origin/main 0fa0cf3；开放 PR #251 动 lib/tts/voice-cache.ts、#252 动 lib/chat/provider.ts，与本任务（lib/tts/transcribe.ts）不重叠。

## 当前任务

语音转文字（Groq）在 iPhone 上显示 "could not reach the speech-to-text service" 却看不出是没连上还是被浏览器拦了：失败时和 TTS 一样用一次无密钥的 no-cors 探测区分 network 与 cors，并显示主机名（待审查，等 lan 真机验证再合并）。

## 谁在改哪里

Claude；分支 `fix/stt-error-diagnosis`；PR #253（https://github.com/yecays-ai/veil/pull/253）。

## 已完成

- `transcribeAudio` 请求失败后，向同一服务的 origin 发一次 GET（no-cors、不带密钥、不带请求体、8 秒上限），能到达则为 cors，否则 network；错误文字带主机名。请求体、地址、超时、HTTP 错误分类都不变。
- 检查（代码版本为本分支首个提交，基于 main 0fa0cf3）：`chat-user-voice` 11（含新增 1 项）、`chat-voice` 10、`voice-message-ui` 4、`tts-providers` 19 项通过；`npm run typecheck` 通过；`npm run lint` 0 错误（3 个已有警告）；未运行 build 与全量 `npm test`。

## 尚未验证

- Groq 的真实情况：是地址、浏览器拦截还是别的原因，需要 lan 手机上更新后看新的错误文字；沙箱访问不了 Groq。

## 下一步

lan 更新后重试一次语音，把新的 STT 报错发回；据此决定是否改配置或代码。
