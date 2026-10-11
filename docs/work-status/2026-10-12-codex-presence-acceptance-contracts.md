# STATUS — 2026-10-12-codex-presence-acceptance-contracts

更新人：Codex
更新时间：2026-10-12T03:53:46+08:00
发现范围：GitHub 观察时间为 2026-10-12T03:40:50+08:00；正式 yecays-ai/veil；main/base `e7b86d0726e603f55232c9f3f52cf43e98f0da8d`。GitHub 核对 T1–T8 对应 #109/#110/#111/#112/#113/#114/#115/#117/#127，均已合并。当前开放 #143（测试夹具）/#144（备份摘要）无本 PR 路径重叠；未发布执行器不可见。读取当前总账和对应任务记录，区分历史待审与合并事实。总账的原登记是板块六“在线系统”待办/冻结清单项，没有独立数字 ID；沿用 Presence T1–T8 子工单，不编造新的总账编号。

## 当前任务

已完成施工、待审查：在线系统前置核销中的提交边界自动化证据。

【总账 ID】板块六既有“在线系统”登记（Presence T1–T8），未新编号。
【这一刀只解决】核销 T5/T7/T8 持久化安全的验收：提交边界与最新在线字段/事件的全站备份恢复。
【验收话】模拟三种失败，动作与 Last Seen 均不应用；模拟 Regenerate 成功，归属/id/次数正确。
【做完划掉】补充提交边界自动化证据；不是发现或修复新的业务缺陷，也不代替模型和设备验收。
【不做】产品规则/冷却变更、新在线功能、角色行为重设计、UI、Memory、生产部署、重新打开已接受风险。
【停止条件】本 PR 验证及审查跟进完，继续独立 Memory 工单准备/夜间交接；所有 PR 等待 Lan 手动合并。

## 谁在改哪里

Codex；branch `codex/presence-acceptance-contracts`；PR [#145](https://github.com/yecays-ai/veil/pull/145)，未合并。
仅新增 `tests/presence-action-commit.test.ts`、`tests/presence-backup-roundtrip.test.ts` 与本记录。无业务改动，无未合并依赖。总账在夜间交接文档 PR 统一对账，不覆写他人的任务记录。

## 已完成

| 原工单/PR | 当前代码证据 | 自动化验收与当前结论 |
|---|---|---|
| T1 / #109 | `lib/presence/compute.ts` | 状态优先、跨午夜、时区、稳定波动、处境结束后恢复；presence-compute 通过 |
| T2 / #110 | `lib/presence/storage.ts`、`character-deletion.ts`、`character-leftovers.ts` | 独立键、队列/锁、角色隔离、Last Seen 单调、损坏/新版本不覆盖、删除与重做；presence-storage/character-deletion/backup-presence-write-gate 通过 |
| T3 / #111、修复 #113 | `lib/presence/routine.ts` | 单次请求、自己的 token 预算、取消/过期结果丢弃、并发合并与再保存重查、失败保留旧作息；presence-routine 通过 |
| T4 / #112 | `lib/presence/view.ts`、`components/chat/chat-header.tsx` | 各面状态计算/加载态展示、Last Seen 取最晚；presence-view/ui 通过。总账 Lan T4 真机状态一致/布局正常证据保留 |
| T5 / #114 | `lib/chat/engine.ts:223`、Presence advanceLastSeen | 普通/Regenerate/Continue 成功记录，失败/停止/未保存不记录、角色隔离；presence-last-message 通过 |
| T6 / #115 | `lib/chat/self-context.ts`、prompt.ts | 一次读取、单请求、备注一次事件与 Continue 不宣布、状态来自当前角色；presence-self-context 通过 |
| T7 / #117 | `lib/presence/actions.ts`、`engine.ts:226` | 标签白名单/清洗/末尾有效、提交后应用、Continue 不应用、冷却/no-op、当前与计划处境；presence-actions 通过 |
| T8 / #127 | Presence userNote、note-events、ChatStorage appendSystemEvent | 两方向备注独立、事件不进模型历史、不改会话 preview、冷却、事件失败不回滚备注；presence-notes 通过 |

- 相关定向 123/123（Presence 所有测试、备份 Presence gate、#142 安全收尾、Character 删除），0 跳过；不把模拟锁/JSDOM 升级为手机证明。
- 新增四项集成用例：provider 在输出动作后失败、输出后 stop、finalizeReply 失败，均只有一次请求、无动作/Last Seen、无已提交完成回复；Regenerate 成功时一次动作对应已提交 id 和正确 Character。没有虚构 main 缺陷，main 原行为已正确。
- 提交前全量一轮 1133 项：1131 通过/0 失败/2 个 main F6 既有跳过（#143 修）；typecheck、build 通过。lint 首轮发现新测试应使用 const，已修并定向重验；最终 lint 0 错误/3 既有警告，diff check 通过。Node24.19.0/npm10.9.4/TS5.9.3，无依赖变更，全部模拟数据。
- 角色删除、作息请求 stale/cancel、Presence 写入协调均有既有定向证据；本轮未发现这些已验收路径的可复现代码阻塞，不做无边界竞态审计。
- 增量核对 T7/T8 存储覆盖：既有测试只覆盖新字段的归一化，没有完整的最新在线数据备份恢复往返证据。新增三项模拟端到端：作息/处境、签名及变更标记、角色给用户的备注、两方向 system 事件的静态导出→校验→空环境/覆盖恢复，比较完整 snapshot；失败覆盖通过 safety copy 还原最新在线数据与事件。全部通过，没有发现新备份遗漏。
- 七项本 PR 定向通过；新测试后必要全量 1136 项：1134 通过、0 失败、2 main 既有 F6 跳过；typecheck/lint（0 错误/3 既有警告）/build/diff check 通过。
- `9de3510317b245202294cafe1ea9b4d164318291` 的 verify 已通过，CodeRabbit 观察时间意见已修复并回复；包含新往返测试的提交另行复审。

## 尚未验证

- 最新提交远端 CI/CodeRabbit 待复审；不将旧提交通过说成最新提交已通过。
- Lan 真机/真实模型：T3 实际 API 返回及提示、T5 回复后 Last Seen、T6 当前状态/备注自然使用、T7 动作时机/不乱改/不复述过去、T8 两向事件和清晰显示。自动化证明协议、次数与持久化，不证明模型在真实剧情里会合理选择动作。
- 已接受不阻塞：T2 无 Web Locks 且两个标签页同时 localStorage 写入的丢更新窗口（原 #110 由 Lan 接受）；T4 浏览器软键盘出现时 Header 暂时位移（原真机记录接受）；不修此二项。
- 暂定冷却/上限保持原值，不未经体验验收自行调整。Vercel 不申请、不绕额度。

## 下一步

提交并跟进审查，转独立 Memory M0–M2 工单准备；最终列出最短 Lan 验收操作，不宣告在线系统整体通过、不自动合并。
