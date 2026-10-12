# STATUS — 2026-10-12-codex-memory-m41-retrieval

更新人：Codex
更新时间：2026-10-12T17:46:52+08:00
发现范围：施工前 GitHub API 核实 #157 已合并；main `9c93cf9d5302268659613444b64ccf67d50f28e7`；开放 PR（含 draft）为空，远端分支没有新的 Memory 施工分支。已读 AGENTS、M4 工单、正式交接及直接相关检索/Prompt 路径；只读最新总账作为规则入口，没有重新审计其他模块。未发布的本地任务不可见。

## 当前任务

M4.1 本地检索质量补强：施工完成，待独立 PR 审查、Lan 手动合并与验收。本次仅授权 M4.1，不进入 M5–M8，不主动部署。

## 谁在改哪里

Codex；分支 `codex/memory-m41-retrieval-20261012`；[PR #158](https://github.com/yecays-ai/veil/pull/158) 已提交、未合并。base `9c93cf9d5302268659613444b64ccf67d50f28e7`；已验证代码提交 `da5e7d5dbaeca4f2d8d41de03826f4d089426a5f`，后续只补本工单 PR 链接，不改代码。

Git 网络在本环境已知 DNS 不通，不反复重试或改网络配置。建立独立 `veil-memory-m41` 快照，施工前全部 601 个版本文件的 Git blob SHA 与最新 main 一致；不覆盖 M4 或 S11 工作目录。通过 GitHub Git-data API 创建基于上述提交的独立分支/提交。

涉及：`lib/memory/context.ts`（词项、候选门槛与排序）；`lib/chat/prompt.ts`（只为检索分区，保持实际 Prompt 不变）；`lib/chat/engine.ts`（传递新查询形状）；M4 原有两份测试；新增 `tests/memory-{m4-baseline,retrieval-fixture,retrieval-evaluation,retrieval-quality.test,retrieval-safety.test}.ts`；`scripts/evaluate-memory-retrieval.mjs`、[评估报告](../memory-m41-evaluation.md)及本工单。

## 已完成

- 英文保守 -ed/-ing 变体（含末尾 e、重复辅音候选），仅两个通用不规则形式 slept/sleep、taught/teach。不做宽泛同义词合并。通用动作词及其词形变体不能独自成为主题；唯一语义短语组是有就业对象的离职表达及其已批准中文对应，不把辞职默认等同所有 resign/quit/leave。
- CJK 功能短语先分隔再切 bigram，避免跨短语误重合。单 bigram 必须在双方切词段边界上匹配；不接受单个汉字或任意常见双字词。
- 保留角色/顺序：pending 为当前，没有 pending 时用实际发送 History 内最新用户消息。最近两个已完成用户/assistant 交换（split assistant 气泡为一个交换）作为锚点，较早 History 只做相关候选的排序补充，不能触发候选。实际发送的最近 40 条 History 不变，关闭 History 不偷偷读历史。
- 已有当前直接匹配时不从近期其他话题补位；否则只允许同一近期句子/分句的词面桥接，或唯一最新主题的泛指追问。竞争对象（包括没有 Memory 行的对象）、明确新话题、不可靠代词指代均拒绝猜测。rest 只有近期睡眠锚点支持时才可补充，不全局视为 sleep；adopt/took in、sister/sibling 不合并。
- 候选准入后才考虑 manual/ongoing；词项在本 Character 候选库中的频率辅助排序，最终输出按 id 稳定。指纹去重、active/Character 隔离、整条超长跳过、5 条/2,000 序列化字符护栏不变。
- engine 的读取次数、失败无 Memory 降级、取消/所有权检查、provider 请求生命周期保持；不增加模型/网络请求，不写 Memory，不修改存储、来源、压制、撤销、备份、模型绑定。

### 正式效果（与探索性探针分开）

原有 10 项保持原文及 M4 hit 标记；测试专用冻结 M4 选择器（仅改 import 路径）作为实际对照。原集 **5/10 → 8/10**：英文同义、中文离职表达、短中文兰花改善；其余不变，原有命中无退化。

另在算法改动前固定了 **72 项全新正式样例**：英文 20 正/20 负，中文 8 正/8 负，混合 8 正/8 负。未参与施工前探索探针的调节；实现时可见，不是盲测或真实用户聊天。标签与输入在实现期间没有修改。另有独立安全/排序/窗口测试，不计入这 82 项正式效果分母。

| 语言（含原集） | 正例命中 M4 → M4.1 | 负例误召回 M4 → M4.1 | 改善 / 退化 / 不变 |
|---|---|---|---|
| 英文 | 12/25 → 19/25 | 10/20 → 0/20 | 17 / 0 / 28 |
| 中文 | 3/13 → 10/13 | 2/8 → 0/8 | 9 / 0 / 12 |
| 混合 | 3/8 → 6/8 | 2/8 → 0/8 | 5 / 0 / 11 |

改善计数包含“漏召回变命中”和“误召回变拒绝”。负例只要任意候选被选中就算误召回，不只检查目标 id。逐项结果、全部不变项、剩余 11 项漏召回的原因见评估报告。最终正式集无退化；不把这一结论外推到真实聊天。

### 验证与性能

环境 Node v24.19.0、Next.js 16.3.8，复用已有依赖，未改 package/lock。

- Red：尚未改算法时新增质量断言在 main 快照上运行，短中文/原集改善、全新英文改善两项失败；不是编译失败。
- `node node_modules/typescript/bin/tsc --project tsconfig.tests.json --outDir .m41-tests`：通过，输出在独立目录，不覆盖其他执行器缓存。
- `node --test` 定向执行 M4 两份测试、retrieval-quality/safety、chat、preset、regenerate、generation-safety、memory-storage/bank/backup、usage-baseline：最终 **192/192 通过，零跳过**（包括 M4 30 项及 M4.1 新增 51 项）。
- `node node_modules/typescript/bin/tsc --noEmit --incremental false`：通过。
- 修改文件 ESLint（上列生产代码、测试 helper/test、评估脚本）：通过，无输出。
- 独立负向验证，只改本地编译输出、每次恢复：去掉短主题准入、把较早 History 混回主查询、去掉无 Memory 行竞争对象防护，均使对应行为断言失败；源文件不被变异。
- `NEXT_TELEMETRY_DISABLED=1 node node_modules/next/dist/bin/next build --webpack`：最终源代码生产构建、TypeScript、页面生成通过。默认 Turbopack 因已知依赖 junction 出 root 的环境限制，本轮未重试，不声称默认构建通过。未改构建配置。
- 可重复评估：编译后运行 `node scripts/evaluate-memory-retrieval.mjs .m41-tests`，输出分语言效果、每个 case 的选中 id/字符数/前后结果、固定 CPU 基准。常规 `npm test` 编译目录也可直接运行脚本，无参数。
- CPU 基准（40 条较早 History、当前明确主题；预热 20、交替执行 101 次；没有同时启动本任务的编译/构建）：25/100/1,000 候选 p50 分别 0.058/0.143/1.111 ms → 0.105/0.299/2.792 ms；p95 0.115/0.285/1.502 → 0.236/0.562/3.692 ms。不是 iPhone 或端到端首响应延迟。选择复杂度仍随本 Character 的候选量增长，未引入缓存。
- 上述基准每次都是 5 条、514 字符，格式/护栏不变；82 项样例序列化记忆字符累计 3,243 → 3,074，不能当作真实 Token/费用变化。

## 尚未验证

- 固定集有 11 项持续漏召回：无锚点代词/裸动作、未合并的宽泛同义、无词面桥接的跨语言。没有为追求满分引入翻译、embedding、额外模型调用或角色专属规则。
- 词面/句界/协调词判断不是完整语言理解：不规则词形、内部中文词边界、别名、隐含对象、复杂协调句仍可能漏召回或误召回。短中文泛指规则有意保守；同主题多条记忆也可能被竞争检测拒绝。
- 当前直接匹配会阻止近期仅间接相关的补充，优先控制误召回，可能牺牲部分召回；无法将小集的 0 误召回宣称为真实精度保证。
- iPhone、真实 IndexedDB 大库读取与真实首响应延迟、M0 实际 Token/费用/缓存收益未验；仍是临时字符护栏，不是全请求 Token 输入预算。
- 未跑全量测试或真机；CI/预览按实际 PR 状态报告，未主动部署或自动合并。

## 下一步

等待 Lan 手动审查、合并 [PR #158](https://github.com/yecays-ai/veil/pull/158) 与验收；M5–M8 未授权。
