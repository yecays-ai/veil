# STATUS — Contacts async operation protection

更新人：Codex
更新时间：2026-10-08T21:50:00+08:00
发现范围：远端 main 3107d8ea798be181f7528d2d72853020c7b2efb4；已 fetch 到独立 worktree。GitHub open PR 搜索发现 #36（冻结）和 #48（Claude Chat Stop）；核对两者改动文件、#48 分支任务记录，无本单文件重叠。未发布的并行工作不在可见范围内。

## 当前任务

Contacts 施工单 B：修复迟到导航、Add Contact 保存失败与重复提交；实现和验证完成，PR #49 待审查。

## 谁在改哪里

Codex；分支 `fix/contacts-async-lifecycle-20261008`；PR https://github.com/yecays-ai/veil/pull/49。生产代码仅 `components/contact-info.tsx`、`components/contacts-pages.tsx`；测试 `tests/contacts-async-lifecycle.test.ts`、`tests/contacts-conversations.test.ts`，以及本记录。未改 Chat Stop、冻结 #36、Preset/Prompt 或存储实现。

## 已完成

- ContactInfo 保存、打开会话、删除联系人，以及 Create Group 的异步完成：检查页面生命周期，再发布状态或导航；已开始的持久化操作继续完成。
- Add Contact：同步 ref 提交锁、忙碌按钮、页面级错误提示、失败释放锁与正常重试；迟到成功/失败不向旧页面发布。
- 新增 15 项挂载行为测试，deferred 控制完成顺序并等待实际操作 Promise；覆盖同一事件批次重复点击、失败重试、离开后重新挂载、迟到成功/失败、正常导航和已提交数据保留。复用实际 Contacts storage 及可控聊天存储调用，不调用模型。
- 旧 main 负向对照：15 项中 5 项失败，具体捕获重复提交、未处理 rejection 和三条迟到导航；临时对照加载器已移除。
- 完整测试 602/602 通过；TypeScript、生产 Turbopack 构建、diff 空白检查通过。ESLint 0 errors，1 个位于未修改 `components/chat/use-chat-background.ts` 的 unused eslint-disable warning。环境无 npm 命令，使用 Node 24 直接执行 package scripts 对应 CLI；构建关闭 Next telemetry，并在允许的执行环境成功。
- 更新一条现有 Add Contact 源码结构断言，适应命名处理函数，同时保留“新增联系人不创建会话”的限制。
- 使用 React best-practices 检查本单 effects、提交锁及按钮状态；无需新增依赖或全局生命周期机制。

## 尚未验证

- 真实 Next 浏览器路由和物理 iPhone 未测；挂载测试为 jsdom，数据/导航入口可控。
- 迟到 state setter 本身在 React 卸载后通常被忽略；源码已保护它，行为测试覆盖导航、可见状态和重挂载隔离，不把后者称为 setter 调用次数证明。
- 远端 CI 和 CodeRabbit 正式审查尚未完成。

## 下一步

等待 CodeRabbit、CI 和用户手动合并；不启用 Auto-merge、不添加 automerge 标签、不自行合并。
