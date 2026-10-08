# STATUS — 2026-10-08-codex-c6-foundation-cross-tab

更新人：GPT/Codex
更新时间：2026-10-08T19:00:00+08:00
发现范围：最新 `origin/main`、仓库 AGENTS 与现有 work-status、Foundation Provider/IndexedDB 文档存储/现有通知实现，以及开放 PR #36/#43 的远端 head 和文件范围。GitHub PR ref 的二次获取遇到连接重置，使用开工时已刷新到本地的远端 head 与其任务记录复核。

## 当前任务

工单 06 C6 — Foundation 跨标签页状态同步。实现与本地验证完成，待提交发布；不包含 Foundation 加载失败恢复（R5）。

## 谁在改哪里

Codex；分支 `fix/foundation-cross-tab-sync-20261008`；base `b5b103155143828caf572c23d2c96ba162124f36`。
涉及 `lib/foundation-storage.ts`、`components/foundation-provider.tsx`、`tests/foundation-cross-tab.test.ts` 和本记录。
开放 PR #36（`fix/chat-first-frame-complete`）仅改 Chat session/prefetch/storage 与相关测试；#43（`claude/brave-davinci-ws2ruk`）仅改 Chat BroadcastChannel/storage 与相关测试。两者均不与本单文件重叠。

## 已完成

- 确认 C6 仍存在：Provider 只在首次挂载读取，Foundation 存储没有跨标签页订阅。
- 实际同步范围是单一 Foundation 文档中的 User、Characters、Universe（世界设定、关系、节点位置）和 runtime 设置；不改变数据结构、删除语义或其他资源目录。
- 复用 Chat 的作用域 `BroadcastChannel` 成功通知模式；仅在 IndexedDB compare-and-set 成功后通知，同标签页监听与远端标签页重读共用一个订阅边界，最后一个监听者卸载时关闭 channel。
- Provider 对通知与焦点/恢复可见事件执行单文档低成本校验；并发刷新合并，revision 防止旧读取或旧错误覆盖较新结果；卸载后不发布状态。
- 新增真实 fake IndexedDB 与挂载行为测试，覆盖新增、修改、删除、交替写入最终一致、失败不通知、重复挂载清理以及旧读取晚到。
- typecheck、lint、完整测试 560/560、production build 通过。

## 尚未验证

- 未做两个真实浏览器标签页与移动设备手工验收。
- 浏览器不支持 `BroadcastChannel` 时，同标签页仍同步；跨标签页依赖重新获得焦点/可见时的校验读取。

## 下一步

提交并推送分支，创建正常实现 PR；按仓库约定添加 `automerge`，由 CI 与审查门禁决定合并。
