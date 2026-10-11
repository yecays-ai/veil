# STATUS — 2026-10-12-claude-backup-entry

更新人：Claude
更新时间：2026-10-12T03:00:00+08:00
发现范围：基于 `claude/backup-replace`（#137）并合并 `claude/backup-archive-container`（#135）；未检查其他开放 PR 的文件重叠，所有权视为未知。

## 当前任务

S11 第 18 单（原审计第 8 阶段：用户入口与 iPhone 文件流程）。已施工，待审。
【不做】Memory/Context、无关界面、新依赖。
【依赖】合并顺序 #134 → #136 → #137 → 本单；#135 独立。

## 谁在改哪里

Claude；分支 `claude/backup-entry`；PR [#138](https://github.com/yecays-ai/veil/pull/138)。新增 `lib/backup/backup-flow.ts`、`components/restore-gate.tsx`、两个测试文件、`docs/backup-entry.md`；改 `components/settings/backup-restore.tsx`、`app/layout.tsx`（包一层 RestoreGate）、`app/settings/settings.css`、`tests/settings-backup-entry.test.ts`。

## 已完成与证据

见 `docs/backup-entry.md`。自动化测试证据（含 jsdom），仅模拟数据。

## 尚未验证

CI、CodeRabbit、Vercel；iPhone 真机下载/选择文件；中途被杀恢复页；大备份。

## 下一步

整链验证；Lan 按顺序合并并真机验收。
