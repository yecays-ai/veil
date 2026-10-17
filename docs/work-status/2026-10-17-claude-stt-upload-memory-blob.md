# STATUS — 2026-10-17-claude-stt-upload-memory-blob

更新人：Claude
更新时间：2026-10-17T19:20:00Z
发现范围：2026-10-17T19:10:00Z 基于 origin/main 5aea459（#253 已合并）；当前没有改 lib/tts/transcribe.ts 的其他开放 PR（以 GitHub 当时的列表为准）。

## 当前任务

Groq 语音转文字在 iPhone 上报 "request failed although the service (api.groq.com) answered a plain check, most likely CORS"：上传前把录音复制成内存 blob（待审查，lan 已说直接合并，CI 与小兔子干净后合并）。

## 谁在改哪里

Claude；分支 `fix/stt-upload-memory-blob`；PR #254（https://github.com/yecays-ai/veil/pull/254）。

## 已完成

- `transcribeAudio` 上传前 `await recording.arrayBuffer()`（读取失败按 TtsError 的 invalid-audio 处理，不发请求），用同类型的内存 Blob 放进 FormData；请求地址、请求体字段、超时、错误分类不变。
- 检查（代码版本为本分支最新提交，基于 main 5aea459）：`chat-user-voice` 12（含改写的 1 项、新增录音读取失败 1 项，断言上传的是读入内存的那份字节且大小/类型不变）、`chat-voice` 10、`voice-message-ui` 4 项通过；`npm run typecheck` 通过；`npm run lint` 0 错误（3 个已有警告）；未运行 build 与全量 `npm test`。

## 尚未验证

- 根因是推断：Groq 对无密钥探测有回应而真实请求失败，与 iOS Safari 对 IndexedDB 文件型 blob 上传失败的已知限制一致（同 #251 的语音缓存问题）；也可能是真正的 CORS 或别的原因。沙箱访问不了 Groq，且没有 WebKit。

## 下一步

lan 更新后重试一次语音；若仍失败，把新的报错文字发回，再看 Groq 的预检与响应头。
