# STATUS — 2026-10-08-codex-c6-foundation-cross-tab

更新人：GPT/Codex（验证记录由 Claude 受用户委托补充）
更新时间：2026-10-08T11:05:00+00:00
发现范围：最新 `origin/main`、仓库 AGENTS 与现有 work-status、Foundation Provider/IndexedDB 文档存储/现有通知实现，以及 PR #36/#43 的远端 head 和文件范围。PR 创建后 #43 合并，分支已更新到最新 main 并重新完整验证。

## 当前任务

工单 06 C6 — Foundation 跨标签页状态同步。实现、本地验证、推送与 PR 创建完成；不包含 Foundation 加载失败恢复（R5）。

## 谁在改哪里

Codex；分支 `fix/foundation-cross-tab-sync-20261008`；最新 base `14da44ebdddc8c3d5530000834acab2b36ce66c4`。
涉及 `lib/foundation-storage.ts`、`components/foundation-provider.tsx`、`tests/foundation-cross-tab.test.ts` 和本记录。
开放 PR #36（`fix/chat-first-frame-complete`）仅改 Chat session/prefetch/storage 与相关测试；已合并 PR #43 仅改 Chat BroadcastChannel/storage 与相关测试。均不与本单文件重叠。

## 已完成

- 确认 C6 仍存在：Provider 只在首次挂载读取，Foundation 存储没有跨标签页订阅。
- 实际同步范围是单一 Foundation 文档中的 User、Characters、Universe（世界设定、关系、节点位置）和 runtime 设置；不改变数据结构、删除语义或其他资源目录。
- 复用 Chat 的作用域 `BroadcastChannel` 成功通知模式；仅在 IndexedDB compare-and-set 成功后通知，同标签页监听与远端标签页重读共用一个订阅边界，最后一个监听者卸载时关闭 channel。
- Provider 对通知与焦点/恢复可见事件执行单文档低成本校验；并发刷新合并，revision 防止旧读取或旧错误覆盖较新结果；卸载后不发布状态。
- 新增真实 fake IndexedDB 与挂载行为测试，覆盖新增、修改、删除、交替写入最终一致、失败不通知、重复挂载清理以及旧读取晚到。
- 验证提交：`e636c683709ad5bb1ec2abea8857531db57a5313`（base `14da44ebdddc8c3d5530000834acab2b36ce66c4`，即合入 PR #43 后的 main）。代码提交为 `6fb55e82b499e9a4e7c9cbf711de1074adbb4765`；其后的 `e636c68` 只修改本记录，代码内容相同。
- 检查命令与结果（Node v24.21.0；2026-10-08T11:04+00:00 由 Claude 在上述提交上重新执行，均通过）：
  - `npx tsc --noEmit` — 退出码 0。
  - `npx eslint .` — 退出码 0，无告警。
  - `npm test`（即 `tsc --project tsconfig.tests.json && node scripts/run-tests.mjs`）— 567/567 通过，0 失败、0 取消、0 跳过；38 个回归契约。其中本单 `tests/foundation-cross-tab.test.js` 3/3：create/update/delete 与交替写入收敛；失败事务不发本地或跨标签页成功通知；Provider 合并旧读取并在每次卸载时清理。
  - `NEXT_TELEMETRY_DISABLED=1 npm run build`（`next build`）— 退出码 0，23/23 静态页面生成。
  - `git diff --check origin/main...HEAD` — 退出码 0。
- PR [#44](https://github.com/yecays-ai/veil/pull/44) 已创建并添加 `automerge` 标签。

## 尚未验证

- 未做两个真实浏览器标签页与移动设备手工验收。
- 浏览器不支持 `BroadcastChannel` 时，同标签页仍同步；跨标签页依赖重新获得焦点/可见时的校验读取。

## 下一步

等待 PR #44 的 CI 与审查门禁；由仓库 Safe PR auto-merge 流程决定合并。
