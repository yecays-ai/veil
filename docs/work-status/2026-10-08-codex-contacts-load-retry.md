# STATUS — Contacts load failure recovery

更新时间：2026-10-08
基准 main：`0c00851f7fc74195f859ddbafefd43f5d9ad0960`（merge #51）
核对：#49 和 #51 已合并；#36 保持冻结。

## 页面核查

Contacts 数据经 `components/use-contacts.ts` 订阅 `liveContacts`，数据由 `browserContactStorage.load()` 读取。`useContacts` 已公开 `retry`。共享 `createLiveDocument` 对同一进行中的读取复用 Promise；跨标签页变化递增 revision，迟到的旧读取会被丢弃。订阅卸载时移除该组件的监听回调；读取属于应用级共享状态，完成后可供后续路由使用。

| 页面 | 失败表现 | 原有恢复 | 处理 |
| --- | --- | --- | --- |
| Contacts 列表 (`ContactsHome`) | 显示 `contacts.error` | 无可见 Retry | 增加 Retry |
| Add Contact (`AddContactPage`) | 显示 `contacts.error`；保存错误独立显示 | 无可见 Retry | 增加 Retry；保留 #49 的保存锁与异步保护 |
| Contact Info (`ContactInfo`) | 显示 `contacts.error` | 无可见 Retry | 增加 Retry；保留身份隔离和异步操作保护 |
| Create Group (`CreateGroupPage`) | 显示 `contacts.error` | 无可见 Retry | 增加 Retry |

页面不维护第二份 Contacts 加载状态。重试直接调用现有 `liveContacts.retry`，共享读取器负责并发去重和旧结果保护；卸载页面会清理组件订阅。

## 修改与验证

- `components/contacts-pages.tsx`：列表、Add Contact、Create Group 失败时显示错误和 Retry。
- `components/contact-info.tsx`：联系人资料加载失败时显示 Retry。
- `tests/contacts-load-retry.test.ts`：真实挂载四个页面，控制共享存储 Promise，覆盖失败到成功、重复点击只启动一次重试，以及页面卸载后读取完成并在重新进入时使用最新快照。
- 验证：新增组件测试 1/1；完整测试 603/603；TypeScript 通过；ESLint 0 errors，1 条既有的 `components/chat/use-chat-background.ts:47` unused-disable warning；生产 Turbopack build 通过；`git diff --check` 通过。

尚未验证真实浏览器路由及 iPhone；组件测试使用 jsdom 和受控存储读取。
