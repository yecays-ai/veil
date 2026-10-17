# STATUS — 2026-10-17-claude-minimax-relay

更新人：Claude
更新时间：2026-10-17T17:40:00Z
发现范围：基于 origin/main c1a27ec92e8e6d1b65b5b3c719898bb7af683052（2026-10-17 拉取）；未查并行 PR 的文件重叠（本任务只动 lib/tts、tts-settings、app/api/tts）。

## 当前任务

MiniMax TTS 改走 VEIL 服务端 relay（待审查）。

## 谁在改哪里

Claude；分支 `feat/minimax-relay`；PR #246（https://github.com/yecays-ai/veil/pull/246）；涉及 `app/api/tts/minimax/route.ts`、`lib/tts/minimax-relay.ts`、`lib/tts/speech.ts`、`lib/tts/config.ts`、`components/settings/tts-settings.tsx`、`tests/tts-providers.test.ts`、`tests/voice-cache.test.ts`。

## 已完成

- 浏览器只请求 `/api/tts/minimax`；服务端按 Region 固定 host（国际 api.minimax.io、中国大陆 api.minimaxi.com）请求 `/v1/t2a_v2`，返回 audio/mpeg。Preview 与角色语音共用同一条路径。
- Key 只在单次请求头里转发，不入库、不记日志、不进 URL、不回显；MiniMax 原始正文不返回，只返回类别与状态码/数字码。
- 移除 MiniMax 的浏览器探测与 Base URL override；OpenAI-compatible / ElevenLabs 未改。
- 自动化测试（fake fetch）：npm run typecheck、lint 通过；npm test 2241 项，仅 2 个已知失败（Regex/WorldBook rollback lock）；npm run build 通过，路由为动态 ƒ。

## 尚未验证

- 真实 MiniMax API（沙箱无法访问、无 Key）。
- iPhone Safari 真机、Vercel 上 relay 的真实响应体积/超时行为。

## 下一步

lan 在测试链接用真 Key 验收 Preview、角色语音及二次播放走本地缓存。
