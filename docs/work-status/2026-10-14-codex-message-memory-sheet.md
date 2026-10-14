# STATUS — 2026-10-14-codex-message-memory-sheet

更新人：Codex
更新时间：2026-10-14T16:39:36+08:00
发现范围：本任务开工与发布前通过 GitHub API 核对 main `83088ec3769fc8fbe862e4c70e8a4f8a7035c3b2`；开工时检查开放 PR、远程分支和相关 T4/T5 状态，未发现开放 PR 冲突；未检查他人未发布工作。本地使用逐 blob 校验的独立副本，不改同步 sources。以 `docs/AUDIT_LEDGER.md` 为既有验收状态依据，不变更原 F 编号或状态。

## 当前任务

待审查：工单 2：消息记忆 Sheet 与 Character 旧入口清理。仅开 PR，由 Lan 确认后手动合并；本次用户要求优先于 AGENTS 的通用委托合并条款。

## 谁在改哪里

Codex；分支 `codex/message-memory-sheet-20261014`；PR 尚未创建。涉及：`app/layout.tsx`、`app/messages/chat.css`、`app/settings/settings.css`、`components/chat/{chat-room,message-memory}.tsx`、`components/settings/ui/modal.{tsx,css}`、`components/profile-pages.tsx`、`tests/{contact-info,message-memory-ui}.test.ts`。

## 已完成

- 源码确认 MessageMemory 已使用 BottomSheet，但模态基础 CSS 仅在 Settings 路由加载，直接聊天页打开时成为普通文字。抽取原共用模态 CSS 到 RootLayout；聊天记忆遮罩层级覆盖 Header/输入框。
- 标题 Long Term Memory；顶部拖动条（装饰）、右侧 ×、圆角底部 Sheet，Long Term Memories/Journal 分段标签；默认长期记忆，支持手动及方向键切换。
- 沿用原 memoryRefs 与 resolveInjected，只读对应消息实际注入版本；两个标签各自空状态；旧无 refs 回复明确未记录细节；不调用模型，不改 Memory/Journal 算法、存储、确认、删除。
- ×、遮罩、Escape 关闭；内部点击不关闭；复用焦点陷阱，恢复焦点 preventScroll；message key 防止换消息沿用标签/异步结果。
- 准确移除用户图三的 Character Background 底部 Memory / What … remembers 卡片；Memory App、Contact Info 新入口、数据与 Journal 保留。
- 新增 3 个挂载测试在旧代码上失败（旧标题/无 tabpanel），修复后通过。Node 24.19.0：typecheck 通过；全仓 lint 0 错误、3 条 main 既有警告；webpack 生产 build 通过；8 个定向测试文件共 41/41（含 Sheet 空/有数据、无 refs、焦点/关闭，既有 Memory context、消息动作、Settings 和背景设置回归）。
- 本机 Chrome 390×844 触摸屏条件：从真实消息动作 Memory 打开，CSS 定位/底部 Sheet、两个标签实际 IndexedDB 关联数据和空态、内部点击、×/遮罩/Escape、关闭无残留且 scrollTop 不变、Character 旧入口消失均通过，无 pageerror；隔离测试数据，无真实模型。

## 尚未验证

- GitHub CI 与审查：PR 创建后查询，不能把本地验证当作 CI 结果。
- iPhone Safari/Standalone：实际键盘与安全区、长记忆滚动、触摸关闭/位置保持、不同主题待 Lan 验收。
- 共用模态 CSS 移为全局加载，已跑关联 Settings/背景设置回归；生产主题组合及 Settings/ImageCrop 真机视觉仍待验收。
- 首次 build 沙箱 EPERM，放宽本机验证权限后成功；未部署。

## 下一步

创建本单独立 PR，查询 CI，交由 Lan 审查及手动合并；真机验收另记。

