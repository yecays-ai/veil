# STATUS — 2026-10-08-claude-chat-broadcast-publish

更新人：Claude
更新时间：2026-10-08T15:00:00+00:00
发现范围：2026-10-08 通过 GitHub API 与本地分支查看：开放 PR 为 #36（Chat 首帧，改 `lib/chat/storage.ts` 的 revision / `peekExistingSession`）与 #42（Codex，C9 Binding Manager，改 Binding / Text API 适配器）；#41 已合并。基线 main `79f937b`；本地无未提交改动。

## 当前任务

待审查：工单 05 — C8 Chat 跨窗口通知可靠性修复。

## 谁在改哪里

Claude；分支 `claude/brave-davinci-ws2ruk`；PR [#43](https://github.com/yecays-ai/veil/pull/43)（人工审查，不加 automerge）；涉及 `lib/chat/storage.ts`（`openChannel` / `receive` / `notify` / `subscribe`）、`tests/chat-storage-broadcast.test.ts`（新）、`tests/generation-safety.test.ts`（仅一条用例把 `BroadcastChannel` 置空）。

## 已完成

- 复现：从未调用 `subscribe()` 的窗口写入成功后，另一个正在监听的窗口收到 0 条通知（旧实现）。
- 根因：`BroadcastChannel` 只在 `subscribe()` 里创建，`notify()` 只对已存在的频道发送。
- 修复：每个存储实例首次使用时懒创建一个频道（发布不依赖订阅）；接收只在存在监听者时通过 `onmessage` 赋值开启，最后一个监听者退订时置空；接收到的变更只走本地 `dispatch`，不重新广播；仍然只在事务提交成功后通知。
- 没有新增事件总线、轮询或常驻订阅；未改动持久化、事务和 UI。
- Node 24.21：`npm test` 551/551（新增 6 个），typecheck、lint、build 通过。旧实现下 2 个新测试失败；另外三种变异（回声、每次订阅新开频道、退订后继续接收）各使对应测试失败。

## 尚未验证

- 真实浏览器多窗口 / iPhone（含后台标签页节流）；测试用 Node 真实 `BroadcastChannel`，单进程多个存储实例代表多个窗口。
- “事务已执行完、提交时才失败”这条路径用 fake IndexedDB 无法单独模拟；写入抛错与事务中止两种失败已验证不会通知。

## 下一步

等待 CodeRabbit 与人工审查；不自动合并。
