# STATUS — C4 resource load Retry

更新人：Codex
更新时间：2026-10-08T22:19:00+08:00
发现范围：GitHub 确认最新 main 为 3107d8ea798be181f7528d2d72853020c7b2efb4，与本地 origin/main 一致；本次 fetch 因连接重置失败，未改变网络配置。独立 worktree/分支基于该 main。开放 PR 搜索发现 #36（冻结）、#48（Chat Stop）、#49（Contacts）；现有改动文件和任务记录无 C4 文件重叠。未公开的并行工作仍不可见。

## 当前任务

C4：资源首次加载失败恢复入口与异步安全；实现和验证完成，准备 PR，等待审查及用户手动合并。

## 谁在改哪里

Codex；分支 `fix/resource-load-retry-20261008`；PR 待创建。
生产修改仅 `components/settings/bindings/`、`components/settings/presets/`、`components/settings/regex/`、`components/settings/worldbooks/` 内对应 hook 与加载错误 UI（15 个文件）。另新增 `tests/resource-load-retry.test.ts` 和本记录。未修改 storage、Contacts、Chat Stop 或 #36/#48/#49。

## 已完成

逐页面核查（基准 main 3107d8e）：

| 页面 | 加载来源与原恢复机制 | 结论 |
| --- | --- | --- |
| Binding Home / Editor | `useBindings` → shared live Bindings/localStorage；`useBindingManager` → API Config IndexedDB、Preset/Regex/WorldBook localStorage 目录；共享 Bindings 已有 retry，目录加载原仅一次 effect | 确认缺口并修复：复用 shared retry，同时可重读目录；错误与 loading UI、同步去重及请求 revision |
| Preset List / Detail / New Prompt | `usePresetLibrary` → browserPresetStorage.load；localStorage；原无 retry，只有 mounted 布尔保护 | 确认缺口并修复：开放现有加载逻辑，加入 pending Promise、revision、loading/loadError；Strict Mode 旧读取不覆盖新结果 |
| Regex List / Detail / Rule / New | `useRegex(scope)` → browserRegexStorage.load；localStorage；已有 scope/lifetime/revision 与编辑保护，无恢复入口 | 确认缺口并修复：保留既有保护，开放受控加载 retry；Regex New 草稿保持 |
| WorldBook List / Detail / Entry | `useWorldBooks(scope)` → browserWorldBookStorage.load；localStorage；已有 scope/lifetime/revision 与编辑保护，无恢复入口 | 确认缺口并修复：保留既有保护，开放受控加载 retry |
| Contacts / Add Contact | useContacts 已导出 shared retry，当前页面未提供加载错误恢复操作 | 确认缺口但暂缓：依用户要求等待 #49 合并后另单核对，本单不改 |

- 目标四类页面没有已完整接入 UI 的 Retry；已健康的 shared Bindings 去重与 stale suppression、Regex/WorldBook scope/编辑保护继续复用。
- 加载错误与保存错误分开识别；只有加载错误展示 Retry。成功清理加载错误，失败保留错误并允许继续重试；重复点击复用 pending 请求，卸载/旧请求不发布。
- 新增 26 项真实页面 + hook 的 deferred 挂载测试：13 个入口（包含 Binding 文档与目录两条失败源）测试首次失败、重复点击、再次失败及恢复；四类页面 late success/error after remount；Strict Mode 三类资源旧请求；Regex New 草稿保留；Preset 正常首次读取与创建持久化。
- 同一组件 scope 切换的旧请求保护与编辑/保存行为复用既有 `tests/regex-worldbook-editor-safety.test.ts`：`Regex/WorldBook: a late load from the previous route cannot replace the new route snapshot`、`mounted editors refuse an interleaved stale draft; quota failure preserves a fresh draft for retry and re-entry`。Bindings 编辑保留 `tests/binding-concurrency.test.ts` 的 `bindings.stale-ui-list-edit`。
- 相关旧测试 27/27 通过，新测试 26/26 通过，完整测试 613/613 通过；TypeScript、Turbopack 生产 build、diff --check 通过。ESLint 0 errors，1 个未改动 Chat background 文件的 existing unused-disable warning。
- 旧 main 负向对照：26 项中 23 项失败，检出未提供 Retry 与 Preset Strict Mode stale 结果；临时加载器已移除。
- 使用 Node 24 直接执行 package scripts 的等价 CLI（环境无 npm）。一次测试编译遭遇系统内存分配失败，缩小 Node heap/semi-space 后正常通过；生产 build 关闭 telemetry、在允许执行环境运行。
- React best-practices 范围内复核：effect 清理、同步 request ownership、按钮禁用与错误提示；无新依赖/全局 Retry 框架。

## 尚未验证

- jsdom 挂载与受控存储入口不代表真实浏览器路由或物理 iPhone 验收。
- 存储数据持续损坏时 Retry 仍会失败；本单不修复/清空数据，不改变导入恢复或删除行为。
- 保存期间/已加载数据的业务操作仍沿用现有保护，本单不扩展为资源同步重构。
- 远端 CodeRabbit、CI 结果尚未完成。

## 下一步

创建一个普通 PR 并更新链接；不添加 automerge，不开启 Auto-merge，不合并。等待 CodeRabbit、CI 及用户手动合并。Contacts 加载恢复留待 #49 合并后另单处理。
