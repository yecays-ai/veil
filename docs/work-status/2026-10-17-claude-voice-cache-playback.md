# STATUS — 2026-10-17-claude-voice-cache-playback

更新人：Claude
更新时间：2026-10-17T18:55:00Z
发现范围：2026-10-17T18:50:00Z 基于 origin/main 0fa0cf3（#249 已合并）；本任务只动 lib/tts/voice-cache.ts、tests/voice-cache.test.ts 和本记录；开放 PR 里没有改这些文件的。

## 当前任务

Character 语音重播在 iPhone 上报 "The operation is not supported"，或读不出缓存而重新生成（语气变了）：缓存改存原始字节，读出来给播放器内存 blob（待审查，等 lan 真机验证再合并）。

## 谁在改哪里

Claude；分支 `fix/voice-cache-playback`；PR #251（https://github.com/yecays-ai/veil/pull/251）。

## 已完成

- 新片段以字节（ArrayBuffer + type）存入原来的 `audio` 存储，不改库版本和缓存键；以前存成 blob 的旧片段仍能读，读出来转成内存 blob，下次重新生成时被字节版覆盖。字节在开事务之前读好，事务内不做别的异步工作。
- 检查（代码版本为本分支最新提交，基于 main 0fa0cf3）：`voice-cache` 10、`chat-voice` 10、`voice-message-ui` 4 项通过；`npm run typecheck` 通过；`npm run lint` 0 错误（3 个已有警告）；未运行 build 与全量 `npm test`。

## 尚未验证

- 根因是推断：lan 真机上第一次（刚生成）能响，之后读缓存时有时报 not supported、有时读不出来而重新生成，符合 iOS Safari 对 IndexedDB 文件型 blob 的限制；沙箱没有 WebKit，只有 lan 的 iPhone 能验证。

## 下一步

lan 在预览地址验证第二次播放。
