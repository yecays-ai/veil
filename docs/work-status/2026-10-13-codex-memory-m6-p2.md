# STATUS — 2026-10-13-codex-memory-m6-p2

更新人：Codex
更新时间：2026-10-13T14:45:52+08:00
发现范围：本轮 GitHub API 重核 main fe6a209f9938d230dc10b60d822508bf1cb436c5、P1 #167 merged=true，open/draft PR 为空。已读最新 AGENTS、唯一总账、P1 合同与任务记录；未发布本地工作、不可见外部自动化无法发现，不作安全保证。

## 当前任务

P2 施工与发布完成，[PR #168](https://github.com/yecays-ai/veil/pull/168) 未合并，等待 CodeRabbit 完成及 Lan 手动审查。代码 head 的 CI/Preview 已通过，最后文档提交后的最新 head 必须单独重核；原检查点保留，本文件仍是唯一 P2 work-status。

## 谁在改哪里

Codex；独立工作区 veil-memory-m6-p2；分支 codex/memory-m6-p2。真实 main 基线如上，不使用 ae5c8999。
本地历史是 API 校验源码的合成快照，父基线 840e8cda18c018c19ea16891be61e6e29217faa5，保全检查点 bcd756267ae1879474298e477df5dfbd8d5232ed。禁止直接推送合成历史；Git Data API 以真实最新 main 为远端首提交 parent，仅发布 P2 分支，不 force push。原 checkpoint patch 留在工作区外，不入 PR。

改动路径组：

- Foundation：lib/foundation-storage.ts、components/foundation-provider.tsx、lib/backup/write-queue.ts。
- Memory：instance/browser/progress/maintenance-{browser,input,operations,runner}/state-maintenance/state-foundation/types。
- 来源与只读读取：lib/chat/storage.ts；lib/memory/source-hash/source-invalidation/lifecycle/startup/state-runtime/state-browser/state-events。
- Prompt/UI：lib/chat/prompt.ts、engine.ts；components/character-state-panel.tsx、character-social-profile.tsx。
- Backup：lib/backup/validation.ts；原完整六表恢复单位与摘要承载新增可选 hash/intent 元数据。
- 测试：tests/memory-state-p2.test.ts（38）、memory-state-prompt-ui.test.ts（7）；chat-overlay-focus 原挂载夹具接入模拟 Web Locks，所有原断言保留，无测试删除/跳过/削弱。
- 文档：唯一总账、本文件、docs/memory-m6-p2-integration.md。

## 已完成

- Background 独占顺序保存、Foundation CAS、原始快照不覆盖；第二库失败由实际 Foundation load/retry 追加协调，明确不是跨库原子事务。共享 scope 的既有 status/signature 等写入保留。
- 同一次原正常维护请求的 State CREATE/UPDATE/REVIEW，原 release/device consent 门禁不变；严格来源/head/Background/owner/restore 证据；State、Memory、进度同库事务，不占五条手动 Undo，不改 manual/Journal。
- D1 缺明确复核 pending，conflict suspended，compatible 才 active；绑定准确 head/basis，未知不升级兼容，不唤醒独立请求。
- D2 单条删改/整轮重生成/复用 ID 的 hash 清理；前驱恢复、混合版本保守撤销。Chat 后清理失败保留意图，重启比较旧 hash；旧 tab 变化先隐藏，下次正常输入物理清理，strict backup 拒绝失效正文。
- 实际 system Character marker overlay，8 条/2,000 字符含权威说明；保存的 Foundation 和实际来源校验，pending/suspended 不注入；一次请求、取消保护。Social 页面只读，加载/错误/Retry、切角色/迟到结果与卸载清理。
- Node 24.19.0：Memory/Backup/Presence/Foundation/Character 删除/Generation/Chat 受影响回归 983/983、零跳过，含 45 新测试；fake IndexedDB、模拟 Web Locks、挂载 JSDOM、stub。
- 测试编译独立输出 ../veil-memory-m6-p2-tests；受影响 node --test --test-concurrency=4 通过；tsc --noEmit --incremental false、改动 TS/TSX ESLint、next build --webpack 通过。构建 CI=true、telemetry disabled、maintenance approval=false，不调用模型或部署。
- Red/Green：新 State 同库提交测试在隔离产物中换入真实 main 对应 Progress 后，明确因缺 State authority 失败；恢复 P2 后通过。没有修改 main 或原源码。新增 hash 的导出/strict/预览/空/覆盖/回滚/中断 resume 通过。
- 发布门禁：实时 Vercel main fe6a209 / dpl_2nXrmSuW3sJ4gnGg1CNgi548pov3 是 Production，P1/其他分支 target=null 是 Preview；Git 关联 yecays-ai/veil 正确。Lan 已只读确认 Production Branch=main。重读唯一 CI、scripts/package 和仓库配置，没有 Production/提升/automerge 动作，没有 vercel.json 或部署脚本；没有修改生产配置。
- 首发 head 33d4c98c87a0a7626225a22a4772d0ebeb0bfa99 / CI #1181（38357379581）：typecheck/lint 成功，test 一项失败（Chat 删除确认测试的 JSDOM 缺 Web Locks，新增来源安全门禁拒绝删除），build/diff 因测试失败未跑。补齐模拟锁后原测试通过；同时修复不替换来源的普通回复/continuation 使用原共享租约、无锁 signature 保存兼容及稳定内容 hash，不让 delivery/outcome 元数据撤销证据。扩大到全部受影响 chat* 回归 983/983；修复后本地 typecheck/lint/build 通过。最新远端 head 仍须重新验证。
- 首发 Vercel dpl_FaktaNbpc6Kyy6NW4j6fK1AsZJtA READY、target=null（Preview），SHA 为上述首发 head，[Preview](https://veil-ni9s5cz65-yecays-ai.vercel.app)；不是修复后 head 的成功承诺。CodeRabbit 首发仍 pending，无 review/线程。
- 修复后的代码 head **898a3c253600eb6eed664146bef9a1bd5f4411bc**：[CI #1182](https://github.com/yecays-ai/veil/actions/runs/38358308263) typecheck、全仓 lint、全仓 tests **1576/1576、零跳过**、build、diff 全部成功。Vercel dpl_FcosX6BxQearcaWkcCbdpGHLqman READY、target=null、同 SHA，[Preview](https://veil-d8hzs7l4u-yecays-ai.vercel.app)。本地受影响 983/983 与远端全仓 1576/1576 分开记录。
- 2026-10-13T14:45:52+08:00 CodeRabbit 仍显示首发完整 31 文件审查处理中，零 review/未解决线程；这不是已完成审查或通过证明，最新 head 审查仍 pending。最终文档提交与结果请以 PR 最新 head 实时检查为准，不把上述代码 head 成功套到新提交。
- 数据合同与测试矩阵见 [模块记录](../memory-m6-p2-integration.md)。

## 尚未验证

- 修复后 P2 最新 head 的 CI/CodeRabbit/Preview：待外部执行，按具体 head 核实；首发 CI 失败事实如上。
- 真实模型重大/持续/冲突判断、iPhone/Safari 中断、真实多标签页、实际页面视觉未验证；协议与模拟不等于质量保证。
- 关闭维护/无新消息时 pending 持续；输入超预算安全失败，不额外请求。无 Web Locks 普通读取/新回复/continuation/signature 保留，Background 变更和来源编辑/删除/重生成拒绝，State 不可用，不绕过隐私门禁。
- P1 无 hash 版本必须正常维护明确复核后才可注入；新元数据不保证旧软件降级兼容。混合撤销会损失部分仍有依据片段。
- Foundation 第二库失败可能已经保存新文档；返回错误并由 load/retry 协调，不能宣称跨库回滚。
- 未启用 Maintenance、改 consent、真实 API Key/付费模型、真实数据、Production/提升、合并/automerge 或 P3–P5。

## 下一步

有限检查最终文档 head 的 CI/Preview/CodeRabbit，修复范围内有效问题；外部审查长期 pending 如实报告，不无限轮询。停在 PR #168，等待 CodeRabbit 与 Lan 手动审查，不合并、不 Production、不继续 P3–P5。
