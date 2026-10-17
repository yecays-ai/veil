# STATUS — 2026-10-17-claude-m3-image-to-model

更新人：Claude
更新时间：2026-10-17T05:42Z（UTC）
发现范围：2026-10-17T05:41Z 查看 yecays-ai/veil 远端，base 为 origin/main 13de4397b69ec65bb336642476414dd62c2ae36e（含 M1 #233、M2 #234、M2 验收修复 #235）；当时没有打开的 PR，所以没有重叠路径。

## 当前任务

状态：待审查（CI 已通过，等 lan 真机验收）。

M3：用户发的聊天图片送给模型。只做图片送模型，不做 AI 发图、TTS、语音。

## 谁在改哪里

Claude；分支 feat/m3-image-to-model；PR：https://github.com/yecays-ai/veil/pull/236。涉及：lib/api-config.ts、lib/chat/{types,prompt,engine,provider,request-diagnostics}.ts、lib/chat/image-input.ts（新）、lib/backup/{validation,static-export}.ts、components/settings/text-api-settings.tsx、tests/chat-image-input.test.ts（新）。

## 做法

- `ApiConfig` 新增可选 `imageInput`（默认关）和 `imageLimit`（1–4，默认 1）。旧配置没有这两个字段，视为不支持，行为不变。
- 组装 prompt 时，用户发的带图片的消息（AI 消息的附件暂不送；M7 做 AI 发图时再定）（未撤回）在对应 turn 上记 `images`（asset id）。引擎在请求前只保留最新 N 个带图 turn，其余图片退回语义文本，再读 Blob 转成 data URL（`imageData`）。图片 id 只来自本次会话的消息，不会读到别的会话。
- 图片丢失或读取失败：该张图不发，turn 保留语义文本，不让回复失败。停止（abort）在读图过程中生效。
- provider 发出的 messages 只含 role/content；带图 turn 展开为 `text + image_url`。引擎自己的字段不会进请求体。
- 诊断只记图片张数和字节数，不记内容。
- 备份：`apiConfigs` 的白名单和校验接受这两个可选字段（值非法会被拒绝，API Key 仍不进备份）。域版本不升；只有设置了这两个字段的新备份放进旧版 VEIL 会因未知字段被拒绝。

## 已验证（自动化测试，Node + fake IndexedDB；不是真机）

- tests/chat-image-input.test.ts（12 条）：开关与数量规则、只保留最新 N 张、丢图/非图片/中止、请求体形状、诊断、引擎端到端（开/关/上限/别的会话/撤回）、备份往返与非法值。
- npm run typecheck 通过；lint 0 错误（3 条原有警告）；npm test 全量仅有 2 条在 main 上同样失败（Regex、WorldBook 回滚锁）。

## 尚未验证

- 真实模型：没有调用任何付费模型，`image_url` 的 data URL 格式按 OpenAI 兼容约定实现，具体供应商是否接受需 lan 用自己的 API 在真机上验证。
- 设置页开关的真机样式。

## 下一步

lan 在测试链接上打开 Settings → Text API，对支持看图的模型打开「Image input」，发一张图确认模型能描述。M4 起等 lan 说开始。
