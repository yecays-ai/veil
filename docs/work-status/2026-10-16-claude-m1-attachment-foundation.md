# STATUS — 2026-10-16-claude-m1-attachment-foundation

更新人：Claude
更新时间：2026-10-16T17:50Z（UTC）
发现范围：2026-10-16 查看 yecays-ai/veil，当时没有打开的 PR；base 为 origin/main 490679c；只看了远端，没有本地并行分支。

## 当前任务

M1 附件底座，待审查。只含已确认的底座范围，不含图片 UI、TTS 或后续功能。

## 谁在改哪里

Claude；分支 feat/m1-attachment-foundation；PR 见本分支的 PR。涉及：lib/chat/attachment.ts、lib/chat/message-kind.ts（新）、lib/chat/{types,storage,prompt,quote,recall}.ts、components/chat/message-actions/message-actions-overlay.tsx、lib/backup/{format,validation}.ts、docs/backup-format-v1.md、tests/{chat-attachments,backup-attachments,chat-stickers}.test.ts。base 490679c。

## 已完成

- ChatMessage 新增可选 attachment（引用 assets 行，一条消息一个资源）；消息与资源同一事务写入和删除；孤儿回收认得消息附件。
- 备份 chat 域升到 2，仍读 1；校验附件形状、角色、资源共享和缺失资源警告。
- npm run typecheck 通过；lint 0 错误（3 条原有警告）；npm test 2082 条，2079 通过。
- 新增 17 条测试；去掉引用扫描或资源删除后关键测试会失败。

## 尚未验证

- 3 条失败在 origin/main 上同样出现：Regex、WorldBook 的 rollback lock contention，以及偶发的 CF-02 retry；本改动未引入。
- 孤儿回收对大量消息做全表游标扫描的耗时未测。
- Safari / iOS 真机与 IndexedDB Blob 行为未测。

## 下一步

等 lan 审查并合并；之后按 M2 做用户图片存储与显示。
