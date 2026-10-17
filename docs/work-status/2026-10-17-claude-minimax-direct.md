# STATUS — 2026-10-17-claude-minimax-direct

更新人：Claude
更新时间：2026-10-17T18:50:00Z
发现范围：2026-10-17T18:10:00Z 基于 origin/main 5158713（#248 已合并）；通过 GitHub 看到开放 PR #247（relay 同源 cookie，本 PR 取代它，合并前由 lan 决定关闭）；本任务动 lib/tts/speech.ts、lib/tts/config.ts、components/settings/tts-settings.tsx、tests/tts-providers.test.ts、tests/voice-cache.test.ts，并删除 app/api/tts/minimax/route.ts 与 lib/tts/minimax-relay.ts。

## 当前任务

MiniMax 改回浏览器直连 `{Region host}/v1/t2a_v2`，去掉 VEIL 服务端 relay（待审查，按 lan 要求不自动合并）。

## 谁在改哪里

Claude；分支 `fix/minimax-direct`；PR #249（https://github.com/yecays-ai/veil/pull/249）；依赖 #248 的 fetch 修复。

## 已完成

- 去掉 #246 的 relay 路由和库；`minimaxSpeech` 直接 POST Region 对应的 host，请求体沿用原来的 model/text/stream/output_format/voice_setting/audio_setting，不改 Region、endpoint、音频参数。
- 失败走与 OpenAI/ElevenLabs 相同的路径：网络失败后无密钥的 no-cors 探测区分 network 与 cors；HTTP 401/403 为 auth；`base_resp.status_code` 1004 为 auth、1002/1039 为 rate-limit、1001 为 timeout、其他只显示数字，`status_msg` 不展示；所有请求 credentials 为 omit。
- 设置页提示改为「Key 只保存在这台设备，只发给 MiniMax」。
- 为什么改：relay 是基于误判（把 fetch Illegal invocation 当成 CORS）做的；Float 直连 MiniMax 能在真机运行；真机上 relay 先后得到 HTTP 401 (VEIL server) 与 could not be reached (VEIL server)。
- 检查（代码版本 8c7cd6d，基于 main 5158713）：`npx tsc --project tsconfig.tests.json` 后用 `node --test "$PWD/node_modules/.cache/veil-desktop-tests/tests/<file>.test.js"` 跑 `tts-providers` 19、`voice-cache` 8、`chat-voice` 9、`chat-user-voice` 10、`voice-message-ui` 4 项全部通过；`npm run typecheck` 通过；`npm run lint` 0 错误（3 个警告在未改动的聊天文件里）；`npm run build` 通过；未运行全量 `npm test`。

## 尚未验证

- iPhone Safari 真机直连 MiniMax（CORS 是否放行、Mainland China 与 International 两个 host）和真实音频；沙箱无法访问 MiniMax 与预览域名。

## 下一步

lan 在 PR 预览地址验收；通过后决定是否关闭 #247、是否借鉴 Float 的 speed/pitch/language_boost/emotion 与更高音频参数。
