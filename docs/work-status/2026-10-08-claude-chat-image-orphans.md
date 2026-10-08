# STATUS — 2026-10-08-claude-chat-image-orphans

更新人：Claude
更新时间：2026-10-08T14:00:00+00:00
发现范围：2026-10-08 通过 GitHub API 查看开放 PR 与远端分支：开放 PR 仅 #36（Chat 首帧）；`fix/c9-binding-manager-safe-cleanup`（Codex，C9 Binding Manager）目前只有一份状态文档。基线 main `130d0c1`（含 #40）；本地无未提交改动。

## 当前任务

待审查：工单 04 — Chat 孤儿图片安全回收。

## 谁在改哪里

Claude；分支 `claude/brave-davinci-ws2ruk`；PR 创建后补链接（人工审查，不加 automerge）；涉及 `lib/chat/storage.ts`（图片引用辅助函数与 `saveChatImage`）、`tests/chat-image-orphans.test.ts`（新）。与 #36 同改 `lib/chat/storage.ts` 但位置不同（#36 在 revision 计数与 `peekExistingSession`），`git merge-tree` 试合并无冲突；与 Codex 的 C9 分支无文件重叠。

## 已完成

- 事实核对：聊天图片只有会话壁纸（`session.backgroundImage`）和全局壁纸（`globalChatBackgroundImage`）两种引用，消息没有图片字段；保存图片和挂载引用是两个事务，二者之间崩溃/刷新/挂载失败会留下无引用的资源。
- 修复：`saveChatImage` 的事务内先回收“无引用且超过 1 小时宽限期”的资源，再写入新图片；引用检查与删除和所有挂载操作处于同一 IndexedDB 事务；年龄未知的资源保留；进入聊天、读取、挂载都不扫描资源库。
- 复用 `deleteUnusedChatImage` 的引用检查（抽成 `referencedChatImageIds`），没有新增存储、元数据、后台任务。
- Node 24.21：`npm test` 545/545（新增 7 个），typecheck、lint、build 通过。去掉清扫、去掉宽限期、去掉引用检查三种变异分别使 4/3/3 个新测试失败。

## 尚未验证

- 真机 iPhone / 真实浏览器多窗口；测试使用假 IndexedDB 与顺序化的事务。
- 孤儿只在下一次保存图片时回收；不再保存图片就不会回收（有界，不新增后台任务）。

## 下一步

等待 CodeRabbit 与人工审查；不自动合并。建议合并顺序：先 #36 或先本 PR 均可，二者可干净合并。
