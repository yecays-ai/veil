# STATUS — 2026-10-13-claude-memory-t2a

更新人：Claude
更新时间：2026-10-13T14:10:00Z
发现范围：base origin/main 3120533（含 #173）；仅检查本任务路径（lib/memory 维护调度、Settings 维护页、相关测试）；未逐一检查其他开放 PR。

## 当前任务

Memory 重做工单 2a：维护触发改为容量触发（进行中，待开 PR）。滚动摘要是 2b，单独一个 PR。

## 谁在改哪里

Claude；分支 `claude/memory-t2-capacity-summary`；PR 尚未创建。涉及 `lib/memory/{maintenance-capacity,explicit-request,maintenance-runner,maintenance-scheduler,maintenance-status,maintenance-input,maintenance-browser}.ts`、`components/settings/memory-maintenance-settings.tsx` 及对应测试。

## 已完成

- 取消固定五分钟空闲门槛和定时低频补充；累积 20 条已编号消息（一整批，沿用 `MAINTENANCE_BATCH_SEQUENCES`）或有可恢复的 ready 批次时才到期；回复生成中永远不启动。
- 保留：失败恢复、游标、失败/未知/过大空洞不重试、每个 Character 同时只跑一个、请求前派发。
- “请记住”只做本地明确请求识别（疑问句、回忆句不触发），仅在维护输入里给该消息加 `explicitRequest` 标记，不增加模型调用、不提前触发。
- Settings 维护页改为显示“已累积 N / 触发 20”，不再显示“下次检查时间”。
- 验证（自动化测试，非真机）：typecheck 通过；eslint 干净；`memory-maintenance-runner` 37、`-lifecycle` 9、`-settings` 5、`memory-state-p2` 49、新增 `memory-t2-capacity` 5 全部通过；`npm run test:memory` 167 通过 0 失败。

## 尚未验证

- 真机后台/锁屏行为；真实模型对 explicitRequest 的遵从程度（需 lan 另行批准付费评测）。
- 少于 20 条的尾部消息会一直等到下一次容量触发（这是已决定的取消低频补充的结果）。

## 下一步

开 PR，CI 绿后合并，然后做 2b 容量触发滚动摘要。
