# STATUS — 2026-10-17-claude-voice-cache-playback

更新人：Claude
更新时间：2026-10-17T18:55:00Z
发现范围：2026-10-17T18:50:00Z 基于 origin/main 0fa0cf3（#249 已合并）；本任务只动 lib/tts/voice-cache.ts、tests/voice-cache.test.ts 和本记录；开放 PR 里没有改这些文件的。

## 当前任务

Character 语音第二次播放报 "The operation is not supported"：缓存读出的 blob 先复制成内存 blob 再给播放器（待审查，不自动合并）。

## 谁在改哪里

Claude；分支 `fix/voice-cache-playback`；PR 见 PR 描述（创建后补链接）。

## 已完成

- `VoiceCache.get` 返回内存副本（同样的字节，type 缺失时按 audio/mpeg）。
- 检查（代码版本为本分支首个提交）：`voice-cache` 测试通过（含新增 1 项）。typecheck/lint 见 PR 描述。

## 尚未验证

- 根因是推断：第一次播放用的是刚生成的内存 blob 能响，第二次读 IndexedDB 里的 blob 就报错，符合 iOS Safari 对文件型 blob 的已知限制；沙箱没有 WebKit，只有 lan 的 iPhone 能验证。

## 下一步

lan 在预览地址验证第二次播放。
