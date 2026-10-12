# STATUS — 2026-10-12-codex-memory-m4-context

更新人：Codex
更新时间：2026-10-12T16:40:04+08:00
发现范围：2026-10-12 施工前通过 GitHub API 复核 canonical main `e5239fdca2d434d7f81a8f67a19c88be1a48d33e`；开放 PR（含 draft）为空，远端分支列表没有新的 Memory 施工分支。已读最新 `docs/AUDIT_LEDGER.md`、正式交接和批准 v2 原文（Q1–Q7）；Q8 从 Lan 指定原始 DOCX 第 5.3 节核实。未发布的本地工作不可见，未据历史工单接管其他任务。

## 当前任务

M4 Memory 上下文注入：施工完成，待独立 PR 审查和 Lan 手动合并。仅限本次批准方案及 Q8 交接更新；不进入 M5–M8，不主动部署。

## 谁在改哪里

Codex；分支 `codex/memory-m4-context-20261012`；[PR #157](https://github.com/yecays-ai/veil/pull/157) 已提交，未合并。base `e5239fdca2d434d7f81a8f67a19c88be1a48d33e`；已验证代码提交 `edbc6a7b118eaa76ce5df8c6dd4dfe864fb1db52`，后续仅补本工单 PR 链接，不改代码。

- `lib/memory/context.ts`：只读本地选择、指纹去重、确定性序列化与临时护栏。
- `lib/chat/engine.ts`：读取依赖、并行准备、取消与所有权检查、现有 MemorySlot 注入。
- `lib/chat/prompt.ts`：复用同一 History/pending 窗口，动态 Memory 仅进入首个有效 system marker。
- `lib/chat/request-diagnostics.ts`：仅开发环境的 id/字符数/结果码，无正文。
- `tests/memory-context{,-engine}.test.ts`、本工单与 `docs/memory-m4-m8-handoff.md`。

Git DNS 不可达：不重试或改用户网络配置。独立本地快照由现有 Git archive 与远端最新 SHA 的差异文件组装，随后逐文件验证全部 597 个 blob 的 Git SHA-1 与远端树相同；只在该验证完成后施工。通过 GitHub Git-data API 从 base 建立独立提交/分支，保留现有 `codex/s11-api-key-restore` 工作区。

## 已完成

### 请求数据流与选择规则

现有 Reply / Regenerate / Continue → 已验证的 session/Character/Binding 与 batch → 按 Character 索引读取 Memory → 仅 active、相关候选 → 去重/预算/排序 → 原 `MemorySlot.entries` → 有效 system memory marker → 原 provider。测试连接、Presence、Here & There 不接入。不开额外模型请求，不读取来源聊天原文，不修改任何 Memory 持久记录。

检索用实际配置的最近 40 条有效 History 与 authoritative pending，沿用 Prompt Regex 和引用文本处理；关闭 History 时检索不偷偷读取历史。排除 system 和未完成/失败/取消消息。拉丁词项（至少 3 字符，排除常用功能词）命中至少一项，或 CJK bigram 命中至少两个不同项，才进入候选；这是可调整的词面工程假设，不是最终语义能力。相关 manual 优先，其次 active ongoing，再按匹配数、updatedAt、id 选择；不匹配不填充。M4 不添加 Ongoing 结束/过期机制（M7）。

复用指纹，去除候选间及与实际上下文整段精确重复的文本；不按 sources 全在 History 就排除记忆，避免把用户修改过或有额外补充的记忆误删。选中集合按 id 稳定输出 JSON 行（kind、subject、origin、text）；不把 sources、聊天原文或 id 放入记忆正文。只使用首个有效 system memory marker，关闭/删除/non-system 的 marker 不读库或强行补插，不修改用户保存的 Preset。

读取与原 weather/self 准备重叠，失败降级且不重试、不写库；中止时不等待迟到读取，迟到成功/失败不能触发 provider；provider 前检查信号和 authoritative generation owner。开发摘要只含选中 id、序列化字符数和 selected/empty/unavailable/preset-disabled 结果码。

### 临时预算依据与边界

临时最多 **5 条、序列化 Memory 内容总计 2,000 个 UTF-16 字符**（JSON 字段/转义及行间换行均计入；原 Preset 节标题仍由现有组装生成）。不截断条目；超预算整条跳过，可继续挑选较短的相关条目。

这是保守限制 M4 新增量的工程护栏：现有 History 是 40 条而非 Token 窗口，消息本身无输入硬上限；模型是用户保存的自由配置，没有可据以计算余量的上下文容量元数据。输出 `maxTokens` 仅控制输出，不用作输入预算；诊断的字符数/4 粗估不当真实 Token。未取得设备 localStorage 的 M0 实际用量，不能据此保证适配任何模型的窗口或给出真实成本；最终预算验收待 M0 实际数据与真实模型验证。不增加 tokenizer、模型目录或全局输入裁剪。

### 固定召回样例（所有 10 项的目标记忆语义上相关）

| 样例 | Memory | 当前表达 | 结果 |
|---|---|---|---|
| 英文直提 | I keep orchids in my greenhouse | How are the orchids? | 命中 |
| 中文直提 | 我正在照顾阳台上的兰花 | 阳台上的兰花怎么样了？ | 命中 |
| 英文换说法，保留主题词 | I paint landscapes beside the river | Tell me about your river painting | 命中 |
| 中文换说法，保留主题词 | 我周末在海边练习摄影 | 海边拍照的练习顺利吗？ | 命中 |
| 英文同义 | I resigned from my job | How do you feel after quitting work? | 漏召回 |
| 中文同义 | 我已经辞职，开始写小说 | 离开工作以后，创作顺利吗？ | 漏召回 |
| 英文间接，保留 taught | My grandmother taught me to grow orchids | Do you remember what she taught you? | 命中 |
| 英文间接，无共同词项 | My grandmother taught me to grow orchids | Does her advice still come to mind? | 漏召回 |
| 中文间接 | 我和妹妹约好周五去看展览 | 你们之前约好的事情还去吗？ | 漏召回 |
| 中文短主题 | 我喜欢兰花 | 兰花长得好吗？ | 漏召回 |

本组结果 **5/10 命中、5/10 漏召回**；不是代表真实世界质量的统计基准。测试明确锁定目前的漏召回结果，测试通过不等于这些问题已解决。另测无关候选、功能词薄查询、角色和状态排除。未增加 embedding、额外模型调用、同义词表或大型架构。可选轻量改进（未实施，需 Lan 决定）：短中文主题允许受约束的单 bigram 命中并增加负样例；小规模、经批准的同义词映射；用近轮优先/词项区分度减少陈旧历史误召回。代词无锚点的关联仍可能需要后续实测；M7 再按证据讨论。

### 验证

环境 Node v24.19.0，TypeScript 与其余依赖复用现有安装（package-lock 与基线一致）。

- `node node_modules/typescript/bin/tsc --noEmit --incremental false`：通过。
- `node node_modules/eslint/bin/eslint.js lib/memory/context.ts lib/chat/engine.ts lib/chat/prompt.ts lib/chat/request-diagnostics.ts tests/memory-context.test.ts tests/memory-context-engine.test.ts`：通过，无输出。
- `node node_modules/typescript/bin/tsc --project tsconfig.tests.json --outDir .m4-tests`：通过；编译输出在独立工作目录，不覆盖其他执行器的测试缓存。
- `node --test .m4-tests/tests/{memory-context,memory-context-engine,chat,preset,regenerate,generation-safety,memory-storage,memory-bank,memory-backup,usage-baseline}.test.js`（实际逐文件参数）：**141/141 通过，零跳过**，其中 M4 新增 30 项。覆盖普通/再生成/继续各一次请求、隔离/状态/相关性/预算/去重、Preset、读取失败、取消迟到成功/失败、真实 session lifecycle 切换与所有权竞态、读取与 self 准备重叠、生产诊断关闭。
- 独立负向验证（只改本地编译输出，每次恢复）：移除 Memory 注入、Character 隔离、provider 前最后一次所有权检查，分别导致对应行为断言失败；恢复后测试通过。临时验证脚本和输出不提交。
- 默认 `next build`（Turbopack）：**未通过，环境限制**，独立快照复用依赖的 junction 被判为 filesystem root 外；不声称默认构建通过。`NEXT_TELEMETRY_DISABLED=1 node node_modules/next/dist/bin/next build --webpack`：生产构建、TypeScript 与页面生成通过。未改变仓库构建配置。

## 尚未验证

- 真实模型的回复是否正确使用 Memory、iPhone Safari 的读取延迟与取消体验、真实多标签页、M0 实际 Token/费用/延迟/缓存收益。
- 字符护栏不保证全请求 Token 预算；读取本 Character 全部 Memory 后本地筛选，未来大库的性能未测，不加缓存或订阅。
- 明确存在上述语义与短中文漏召回；没有把词面命中当作语义理解。全 40 条窗口中的常用主题词可能造成误召回，真实精度仍须测量。
- 未跑全量测试、浏览器或真机；远端 CI/预览以实际 PR 状态为准，不主动部署。
- Q8 已批准，但 M4 不修改现有撤销行为。M5 仍需单独授权并解决自动维护不得挤占用户撤销历史的问题。

## 下一步

等待 Lan 手动审查、合并 [PR #157](https://github.com/yecays-ai/veil/pull/157)，并做真实模型/手机验收；预算和检索改进由 Lan 另行决定。M5–M8 未授权。
