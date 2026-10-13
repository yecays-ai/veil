# STATUS — 2026-10-13-codex-memory-m6-p2

更新人：Codex
更新时间：2026-10-13T15:53:00+08:00
发现范围：本轮 GitHub API 重核 main fe6a209f9938d230dc10b60d822508bf1cb436c5，PR #168 open/未合并，审查 head aca441e4f4f24b7c6df886b9d0d54ee21a0f9222，开放 PR 仅本单；读取最新两条 CodeRabbit 意见、相关代码、AGENTS、main 唯一台账及模块合同，未发布本地工作/不可见外部自动化无法发现。

## 当前任务

待审查：P2 [PR #168](https://github.com/yecays-ai/veil/pull/168) 原四条意见已由机器人关闭，本轮两条新意见完成最小修复与本地验证，等待本轮发布 head 的检查及 Lan 手动验收，PR 未合并。

## 谁在改哪里

Codex；分支 codex/memory-m6-p2；独立工作区 veil-memory-m6-p2，真实 main 基线如上；本地是 API 校验的合成快照历史，禁止直接推送该历史，Git Data API 以实际远端 head 为 parent 并用 expected_sha / force=false 更新同一 PR 分支。
原检查点 bcd756267ae1879474298e477df5dfbd8d5232ed 及补丁保留在工作区外，不入 PR；本文件仍是唯一 P2 work-status。
完整 P2 为 32 文件：Foundation/Provider/写队列、Memory 维护/State/来源清理/查询、Chat storage/Prompt/engine、只读 Social UI、Backup validation、三份模块/台账/状态文档和三份测试；详见 PR diff 与模块记录。
本轮仅 6 文件：lib/memory/lifecycle.ts、lib/memory/browser.ts、tests/memory-state-p2.test.ts，以及唯一总账/本记录/模块合同；不改部署配置或 P3–P5。

## 已完成

- 新增复审两条：记录过期（Minor）及并发 clear 复用 token（Major）；用真实共享租约和受控 Promise 复现旧操作恢复定向 marker、撤销后来整段 marker 的两个失败分支，再修复为每次 intent 独立 token，恢复/取消均校验自己的 token；startup 能继续清理 State，无新字段或请求。
- 本轮受影响回归 **995/995、零跳过，57 项 P2 新测试**，测试编译、typecheck、改动文件 lint 与 webpack build 通过；两个新增并发测试先 Red 后 Green，未弱化原断言。
- 已验证审查 head **aca441e4f4f24b7c6df886b9d0d54ee21a0f9222**：[CI #1185](https://github.com/yecays-ai/veil/actions/runs/38362289026) 成功、1586/1586，[Preview](https://veil-pwggjav33-yecays-ai.vercel.app) READY/target=null；CodeRabbit 对该 head 已完成增量审查并提出本轮两条，原四条均 resolved，不把已通过检查留在尚未验证。
- P2 Background 版本保存/跨库失败协调、State 正常维护 CREATE/UPDATE/REVIEW、D1 显式暂停、D2 来源失效/前驱恢复、Prompt 8 条/2,000 字符、只读 UI、严格 hash 备份恢复完整链；原 release/device consent、owner/cursor/restore/uncertain、manual/Journal/Presence/Last Seen/签名保护保留，无额外模型请求。
- CodeRabbit 2026-10-13T06:57:46Z 对 fe6a209 至 714072a 完整审查 32 文件，4 条有效意见（1 Major、3 Minor）：Foundation 被 Memory 修复失败阻断；State 页面事件逐个读/闪 Loading；定向清理转整段清空留下旧 epoch/无效 marker；本状态记录格式。
- Foundation unscoped load 的快照修复 best effort，Memory/lease 故障回落普通文档读取；文档读失败仍报错，scoped load/State/写入的恢复及权限门禁保留，不将跨库称为原子事务。
- State UI 每个 effect 至多一读和一项合并后的待刷新，后续事件使旧结果失效；后台刷新保留已显示内容，角色/Background/Retry 新 lifetime 进入 Loading，卸载后不再启动排队读取。
- 整段 clear intent 移除定向 hash 标记并换 token，只在 targets 定义时保留 cursor；完整清理后删除旧 cursor，随后正常维护可在新 epoch 运行；中断可 startup resume。
- 补故障边界：整段 Chat 清空失败时按准确 replacement token 恢复之前的定向 marker，不能覆盖新 owner；替换前 token 已变则拒绝，不丢失既有删改来源的恢复证据；未增加持久字段/模型调用/定时器。
- 本轮测试先在原 PR head 行为上运行：8 个选中测试 7 Red、1 文档错误保护已通过，再修复 Green；另复现并修复整段清空失败后丢失定向证据的分支，补 stale token/新 owner 保护。
- Node 24.19.0：受影响 Memory/Backup/Presence/Foundation/Character 删除/Generation/全部 Chat 回归 **993/993，零跳过**，共 **55 项 P2 新测试**（State/Persistence 47、Prompt/UI 8）；测试编译、tsc --noEmit --incremental false、改动文件 ESLint、next build --webpack 全通过。
- fake IndexedDB、模拟 Web Locks、挂载 JSDOM、stub provider；独立编译 ../veil-memory-m6-p2-tests，不使用共享旧产物；没有删/弱化/跳过有效测试。
- 修复前 head 714072abf180a945322fb0c547c25e1f585fd910 的 [CI #1183](https://github.com/yecays-ai/veil/actions/runs/38358757663) typecheck/full lint/full tests 1576/1576/build/diff 全成功，Vercel dpl_HTJ1GVE73zNg6XpsVBBhbJXByAHn READY、target=null；不套用到本轮修复 head。
- 历史代码 head **8f9430701b5cc45e4ca2d49a04940f3e4619d5b9** 的 [CI #1184](https://github.com/yecays-ai/veil/actions/runs/38361506517) 全部成功（typecheck/full lint/**1586/1586、零跳过**/build/artifact/diff），[Preview](https://veil-od259e06k-yecays-ai.vercel.app) READY/target=null；原四个线程现已由机器人关闭，准确最新审查见上方本轮两条意见，不把旧 pending 状态沿用为当前事实。
- 发布门禁本轮重查：唯一 CI 仅验证，scripts/package 无非 main Production/提升/自动合并动作，无 vercel.json/部署脚本；Vercel 正确绑定 veil，当前 P2 为 Preview，Production 仍 main fe6a209 / dpl_2nXrmSuW3sJ4gnGg1CNgi548pov3，用户已确认 Production Branch=main，无配置改动。
- 模块数据合同与测试矩阵见 [memory-m6-p2-integration](../memory-m6-p2-integration.md)。

## 尚未验证

- 本轮修复发布 head 的检查与复审结果以 PR 实时元数据为准；aca441e 的 CI/Preview 已验证，不沿用到新版本，也不把尚未确认的复审当通过。
- CodeRabbit docstring coverage 51.16%/80% 是非阻断警告，无具体功能缺陷，未为指标扩大无关改动。
- 真实模型语义/冲突判断、iPhone/Safari 中断、多真实 tab 和页面视觉仍未验证；无锁 Background 变更/来源替换仍安全拒绝，混合来源整体撤销可能损失有效片段，关闭维护/无新消息/预算超限时保持 pending。
- P1 无 hash 版本需正常维护明确复核后才可注入；新元数据不保证旧软件降级可写；第二库失败可能已保存 Foundation，只读仍可用而 State 保持 pending，不能宣称跨库回滚。
- 未启用 Maintenance、改 consent、调用真实模型/生产 API Key、修改真实数据、Production/提升、合并/automerge 或继续 P3–P5。

## 下一步

仅有限核对本轮并发修复的检查和复审后等待 Lan 手动审查，长期 pending 如实报告且不无限轮询，不合并、不 Production、不继续 P3–P5。
