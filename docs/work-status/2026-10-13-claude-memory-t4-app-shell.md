# STATUS — 2026-10-13-claude-memory-t4-app-shell

更新人：Claude
更新时间：2026-10-13T15:30:00Z
发现范围：base origin/main 80579b79（含 #172–#177）；2026-10-13T15:10Z 起通过 GitHub 集成查看；仅核对本任务路径，其他开放 PR 的归属未逐一检查，视为未知。

## 当前任务

Memory 工单 4 · 第 1 步（共 7 步，见设计稿 §8）：Memory 桌面 App 外壳、路由与角色列表（待审查）。

## 谁在改哪里

Claude；分支 `claude/memory-t4-app-shell`；PR 创建后补链接。涉及 `lib/app-registry.ts`、`lib/desktop-layout.ts`（默认布局）、`lib/memory/bank.ts`（Active 计数口径）、`components/memory-app.tsx`、`components/memory-bank.tsx`（可配置返回目标）、`app/memory/**`、`tests/memory-app.test.ts`、`tests/desktop.test.ts`（夹具）。

## 已完成

- 新增 `memory` App（`/memory`）：角色列表显示头像、名称、Active 记忆数；只有一个角色时直接进入；角色页复用现有 Memory Bank 页面，返回回到列表（单角色回 Home）。旧路由 `/characters/[id]/memory` 未改。
- Active 口径：`isActiveMemory`（status = active 且不是 Journal），后续 Contact Info 复用。读取失败显示「Unavailable」，不显示 0。
- 新安装默认桌面带 Memory（占用 Profile 空出的格子，不碰 widget 下方空行）；已保存的桌面布局不改写，旧用户在桌面编辑模式添加（测试覆盖）。
- 验证（自动化，非真机）：typecheck、eslint 0 error；`memory-app`、`desktop`、backup/binding/theme/home 相关测试全部通过。

## 尚未验证

- 真机上图标、列表和返回行为；未写浏览器级点击测试。
- 备份往返里含 `memory` 的 App 级绑定：校验用通用 `APP_IDS`，相关既有测试通过，但没有为 `memory` 单独加用例。
- 角色很多、记忆很多时列表读取耗时未实测。

## 下一步

第 2 步：Journal 分页与旧路由并入同一角色页。
