# Memory M4.1 正式检索评估

基线：main `9c93cf9d5302268659613444b64ccf67d50f28e7`（#157 已合并）；Node v24.19.0。这份报告是本地固定样例与 CPU 探针结果，不是真实聊天召回率或真机验收。

## 探索与正式评估分开

施工前探索探针是 25 正例、22 负例，候选组合得到原集 8/10、扩展集 17/25 命中、3/22 误召回，且曾出现上下文门槛退化；不是本次正式成绩，不能和下表直接相减。探索结果用于提出方案，未作为正式样例的标签。

正式输入和语义相关标签见 [固定数据](../tests/memory-retrieval-fixture.ts)：原有 10 项保持原文，另外 72 项在算法改动前写定，包含 40 项全新英文（20 正/20 负）。未参与探索性探针调节，施工中标签/输入未改；实现者可见，不是盲测或真实用户聊天。另加的边界/排序/竞态测试不计入效果分母。

对照选择器见 [冻结 M4](../tests/memory-m4-baseline.ts)，复制已合并实现，仅调整测试 import 路径。正例目标 id 被选中才算命中；负例任意 Memory 被选中就算误召回。多候选的其他 id 也在脚本输出中保留，不能靠只检查目标条目隐去误召回。

重跑：先 `node node_modules/typescript/bin/tsc --project tsconfig.tests.json --outDir .m41-tests`，再 `node scripts/evaluate-memory-retrieval.mjs .m41-tests`。标准测试编译目录下，脚本可不传目录参数。

## 分语言结果

| 语言 | 正例命中 M4 → M4.1 | 负例误召回 M4 → M4.1 | 改善 / 退化 / 不变 |
|---|---|---|---|
| 英文 | 12/25 → 19/25 | 10/20 → 0/20 | 17 / 0 / 28 |
| 中文 | 3/13 → 10/13 | 2/8 → 0/8 | 9 / 0 / 12 |
| 混合语言 | 3/8 → 6/8 | 2/8 → 0/8 | 5 / 0 / 11 |

原有 10 项：**5/10 → 8/10**。英文同义、中文离职表达、短中文兰花改善，其余 7 项不变（其中两项继续漏召回），没有基线命中退化。改善计数包括正例改善和负例正确拒绝；全部 82 项有 31 项改善、51 项不变、0 项退化。不能把固定集 0/36 误召回当作真实聊天精度保证。

## 剩余漏召回与回归说明

最终正式集英文、中文、混合语言均无退化项。施工中出现的英文代词漏召回与中文竞争对象误召回已经由通用代词/候选竞争判断修正，没有改相关性标签。宽泛同义合并没有实施。

| 持续漏召回 case | 原因 |
|---|---|
| o-en-indirect-no-anchor | her advice 没有近期对象锚点，不能猜为 grandmother taught。 |
| en-employment-negation | 裸 resigning 没有就业对象或近期就业锚点；保留拒绝，避免把棋局认输和离职混同。此处缺的是检索证据，没有改变“决定不辞职”的原记忆文字或否定含义。 |
| en-adoption-paraphrase-no-anchor | adopted 与 took in 不全局等同，无近期共同对象锚点。 |
| en-family-paraphrase-no-anchor | sister 与 sibling 不全局等同，避免把 sister/brother 合并。 |
| en-grandma-no-anchor | her guidance 无可靠对象锚点；advice/guidance 也不作为独立主题。 |
| en-rest-no-anchor | rest 与 sleep 仅在近期睡眠锚点下支持，无锚点不猜。 |
| o-zh-indirect、zh-no-anchor | “之前约好的事情”“那件事”孤立出现时，没有具体约定的近期锚点；有展览近期锚点的 zh-event-context 能命中。 |
| zh-creation-broad | 创作比写小说宽，不能用全局同义替换解决。 |
| mix-orchid-no-bridge、mix-cat-no-bridge | 英中没有共同词项、名字或已批准短语桥接；未增加翻译调用或通用双语字典。 |

还有未被本小集充分覆盖的风险：不规则词形、内部中文词边界、同名/别名、复杂协调句及多条同主题记忆。当前直接主题存在时拒绝仅间接相关的近期补充，有意优先降低误召回，可能漏掉有价值的补充。词面规则不是完整指代解析或语义理解。

## 预算与 CPU 时间

最多 5 条、序列化正文 2,000 个 UTF-16 字符不变（含 JSON 转义/字段/行间换行，现有 Preset 节标题不计入该正文护栏）。仍整条跳过超限记录，不新增模型/网络请求、写入或缓存。

| 候选数 | p50 ms：M4 → M4.1 | p95 ms：M4 → M4.1 | 条数 / 字符：前后 |
|---|---|---|---|
| 25 | 0.058 → 0.105 | 0.115 → 0.236 | 5/514 → 5/514 |
| 100 | 0.143 → 0.299 | 0.285 → 0.562 | 5/514 → 5/514 |
| 1000 | 1.111 → 2.792 | 1.502 → 3.692 | 5/514 → 5/514 |

