# STATUS — Contacts async operation protection

更新人：Codex
更新时间：2026-10-08T22:40:49+08:00
发现范围：实际远端检查时间 2026-10-08T22:40:49+08:00（UTC 14:40:49）；main=bff33fc7e87211424316b31dcc2040d1d39321f9。检查开放 PR #36（fix/chat-first-frame-complete，head ea68ffe691138e6520ab6e7a06f753fd0e1df423）、#49（fix/contacts-async-lifecycle-20261008，head 06f2c2ce9a10cdcac304c7f3e9e09ae123a1985f，base 3107d8ea798be181f7528d2d72853020c7b2efb4）和 #51（fix/resource-load-retry-20261008，head ef0945df5a067212095a0dcd2320b97ca7787d43）；并核对 #48（claude/chat-stop-boundary，已合并至 main）及 #50（claude/chat-background-async-errors，已合并至 main）。PR #49 最新 CodeRabbit 文档意见及精确 head 已从 GitHub 远端核对。本地 worktree 仍在旧提交 f647c08 且有未提交改动，故未用其代表远端现状；GitHub API 可访问，远端 PR/分支/评论核查没有因访问限制而缩小范围。未改 #36、#48、#50 或 #51。

## 当前任务

Contacts 施工单 B：原位切换 ContactInfo 联系人时重置联系人状态并隔离旧异步结果；修复和验证完成，PR #49 已更新并等待人工审查。

## 谁在改哪里

Codex；分支 `fix/contacts-async-lifecycle-20261008`；PR https://github.com/yecays-ai/veil/pull/49。此次仅更新 `components/contact-info.tsx`、`tests/contacts-async-lifecycle.test.ts` 和本记录。未改 #36、Chat Stop、Add Contact 提交实现、Preset/Prompt 或存储。

## 已完成

- ContactInfo 保存、打开会话、删除联系人，以及 Create Group 的异步完成：检查页面生命周期，再发布状态或导航；已开始的持久化操作继续完成。
- Add Contact：同步 ref 提交锁、忙碌按钮、页面级错误提示、失败释放锁与正常重试；迟到成功/失败不向旧页面发布。
- CodeRabbit Major 路径已复现：同一个已挂载 ContactInfo 从 Peter 切到 Lan 时，旧 draft 仍呈现在 Lan 页面；旧保存进行中时，lifetime 令牌阻止旧 finally 清忙碌状态。
- `ContactInfo` 在 render 时按 `characterId` 条件重置 draft、busy、error、crop source、image-reading 与删除弹窗；layout effect 仅失效图片读取和 lifetime 令牌，避免同步 effect 状态写入。
- 新增同一挂载实例跨 `characterId` 的行为测试，受控保存、图片读取和会话 Promise；覆盖旧联系人草稿/保存作用域、新页面可交互性、旧图片迟到不打开裁剪框、已打开裁剪框与删除弹窗关闭、忙碌/错误清理及旧操作无法发布错误或导航。
- 新增 15 项挂载行为测试，deferred 控制完成顺序并等待实际操作 Promise；覆盖同一事件批次重复点击、失败重试、离开后重新挂载、迟到成功/失败、正常导航和已提交数据保留。复用实际 Contacts storage 及可控聊天存储调用，不调用模型。
- 旧 main 负向对照：15 项中 5 项失败，具体捕获重复提交、未处理 rejection 和三条迟到导航；临时对照加载器已移除。
- 完整测试 603/603 通过；TypeScript、ESLint 和默认 Turbopack 生产构建通过，`git diff --check` 通过。ESLint 0 errors，1 个位于未修改 `components/chat/use-chat-background.ts` 的 unused eslint-disable warning。环境无 npm 命令，使用 Node 24 与项目本地 CLI 执行等价脚本；沙箱限制了 Next 输出目录创建，获准的执行环境中默认构建成功。
- 首次远端 CI 在 lint 阶段发现同步 layout-effect state 更新并失败；已改为条件式 identity 状态重置，layout effect 只清理异步令牌。后续 CI run 413 的 typecheck、lint、全套测试、build 和 diff check 全通过，Vercel Preview 成功。
- 已在 PR #49 回复并解决 CodeRabbit Major review thread；PR 标题和说明已按最终行为更新。没有 automerge 标签；PR 仍 open 且未合并。
- 更新一条现有 Add Contact 源码结构断言，适应命名处理函数，同时保留“新增联系人不创建会话”的限制。
- 使用 React best-practices 检查本单 effects、提交锁及按钮状态；无需新增依赖或全局生命周期机制。

## 尚未验证

- 真实 Next 浏览器路由和物理 iPhone 未测；挂载测试为 jsdom，数据/导航入口可控。
- 迟到 state setter 本身在 React 卸载后通常被忽略；源码已保护它，行为测试覆盖导航、可见状态和重挂载隔离，不把后者称为 setter 调用次数证明。
- 尚未做真实浏览器路由或物理 iPhone 验收；新提交后的额外 CodeRabbit review 尚未出现。

## 下一步

等待人工审查和用户决定合并；Major CodeRabbit 线程已回复并解决。不加 automerge、不启用自动合并、不直接合并。
