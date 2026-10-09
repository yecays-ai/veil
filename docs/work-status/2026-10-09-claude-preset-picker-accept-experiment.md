# STATUS — 2026-10-09-claude-preset-picker-accept-experiment

更新人：Codex（依据用户提供的真实 iPhone 验收结果更新）
更新时间：2026-10-09T15:49:55+08:00
发现范围：2026-10-09 15:49 +08:00，通过 GitHub 集成检查 remote main（67c9ef2）、#62（open，head 2ea861c，base main）、#64（open，head caf70b3，base fix/d6-preset-import-id-contract）、两者 changed files、当前 head checks/status、reviews 与 review threads。检查冻结 #36 状态。未检查未发布的本地任务；手机结果根据用户提供的截图与验收记录，不是本执行环境直接操作手机。

## 当前任务

Preset 文件选择器兼容性实验：**真实 iPhone 验收通过，待合并**。本次真机测试表明，移除 `accept` 后原先发灰的 JSON 文件可选择；这只说明该改动在本次测试中解决了文件不可选问题，不证明所有 iOS 环境的底层根因。

## 谁在改哪里

Claude；分支 `claude/preset-picker-accept-experiment`；PR https://github.com/yecays-ai/veil/pull/64。当前 base 为 #62 分支 `fix/d6-preset-import-id-contract`（2ea861c），以保持 D6 先合并的依赖。#62 尚未合并；因此本次不改 #64 base。#64 仅改 `components/settings/presets/preset-list.tsx`、本记录和 `tests/preset-import-file-input.test.ts`。PR #62 的文件集合未与该功能文件重叠；#56、#36 未修改。

## 已完成

- 移除文件输入 `accept`；JSON 读取、Preset 结构校验、D6 ID 校验、错误提示和保存逻辑保持原样。
- 自动化挂载测试覆盖：input 无 `accept`；正常 Preset 导入；非 JSON 文本、非 Preset JSON、数组、超长 ID、首尾空白 ID 均拒绝且既有存储字节不变。此前负向对照显示恢复 `accept` 后，仅 accept 契约测试失败。
- 用户提供的真实 iPhone 截图及验收结果：
  - 移除 `accept` 后，可选择此前灰显的 JSON 文件。
  - 超长 ID、首尾空白 ID 明确拒绝。
  - `preset-normal-id-test.json` 成功导入，界面出现 `Preset imported.` 和 `D6 Phone Test`。
  - 非 Preset 文件明确拒绝，提示 `This file is not valid Preset JSON.`。
  - 所有拒绝后既有 Preset 仍保留。
- PR #64 原有 head 的最新 GitHub verify 检查通过，Vercel 部署成功；GitHub mergeability 为 clean。此前全量测试是 **717/718**，其中 `chat.unsaved-draft-explicit-retry` 间歇失败：该分支单独重跑 4 次中失败 2 次，未改动的 #62 head 重跑 6 次中失败 2 次。不得将此前结果写成全绿。PR #64 的 CodeRabbit 自动审查因 base 不是 main 而跳过。
- PR #62 当前仍 open、未合并；该 head 的 CI/Vercel 与 CodeRabbit status 显示 success，review/thread 列表为空。GitHub 当前报告其 mergeable/clean；尚待人工合并。
- D6：导入与 ID 校验真机通过；Binding 与实际聊天生成真机验收仍待确认。

## 尚未验证

- 多版本 iOS/Safari、其他文件来源及其他设备下的通用兼容性；没有宣称已查明底层根因。
- #64 改 base 至 main 后的最终 diff 与重新运行的 CI；必须在 #62 合并后再做。
- 真实手机上将成功导入的 D6 Preset 绑定到测试角色并生成聊天，确认对应 Prompt 实际生效。

## 下一步

人工先合并 #62。合并后将 #64 base 更新为 main，重新确认文件列表仅包含本实验、检查冲突并等待新的 CI/CodeRabbit；本任务不自动合并。