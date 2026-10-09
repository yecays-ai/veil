# STATUS — 2026-10-09-codex-d7-preset-order-contract

更新人：Codex
更新时间：2026-10-09T17:56:16+08:00
发现范围：2026-10-09 17:56 +08:00，再次确认 canonical main `3c74203d6c9e9731c296cac7f227a17fc6f56774` 未变化，读取 remote open PR 列表、相关分支文件。#62/#64 已进入 main；#63 为 Chat 首帧发布协调，#36 保持冻结。D7 相关源码与测试从该 main 核对；未检查未发布本地任务。GitHub Actions 账户计费额度耗尽，CI 不可用；不修改工作流、权限或分支保护。

## 当前任务

第四刀 D7 有界修复：本地回归与构建通过，准备独立 PR，等待 CodeRabbit 和人工 review；不自动合并。

## 谁在改哪里

Codex；独立分支 `fix/d7-preset-order-contract`；base 为上述 main。仅涉及 `lib/preset-library.ts`、`components/settings/presets/preset-detail.tsx`、`tests/preset-editor-ui.test.ts`、新增 `tests/preset-d7-contract.test.ts` 与本记录。未修改 D6、Theme、WorldBook、聊天 prompt 组装器或工作流。

## 已完成

- 原缺陷 Red：最新 main 中导入含 enabled orphan Prompt 的 Preset；编辑 helper 显示它且 `promptEnabled()` 返回 true，然而 `assembleChatPrompt()` 因只消费 `promptOrder` 未包含它。新增测试原始断言在运行时 prompt 查找 `D7_ORPHAN_SENTINEL`，实际缺失，失败原因是孤立 Prompt 未被生成使用。
- 最终契约：`promptOrder` 是启用状态和运行顺序权威。孤立 Prompt 仍显示在编辑器末尾，但没有排序项时显示未启用且运行时不消费；用户明确启用时，按末尾追加排序项；禁用孤立项不擅自添加排序项。重排孤立 Prompt 不会意外启用它。既有顺序项及启用值保留；未导入/迁移/删除既有存储数据。
- 行为测试覆盖导入孤立 Prompt、默认关闭、启用、禁用、排序、Preset 保存/重新读取及生成 prompt 的实际包含/排除；编辑器开关复用同一 `setPromptEnabled()` 行为。
- 验证使用仓库脚本的 Node 等价调用（执行环境无 npm 命令）：
  - `node node_modules/typescript/bin/tsc --project tsconfig.tests.json` 通过。
  - 相关测试：D7、Preset library、D6 import-binding contract、file-input UI，33/33 通过；D7 + time-context 10/10 通过。
  - 全量 `node scripts/run-tests.mjs`：727/727 通过，无失败/跳过。
  - `node node_modules/typescript/bin/tsc --noEmit` 通过。
  - `node node_modules/eslint/bin/eslint.js .` 通过，0 errors；存在一条既有 `components/chat/use-chat-background.ts:53` unused eslint-disable warning，未修改。
  - `NEXT_TELEMETRY_DISABLED=1 node node_modules/next/dist/bin/next build` 通过。沙箱初次拒绝 canonicalize 隔离目录，获运行时批准后重跑成功。
- GitHub Actions：**因账户计费限制未运行**。未触发重复提交或修改工作流。

## 尚未验证

- GitHub Actions 与新 PR CodeRabbit review；Actions 受账户计费限制。
- 手机/真实浏览器人工验收：导入带未排序 Prompt 的 Preset → 编辑器应显示为关闭；明确开启后保存、离开重进 → 顺序显示在末尾且为开启；生成请求应包含对应测试 Prompt。未宣称设备通过。
- 既有用户数据没有执行迁移；孤立且 prompt.enabled=true 的条目将继续保存在原始数据中，UI/runtime 按无排序项视为关闭，用户需在编辑器明确启用并保存。

## 下一步

创建基于最新 main 的单独 PR；等待 CodeRabbit 与人工 review，不加 automerge，不合并。
