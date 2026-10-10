# STATUS — 2026-10-10-codex-p6-lifecycle-mutations

更新人：Codex
更新时间：2026-10-10T14:54:00+08:00
发现范围：GitHub API main、开放 PR（含 Draft）及远端分支；基线 `8d13788cef3533d775e0ff04a270f4f19fbb67f6`（#97 已合并），开放 PR 为空；已读 AGENTS、审计总账、work-status 规则、#97 入库交接。未发布的其他本地任务仍不可见。

## 当前任务

生命周期变异脚本最小修复，施工及本地验证完成；PR #98 已提交，待审查、未合并，合并由 Lan 手动完成。

## 谁在改哪里

Codex；分支 `fix/p6-lifecycle-mutation-runner`；PR：[#98](https://github.com/yecays-ai/veil/pull/98)。
文件仅：`scripts/check-lifecycle-test-mutations.mjs`、`package.json`、`docs/regression-contracts.md`、`docs/AUDIT_LEDGER.md`、本记录。
独立检出按 API 文件清单恢复；基线树与 GitHub tree SHA `561f4a43ebc1b8610d96b691d1fcd2efa51e213d` 完全一致，未改其他检出的未提交工作。

## 已完成

- 原脚本实测：exit 1，`production mutation must execute`；旧目标文字已不存在，当前业务保护仍在。
- 定位带专属注释的迟到图片 early return，仅在独立子进程内移除它；另一个 markReady active guard 不动。保留三项检查，不改业务/测试。
- 新增 `npm run test:mutations`：编译当前源码后运行脚本；预检查唯一匹配，保留生效标记、指定失败断言及恢复检查；不接 CI。
- Node **24.21.0** / npm **11.19.0**；使用现有便携运行时，`npm ci --ignore-scripts --prefer-offline --no-audit --no-fund` 只恢复已合并 lockfile，未新增/升级依赖。
- `npm run test:mutations`：
  - late background ownership：正常 exit 0 → 变异 exit 1（指定迟到 URL 断言）→ 恢复 exit 0。
  - timer cancellation：正常 exit 0 → 变异 exit 1（物理取消断言）→ 恢复 exit 0。
  - disabled Switch interaction：正常 exit 0 → 变异 exit 1（disabled 交互断言）→ 恢复 exit 0。
- 在仓库外复制验证脚本，故意制造目标缺失、匹配不唯一、no-op 变异、缺少生效标记；分别报 found 0 / found 2 / mutated test must fail / production mutation must execute，**均 exit 1**。仓库脚本未留下这些故障。
- 三个编译目标运行前后 SHA-256 一致；`git diff -- components lib tests` 为空。日志/负对照脚本在检出外；node_modules/.cache、.next 等产物被忽略。
- `npm test`：基线 797/797；恢复现有 lockfile 后一次与类型检查/lint 并行的运行 796/797（CF-02 Retry 断言 0 != 1）；未改业务代码的串行重跑 **797/797**。不隐藏首次失败，也未调查或修复该用例。
- `npm run typecheck`（含 build 后重跑）通过；`npm run lint` 0 error、6 条既有 warning。
- `npm run build`：先受沙箱全局 telemetry 配置及路径权限阻止；使用进程内 `NEXT_TELEMETRY_DISABLED=1` 和获准执行方式后生产构建通过。未改全局配置、无部署。
- 历史 #26 与本轮实际运行证据分别记录；总账本项保持“已修待验”。

## 尚未验证

- GitHub Actions verify / Vercel：待 PR 最新提交检查；历史 verify 没分配 runner，不能视为通过，不空提交触发。
- CodeRabbit 最新提交的正式 review 与评论串：以 PR 最新 head 实际返回为准；尚未完成时不声称审查通过。
- 本脚本仅三个保护，不代表全仓清理验证；依赖的匹配锚点未来变动会明确失败。
- 浏览器/iPhone 资源释放不在范围；#97 浏览器测试、URL 释放/Foundation 补测、天气计时器、#36 均未修改。
- CF-02 的一次不稳定测试观测未定位，不据此宣称业务缺陷。

## 下一步

读取 PR 最新 head 的审查正文及评论串，如实报告 CI/预览；如有本单范围内意见，按实际证据处理。由 Lan 手动合并，不添加 automerge。
