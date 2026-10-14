# STATUS — 2026-10-14-claude-memory-p1-1-lineage

更新人：Claude
更新时间：2026-10-14T06:55:00Z
发现范围：2026-10-14T06:35Z；origin/main = 204acfb7ef9527c99bbe7c4af2c42392bb7fa008；GitHub 开放 PR 列表为空（含草稿）；未发现其他 work-status 记录占用 lib/memory 路径。仅通过 GitHub API 检查，未检查本地未发布工作。

## 当前任务

进行中：PR-A（审计 P1-1）—— 删除/清理/编辑生命周期里的 lineage 永久锁与被取代旧版本处理。

## 谁在改哪里

Claude；分支 `claude/project-thread-18lv2g`；PR https://github.com/yecays-ai/veil/pull/184；base 204acfb。涉及：`lib/memory/{bank,lineage,lifecycle,progress,startup,types}.ts`、`tests/memory-history-lifecycle.test.ts`、`tests/memory-lineage.test.ts`、`docs/code-rollback.md`。

## 已完成

- 删除记忆时双向收集历史（`mergedFrom` + 反向 `supersededBy`），一并移除并抑制旧文本。
- `cleanMemoryLineage`：指向不存在行的指针视为已消失；仅自链、环、互指不一致才隔离。
- `completeClear`：损坏链标 Flagged 后仍结束清除意图，返回隔离行数（启动报告新增 `isolated`）。
- 自动提交时同一事务把每条 head 的隐藏历史裁到最近 3 个并改写 `mergedFrom`（仅对全部为自动且已被取代的历史生效；含手动/非隐藏行的历史不裁）。头部包含 active / archived / flagged。
- 新增 `docs/code-rollback.md`。
- 检查（Node 22，自动化测试，非真机）：`npm run typecheck` 通过；`npm run lint` 0 错误、3 个既有警告；memory/backup/chat 定向测试 835 通过；全量 `npm test` 1777 项，仅 2 项既有失败（Regex/WorldBook 回滚锁竞争，main 上同样失败）。

## 尚未验证

- 真机（iPhone/Safari）行为；真实模型；跨标签页并发。
- 裁剪掉的旧文本不写抑制，聊天再次出现时可能被重新 CREATE（已知边界）。

## 下一步

CI 绿、评审线程答复后按 AGENTS.md 合并（等 lan 对"合并即部署 Production"的答复）；之后开始 PR-B（P1-2）。