CPU 探针以同一 40 条较早 History 和当前明确主题执行；预热 20 次，前后交替 101 次，采集时本任务没有并行编译/构建。每个候选数两版都是 5 条、514 字符。额外词项/锚点判断提高了 CPU 时间；这是桌面 Node 的合成选择器测量，不含 IndexedDB、网络、模型或 iPhone，不能声明首响应延迟无变化。

82 项正式样例的选中正文字符累计 3243 → 3074；选择集合变化造成这个差异，不是预算变更或真实 Token/费用证据。

## 每项前后对照

“命中”用于正例；“误召回”用于负例。Case id 可在固定数据中直接找到完整 Memory、当前问句、前两轮以及竞争候选。原集和新集列明，全部不变项也保留。

| Case | 语言 / 数据集 | 类型 | M4 | M4.1 | 变化 |
|---|---|---|---|---|---|
| o-en-literal | 英文 / 原集 | 正例 | 命中 | 命中 | 不变 |
| o-zh-literal | 中文 / 原集 | 正例 | 命中 | 命中 | 不变 |
| o-en-paraphrase | 英文 / 原集 | 正例 | 命中 | 命中 | 不变 |
| o-zh-paraphrase | 中文 / 原集 | 正例 | 命中 | 命中 | 不变 |
| o-en-synonym | 英文 / 原集 | 正例 | 漏召回 | 命中 | 改善 |
| o-zh-synonym | 中文 / 原集 | 正例 | 漏召回 | 命中 | 改善 |
| o-en-indirect-anchor | 英文 / 原集 | 正例 | 命中 | 命中 | 不变 |
| o-en-indirect-no-anchor | 英文 / 原集 | 正例 | 漏召回 | 漏召回 | 不变 |
| o-zh-indirect | 中文 / 原集 | 正例 | 漏召回 | 漏召回 | 不变 |
| o-zh-short | 中文 / 原集 | 正例 | 漏召回 | 命中 | 改善 |
| en-resign-form | 英文 / 新集 | 正例 | 漏召回 | 命中 | 改善 |
| en-paint-form | 英文 / 新集 | 正例 | 漏召回 | 命中 | 改善 |
| en-sleep-form | 英文 / 新集 | 正例 | 漏召回 | 命中 | 改善 |
| en-reverse-form | 英文 / 新集 | 正例 | 漏召回 | 命中 | 改善 |
| en-drop-e | 英文 / 新集 | 正例 | 命中 | 命中 | 不变 |
| en-job-paraphrase | 英文 / 新集 | 正例 | 漏召回 | 命中 | 改善 |
| en-employment-negation | 英文 / 新集 | 正例 | 漏召回 | 漏召回 | 不变 |
| en-rescue-bridge | 英文 / 新集 | 正例 | 命中 | 命中 | 不变 |
| en-rest-bridge | 英文 / 新集 | 正例 | 漏召回 | 命中 | 改善 |
| en-her-one-anchor | 英文 / 新集 | 正例 | 命中 | 命中 | 不变 |
| en-it-one-anchor | 英文 / 新集 | 正例 | 命中 | 命中 | 不变 |
| en-they-one-anchor | 英文 / 新集 | 正例 | 命中 | 命中 | 不变 |
| en-two-turn-anchor | 英文 / 新集 | 正例 | 命中 | 命中 | 不变 |
| en-new-topic-direct | 英文 / 新集 | 正例 | 命中 | 命中 | 不变 |
| en-adoption-paraphrase-no-anchor | 英文 / 新集 | 正例 | 漏召回 | 漏召回 | 不变 |
| en-family-paraphrase-no-anchor | 英文 / 新集 | 正例 | 漏召回 | 漏召回 | 不变 |
| en-grandma-no-anchor | 英文 / 新集 | 正例 | 漏召回 | 漏召回 | 不变 |
| en-rest-no-anchor | 英文 / 新集 | 正例 | 漏召回 | 漏召回 | 不变 |
| en-new-named-topic | 英文 / 新集 | 正例 | 命中 | 命中 | 不变 |
| en-acronym | 英文 / 新集 | 正例 | 命中 | 命中 | 不变 |
| en-adopt-policy | 英文 / 新集 | 负例 | 拒绝 | 拒绝 | 不变 |
| en-resign-chess | 英文 / 新集 | 负例 | 拒绝 | 拒绝 | 不变 |
| en-quit-habit | 英文 / 新集 | 负例 | 拒绝 | 拒绝 | 不变 |
| en-left-door | 英文 / 新集 | 负例 | 误召回 | 拒绝 | 改善 |
| en-rest-remainder | 英文 / 新集 | 负例 | 误召回 | 拒绝 | 改善 |
| en-rest-case | 英文 / 新集 | 负例 | 拒绝 | 拒绝 | 不变 |
| en-sibling-gender | 英文 / 新集 | 负例 | 拒绝 | 拒绝 | 不变 |
| en-universe-university | 英文 / 新集 | 负例 | 拒绝 | 拒绝 | 不变 |
| en-catering-cat | 英文 / 新集 | 负例 | 拒绝 | 拒绝 | 不变 |
| en-old-bakery | 英文 / 新集 | 负例 | 误召回 | 拒绝 | 改善 |
| en-common-feeling | 英文 / 新集 | 负例 | 误召回 | 拒绝 | 改善 |
| en-common-thing | 英文 / 新集 | 负例 | 误召回 | 拒绝 | 改善 |
| en-competing-her | 英文 / 新集 | 负例 | 误召回 | 拒绝 | 改善 |
| en-competing-it | 英文 / 新集 | 负例 | 误召回 | 拒绝 | 改善 |
| en-switch-with-pronoun | 英文 / 新集 | 负例 | 误召回 | 拒绝 | 改善 |
| en-switch-recent-turn | 英文 / 新集 | 负例 | 误召回 | 拒绝 | 改善 |
| en-expired-anchor | 英文 / 新集 | 负例 | 误召回 | 拒绝 | 改善 |
| en-took-in-scam | 英文 / 新集 | 负例 | 拒绝 | 拒绝 | 不变 |
| en-grown-sales | 英文 / 新集 | 负例 | 拒绝 | 拒绝 | 不变 |
| en-completely-unrelated | 英文 / 新集 | 负例 | 拒绝 | 拒绝 | 不变 |
| zh-orange-cat | 中文 / 新集 | 正例 | 漏召回 | 命中 | 改善 |
| zh-short-jasmine | 中文 / 新集 | 正例 | 漏召回 | 命中 | 改善 |
| zh-short-birthday | 中文 / 新集 | 正例 | 漏召回 | 命中 | 改善 |
| zh-job-paraphrase | 中文 / 新集 | 正例 | 漏召回 | 命中 | 改善 |
| zh-event-context | 中文 / 新集 | 正例 | 命中 | 命中 | 不变 |
| zh-pronoun-cat | 中文 / 新集 | 正例 | 漏召回 | 命中 | 改善 |
| zh-creation-broad | 中文 / 新集 | 正例 | 漏召回 | 漏召回 | 不变 |
| zh-no-anchor | 中文 / 新集 | 正例 | 漏召回 | 漏召回 | 不变 |
| zh-common-today | 中文 / 新集 | 负例 | 拒绝 | 拒绝 | 不变 |
| zh-common-things | 中文 / 新集 | 负例 | 拒绝 | 拒绝 | 不变 |
| zh-common-feel | 中文 / 新集 | 负例 | 误召回 | 拒绝 | 改善 |
| zh-common-seams | 中文 / 新集 | 负例 | 误召回 | 拒绝 | 改善 |
| zh-short-unrelated | 中文 / 新集 | 负例 | 拒绝 | 拒绝 | 不变 |
| zh-old-topic | 中文 / 新集 | 负例 | 拒绝 | 拒绝 | 不变 |
| zh-competing | 中文 / 新集 | 负例 | 拒绝 | 拒绝 | 不变 |
| zh-leave-object | 中文 / 新集 | 负例 | 拒绝 | 拒绝 | 不变 |
| mix-job-en-memory | 混合语言 / 新集 | 正例 | 漏召回 | 命中 | 改善 |
| mix-job-zh-memory | 混合语言 / 新集 | 正例 | 漏召回 | 命中 | 改善 |
| mix-name-en-memory | 混合语言 / 新集 | 正例 | 命中 | 命中 | 不变 |
| mix-name-zh-memory | 混合语言 / 新集 | 正例 | 命中 | 命中 | 不变 |
| mix-english-anchor | 混合语言 / 新集 | 正例 | 命中 | 命中 | 不变 |
| mix-chinese-anchor | 混合语言 / 新集 | 正例 | 漏召回 | 命中 | 改善 |
| mix-orchid-no-bridge | 混合语言 / 新集 | 正例 | 漏召回 | 漏召回 | 不变 |
| mix-cat-no-bridge | 混合语言 / 新集 | 正例 | 漏召回 | 漏召回 | 不变 |
| mix-unrelated-name | 混合语言 / 新集 | 负例 | 拒绝 | 拒绝 | 不变 |
| mix-old-name | 混合语言 / 新集 | 负例 | 误召回 | 拒绝 | 改善 |
| mix-job-false | 混合语言 / 新集 | 负例 | 拒绝 | 拒绝 | 不变 |
| mix-false-cat | 混合语言 / 新集 | 负例 | 拒绝 | 拒绝 | 不变 |
| mix-false-rest | 混合语言 / 新集 | 负例 | 拒绝 | 拒绝 | 不变 |
| mix-both-common | 混合语言 / 新集 | 负例 | 拒绝 | 拒绝 | 不变 |
| mix-competition | 混合语言 / 新集 | 负例 | 误召回 | 拒绝 | 改善 |
| mix-topic-switch | 混合语言 / 新集 | 负例 | 拒绝 | 拒绝 | 不变 |
