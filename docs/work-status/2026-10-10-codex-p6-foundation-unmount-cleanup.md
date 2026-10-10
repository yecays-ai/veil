# STATUS — 2026-10-10-codex-p6-foundation-unmount-cleanup

更新人：Codex  
更新时间：2026-10-10T15:43:00+08:00  
发现范围：2026-10-10T07:40Z 通过 GitHub API 核实 `main` 为 #99 合并提交 `a42eda4d31fd52709d7b74d924f00dcd082d5ee5`；开放 PR（含 Draft）为 0；检查 Foundation 历史分支/工作记录，#44 已合并、#45 已关闭，当前没有 Foundation 文件冲突。工作树文件树与该 main 提交一致。

## 当前任务

Foundation 卸载清理测试补强；本地验证完成，PR 待创建/审查。清理类测试总项保持“部分修复”。

## 谁在改哪里

Codex；`test/p6-foundation-unmount-cleanup`；只改 `tests/foundation-cross-tab.test.ts`、`docs/AUDIT_LEDGER.md` 和本记录。基线 `a42eda4d31fd52709d7b74d924f00dcd082d5ee5`。

## 已完成

- Foundation Provider 测试实际登记 focus/visibilitychange 监听器；卸载后检查监听器集合为空，派发事件不会新增 storage load；重挂载后两个事件及 storage subscription 都能再次触发读取。
- BroadcastChannel fixture 追踪频道关闭状态和活动频道；关闭后旧频道不能向 peer 投递、peer 改动不触发旧订阅；新订阅可接收后续变化。
- 三个负对照分别临时移除编译产物中的 focus 清理、visibilitychange 清理、`channel.close()`；对应测试均以 exit 1 和断言失败，恢复后编译文件 SHA-256 与变异前一致。未改生产源码。
- Node v24.21.0 / npm 11.19.0。目标测试 4/4 通过；`npm test` 最终 799/799（首次全量运行有一条无关 Chat 合约测试失败，隔离复跑通过，随后全量复跑通过）；`npm run typecheck` 通过；`npm run lint` 0 errors、6 条既有 warnings。
- 本地实际更新 `docs/AUDIT_LEDGER.md` 板块六：Foundation 局部由未核销更新为已补测待审；保留 #26/#99 证据，清理类总项仍为“部分修复”，天气等仍保留。

## 尚未验证

- JSDOM、fake-indexeddb 和 TestChannel 只证明本地自动化行为；真实 Chromium 多标签、真双窗口、iPhone 未在本任务验收。
- PR 尚待创建；CodeRabbit、GitHub Actions `verify` 和当前 head 的 Vercel 预览状态待核查。CI 若无 runner/执行步骤按未运行记录。

## 下一步

提交本任务独立 PR，核对最新 head 的 CodeRabbit 正文、正式 review 与 inline 评论；不自动合并，等待用户手动合并。
