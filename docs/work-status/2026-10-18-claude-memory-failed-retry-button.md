# STATUS — 2026-10-18-claude-memory-failed-retry-button

更新人：Claude
更新时间：2026-10-18T07:45:00Z
发现范围：origin/main ac5a55f（2026-10-18）；通过 GitHub API 查看远程 open PR，开始时无重叠的 Memory 维护任务；未读取真机数据库。

## 当前任务

待审查：lan 批准（2026-10-18 决策卡"按钮，下次触发跑"）为已用完 2 次请求的 Failed 范围各多给 1 次请求。

## 谁在改哪里

Claude；分支 `claude/project-thread-18lv2g`；PR 见 PR 页面（创建后在此补链接）。
涉及：`lib/memory/maintenance-retry.ts`（新）、`components/settings/memory-maintenance-settings.tsx`、`tests/memory-maintenance-results.test.ts`。无持久化结构变更（只改已有 failed 批次的 `attempts`）。

## 已完成

- Settings → Memory 维护：角色有 Failed 范围时出现按钮"Allow one more try for failed ranges"。点击后，仅该角色 `failed` 且 `attempts` 已达上限的批次，`attempts` 置为上限减 1；范围、来源、候选不变；`uncertain`/`too-large`/`ready` 不动。
- 持有该角色的 `veil-memory:<id>` 独占锁才改（别的标签页正在维护则提示稍后再试）。放开后仍按原规则：常规触发（20 条新消息）、每次维护最多重试 1 个、不混入新消息、成功提交后才算完成。
- 自动化测试（假模型、fake IndexedDB，无真实模型调用）：放开后恰好多 1 次请求且只带该范围、仅 `attempts` 变化、重复点击不再改动、uncertain 不变、他处持锁时不改。验证：`tsc --project tsconfig.tests.json` 后 `node --test` 运行 `memory-maintenance-results|runner|settings` 编译产物；`npx eslint lib/memory components/settings/memory-maintenance-settings.tsx tests/memory-maintenance-results.test.ts`；`npx tsc --noEmit`（仅有已有的 `emoji-picker-react` 缺失报错）。验证于合并前的本分支提交。

## 尚未验证

- 按钮本身的界面行为（无 UI 自动化测试，仅核心函数有测试）；真机；真实模型是否能解析这 5 个范围。

## 下一步

部署后 lan 在手机上点按钮；之后每发 20 条新消息自动重试 1 个范围，5 个共约 25k tokens。
