# STATUS — 2026-10-14-codex-life-daily-plan

更新人：Codex  
更新时间：2026-10-14T22:20:00+08:00
发现范围：2026-10-14T21:48:00+08:00 通过 GitHub 核对最新 `main` 为 `a55ed8048951da74ae8410873a6d1686d00d7615`（PR #195 已合并），开放 PR 为空；本分支从该提交创建。已读根 `AGENTS.md`、`docs/work-status/README.md`、`docs/AUDIT_LEDGER.md`、Activity Core 与 Presence 计算/存储边界。

## 当前任务

已修待审：在已合并的 Activity Core 上建立零模型调用的低频生活计划投影。根据角色现有 Routine / Situation 和时区生成粗粒度、稳定身份的活动候选；重复唤醒不重复写入，重新打开只按时间确定性补算。本单不接 Chat Info UI，不实现忙时延迟回复。

## 谁在改哪里

Codex；分支 `feat/life-daily-plan-20261014`；PR 待创建。新增 `lib/life/plan.ts`、`tests/life-daily-plan.test.ts`，并在 `lib/presence/compute.ts` 开放本地日界与只读分段两个纯计算接口。不会修改 `lib/memory/*`、聊天生成、主动消息预算或通知。

## 已完成

- 核对 PR #195 已并入最新 main，当前没有开放 PR 或路径占用。
- 明确本步不调用模型：调度检查频率不等于模型调用频率，离线补算不会补写模型生成的过去。
- 每次投影固定覆盖角色当地时间的昨天、今天和明天；最多保留每日本地 12 个粗分段，以满足 Activity Core 的七日 96 项上限。
- Routine 提供睡眠、工作、外出与空闲的粗段；Situation 在其有效区间覆盖标题，例如 `Patrol`。没有 Routine 时只记录明确 Situation，不把默认 offline 冒充全天睡眠。
- 活动 ID、occurrenceKey、通用标题和少量可选 Moment 都由稳定输入确定；十分钟内反复唤醒得到同一候选，现有 Activity Core 负责只提交一次。
- 已经投影的时间被冻结；之后修改 Routine 只能填空白，不改写用户可能已经看过的旧活动。
- 本地行为测试先在 main 缺少 `lib/life/plan.ts` 时编译失败，再实现为 Green。测试编译通过；Life daily plan 6/6、Activity Core 8/8、Presence storage 16/16、Presence compute 11/11，共 41/41；改动文件 ESLint 通过。Node 24.19.0。

## 尚未验证

- Chat Info 时间线、浏览器与真机显示不在本单。
- 全仓 `tsc --noEmit` 仍被当前临时 pnpm 链接中的 Playwright 类型导出错误阻断；`tsconfig.tests.json` 测试编译与改动文件 lint 通过，报错路径均为未改动的 `e2e/cross-tab-sync.spec.ts` 和 `playwright.config.ts`。

## 下一步

提交、推送并创建独立 PR，等待 Lan 手动合并。后续独立工单在 Chat Info 加入只读 Life 页面，并在该入口的低成本唤醒中把本投影交给 Activity Core 结算。
