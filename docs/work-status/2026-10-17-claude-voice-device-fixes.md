# STATUS — 2026-10-17-claude-voice-device-fixes

更新人：Claude
更新时间：2026-10-17T16:45:00+00:00
发现范围：2026-10-17T16:22Z 通过 GitHub REST 查询 `yecays-ai/veil` open PR（含草稿）：无；base 为 `origin/main` 1ac67afb8ac87813ad30ba1c2870a9e573061b4b。

## 当前任务

PR #244 合并后 iPhone 真机验收的两个问题：录音输入栏 UI、MiniMax 真实 TTS 连通；并带上 CodeRabbit 在 #244 合并后补的 Send again 小问题。待审查。

## 谁在改哪里

Claude；分支 `fix/voice-device-acceptance`；PR 尚未创建。涉及 `app/messages/chat.css`、`components/chat/chat-room.tsx`、`components/settings/tts-settings.tsx`、`lib/tts/{config,speech,voice-cache}.ts`、`tests/tts-providers.test.ts`。

## 已完成

- UI 根因：全局 `.chat-app button`（特异性高于 `.chat-voice-bar` / `.chat-voice-slot`）给它们加了边框、填充、10px 圆角、padding 和 0.8em 字号。已用更高特异性覆盖，文案居中，三态共用同一个输入框外壳。已用本地 Chromium 截图核对三态（证据等级：自动化截图，非 iPhone 真机）。
- MiniMax：新增 Region（International / Mainland China），Base URL 降为高级覆盖；失败分类新增 `cors`（探测请求能到达主机）与 `network`，错误提示带服务名、主机与状态码，不含 Key 和服务端原文。
- 「Send again」不再被其他错误顶掉。
- `npm run typecheck`、`npm run lint`（0 error）、`npm run build` 通过；完整测试 2238 项通过 2236，失败 2 项为 main 已知的 Regex / WorldBook rollback-lock。

## 尚未验证

- 未做 MiniMax 真实 API 诊断：本环境无法访问 MiniMax（代理 403），也没有 Key。中国区 host 取自 platform.minimax.cn 当前 T2A 文档（`api.minimax.cn`），旧文档示例还有 `api.minimaxi.com`，未经真实请求确认。
- 未判定是否需要 TTS relay，等真机 Preview 给出新的错误分类后再决定，未实现。
- iPhone 真机的录音条外观。

## 下一步

PR 合并并同步测试链接后，由 lan 在真机点 Preview，按新的错误提示判断失败层级。
