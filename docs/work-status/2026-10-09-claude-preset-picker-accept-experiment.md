# STATUS — 2026-10-09-claude-preset-picker-accept-experiment

更新人：Claude
更新时间：2026-10-09T15:30:00+08:00
发现范围：2026-10-09 通过 GitHub 集成与 `git fetch` 读取远端 main `67c9ef2`（含已合并的 #61）、开放 PR #62（head `2ea861c`）和冻结的 #36；#62 的文件集合不含 `components/settings/presets/preset-list.tsx`，与本实验无路径重叠。未检查未发布的本地任务。

## 当前任务

兼容性问题（总账未编号，不自行编造 D 编号）：iPhone 的 Preset 导入文件选择器中，合法 JSON 文件发灰、不可点击。状态：**实验待手机验证**。根因未确认；本 PR 只验证 `accept=".json,application/json"` 是否导致该现象。

## 谁在改哪里

Claude；分支 `claude/preset-picker-accept-experiment`；基于 #62 的 head `2ea861c`（D6 修复代码），PR 以 `fix/d6-preset-import-id-contract` 为 base，因此 diff 只含本实验。未修改 #62 的分支或提交。
触及：`components/settings/presets/preset-list.tsx`（仅移除文件输入的 `accept` 属性）、新增 `tests/preset-import-file-input.test.ts`、本记录。

## 已完成

- 移除 `accept`；文件读取、`JSON.parse`、Preset 校验、D6 ID 校验、错误提示和保存流程未改。
- 挂载 `PresetList` 的定向测试（7 项）：input 无 `accept`；合法 Preset 仍导入；非 JSON 文本、不是 Preset 的 JSON、JSON 数组、超长 ID、首尾空白 ID 均被现有导入界面拒绝，且已有 Preset 存储字节不变。
- 负向对照：把 `accept` 加回去，只有 `accept` 契约那一项失败。

## 尚未验证

- iOS 原生文件选择器的行为：自动化测试无法证明，必须用同一台 iPhone、同一个文件、同一位置对比 #62 预览与本实验预览。
- 本实验不宣布兼容性问题已修复；若移除后仍不可选，则假设不成立，不继续盲目修改。
- D6 仍为「已修待验」，其手机验收不受本记录改变。

## 下一步

等待真实 iPhone 结果：移除后可选 / 仍不可选 / 可选但导入失败（记录实际错误）。
