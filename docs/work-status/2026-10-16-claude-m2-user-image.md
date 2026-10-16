# STATUS — 2026-10-16-claude-m2-user-image

更新人：Claude
更新时间：2026-10-16T18:20Z（UTC）
发现范围：2026-10-16 查看 yecays-ai/veil，base 为 origin/main 26241a2（含 M1，PR #233）；只看了远端，没有本地并行分支。

## 当前任务

M2 用户发图：存储与显示，待审查。不含图片送模型（M3）、TTS、语音。

## 谁在改哪里

Claude；分支 feat/m2-user-image；PR 见本分支的 PR。涉及：lib/chat/image-compress.ts、components/chat/messages/image-message.tsx（新）、lib/chat/engine.ts、components/chat/{chat-room,chat-plus-panel}.tsx、components/chat/messages/message-list.tsx、app/messages/chat.css、tests/{chat-image-send,chat-stickers,chat-layout-ui}.test.ts。base 26241a2。

## 已完成

- 「+」面板 Photos 可用，可多选（一次最多 9 张），每张压缩后作为一条消息发出；引用只带在第一张。
- 压缩：长边 2048、约 1 MB；已够小的原图（含 GIF 动图）原样保留；WebP 优先，Safari 回退 JPEG；压不下去则拒绝，不存大图。
- 图片气泡：按宽高比先占位，加载失败显示「图片已丢失」；点击大图查看并可保存；长按仍开消息菜单；多选模式下点击是选中。
- 模型只收到「[用户发送了一张图片]」，没有图片数据。
- 实测孤儿回收扫描（Node + fake-indexeddb）：1 千条 26 ms、1 万条 145 ms、5 万条 622 ms，仅在存在超过 1 小时的无引用资源时触发；未加索引。
- Chromium 真跑一遍：18 MB 噪点 PNG → 2048×1365 JPEG 865 KB，小图原样，非图片文件被拒并提示，大图查看可开可关。
- npm run typecheck 通过；lint 0 错误（3 条原有警告）；npm test 2090 条，2088 通过。

## 尚未验证

- 失败的 2 条（Regex、WorldBook 回滚锁）在 main 上同样失败，非本改动引起。
- Safari / iOS 真机（JPEG 回退、HEIC 选图、长按菜单与点击大图的手势）未测；Chromium 以外的 createImageBitmap 行为未测。
- 扫描耗时是 Node 模拟环境，不是真浏览器 IndexedDB。
- 群聊没有 + 面板，未涉及。

## 下一步

等 lan 审查并合并；之后按 M3 做图片送模型，需要 lan 说开始。
