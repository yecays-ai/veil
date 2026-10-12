# STATUS — m5b-enable-entry

更新人：Claude
更新时间：2026-10-12T18:20Z
发现范围：基于 origin/main `81fd18d02b0481d56f5ce2759987759f1bd5546e`（PR #161 合并提交）；未逐一检查其他开放 PR 的改动文件（本任务只新增 Settings 页与状态读取，不触碰 chat/backup 路径）。

## 当前任务

待审查：为 M5b 自动维护增加 Settings → Memory Maintenance 本设备开关与只读状态页。

## 谁在改哪里

Claude；分支 `claude/m5b-enable-entry-r3vr44`；PR 见分支；涉及 `app/settings/memory/page.tsx`、`app/settings/page.tsx`、`app/settings/settings.css`、`components/settings/memory-maintenance-settings.tsx`、`lib/memory/{maintenance-config,maintenance-binding,maintenance-status}.ts`、`tests/memory-maintenance-settings.test.ts`。

## 已完成

- 开关只调用既有 `setMaintenanceConsent`；production / 授权变量 / Vercel Production / 非 CI 四项门禁不变，Preview 无法开启。
- 状态页显示缺失的门禁项、Web Locks 支持、每个 Character 的维护模型状态、进度计数、下次检查时间、最近 5 条 `memory-maintenance` M0 记录。
- 验证（Node 22.22）：定向 memory-maintenance-*、binding-*、settings-* 共 91/91 通过；`tsc --noEmit`、改动路径 eslint 通过；带授权环境变量的 `next build` 含 `/settings/memory`。

## 尚未验证

- 无 iPhone 真机；未调用真实模型；未设置 Vercel 环境变量；Node 24 未跑。
- 未跑全量测试（按 AGENTS 分级）。

## 下一步

lan 审查并合并；之后由 lan 批准设置 `NEXT_PUBLIC_MEMORY_MAINTENANCE_APPROVED=true` 并重新部署，再在 iPhone 上开启本设备开关。
