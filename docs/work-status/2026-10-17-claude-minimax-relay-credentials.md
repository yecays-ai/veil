# STATUS — 2026-10-17-claude-minimax-relay-credentials

更新人：Claude
更新时间：2026-10-17T18:10:00Z
发现范围：2026-10-17T18:05:00Z 基于 origin/main 4769627，并已合入 #248 分支（fix/tts-fetch-illegal-invocation，head e79e4c3）的修复；本任务只动 lib/tts/speech.ts、tests/tts-providers.test.ts 和本记录。PR #247 的 base 改为 #248 分支，#248 合并后自动回到 main。

## 当前任务

MiniMax relay 请求带同源 cookie（待审查，按 lan 要求不自动合并）。

## 谁在改哪里

Claude；分支 `fix/minimax-relay-credentials`；PR #247（https://github.com/yecays-ai/veil/pull/247）；依赖 #248 的 fetch 修复。

## 已完成

- 只有 MiniMax relay 这一条同源请求用 `credentials: "same-origin"`，OpenAI-compatible 与 ElevenLabs 仍是 `omit`；`post()` 增加可选 credentials 参数，默认 `omit`。
- 依据：真机 iPhone 得到的 `HTTP 401 (VEIL server)` 走的是前端「响应不是 relay 的 JSON」分支（`speech.ts` 的 fallback），relay 自己的 401 一定带 JSON category；最可能是 Vercel Preview 访问保护在请求不带 cookie 时直接回 401。这是推断，不是直接证据。
- 测试：MiniMax relay 请求断言 same-origin；新增断言 OpenAI/ElevenLabs 仍是 omit。
- 检查命令与结果见 PR 描述。

## 尚未验证

- Vercel Preview 保护下，带 cookie 后 `/api/tts/minimax` 是否不再返回平台层 401（只能真机验证）；真实 MiniMax 音频。

## 下一步

lan 在 PR 预览地址验收；若仍 401，记录完整安全错误文字后再判断。
