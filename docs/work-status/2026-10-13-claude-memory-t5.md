# STATUS — 2026-10-13-claude-memory-t5

更新人：Claude
更新时间：2026-10-13T15:30:00Z（Asia/Taipei 23:30）
发现范围：base origin/main 656cc4b79bc0d93a26f5d68735184308110641bc（含 #172–#175）；仅本任务路径；远端检查：2026-10-13T15:10Z 通过 GitHub API 查看开放 PR；因 GitHub 集成无「列出全部开放 PR 改动文件」的批量接口，仅核对了 #176（改聊天与 Memory 面板 在改聊天与 Memory 面板，路径不重叠）；其余开放 PR 归属视为未知。

## 当前任务

Memory 重做工单 5：Settings → API 的 Default / Text / Memory 分层（进行中）。

## 谁在改哪里

Claude；分支 `claude/memory-t5-api-layers`；PR 尚未创建。涉及 `components/settings/text-api-settings.tsx`、`lib/settings/{api-layers,text-api}.ts`、`tests/settings-api-layers.test.ts`。

## 现状与取舍

- 读代码确认：分层其实已存在于 Binding 结构里——全局 `apiConfigId`（设置页称 “Default Text API”）→ Character 默认 → App 覆盖；Memory 用 `memoryApiConfigId`，未设置时跟随该 Character 的聊天 API，`null` 为关闭，缺失/无效直接报错不回退（`lib/memory/maintenance-binding.ts`）。
- 因此没有新增持久化字段：没有单独的全局 “Text” 字段（所有文本调用本来就跟随 Default），避免新增存储与备份校验面。如果 lan 想要一个独立的全局 Text 层，是后续独立工单。
- 新增：API 页的 Models 区块——显示 Default API；Memory API 选择器（已保存的 API 用 `api:` 前缀编码，避免 id 恰为 off 时与「关闭」冲突；绑定的 API 已不存在时显示一个禁用的「Unavailable API」选项；Use Default API / 某个 API / Off）直接写全局 `memoryApiConfigId`，“Use Default API”即恢复继承；状态行明确显示当前使用哪个、或缺失/不可用/关闭时 Memory 不会运行且不会改用别的 API。
- Default 变更自动传递（按 id 引用）。已有的 Character 级 Memory 选择与 Bindings 页面保持不变。
- 小修：删除某个 API 时的引用计数现在也包含 Memory 引用（原先漏计；清理逻辑本来就会把它们置为关闭）。

## 已完成（自动化测试，非真机）

- typecheck、eslint 0 errors；`tests/settings-api-layers.test.ts` 4/4；既有 binding/text-api/stale-editor/backup-text-api 相关测试通过。

## 尚未验证

- 真机上 API 页新区块的外观与交互（选择器写入由纯函数与既有 Binding 存储测试覆盖，未做浏览器级点击测试）。
- 密钥：本改动不读取、显示或记录任何 API key。

## 下一步

跑一次完整测试，开 PR，CI 绿且评审线程处理完后合并。
