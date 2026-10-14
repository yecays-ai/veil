# Memory M6 P4：本地固定样本评估

总账 ID：新增 Memory M6 P4。基线及分支 base：`main 8a0f79044c6b291906a518bc07a5d717924a348a`。

- 这一刀只解决：把已有检索固定集和现有安全规则变成可重复、可比较、有逐项失败原因的本地评估入口。
- 验收话：一条命令运行定向测试并生成稳定 JSON；每项明确列出预期/实际 ID、正文字符数、失败原因；漏召回不能被“测试全绿”隐藏。
- 做完划掉：P4 评估入口与固定预期施工；不核销检索质量的既有缺口。
- 不做：修改检索算法、P1/P2 复审、P3 Ongoing 规则、P5 Inspector、真实模型/付费 API、真实数据、Production、自动合并。
- 停止条件：发现必须改变产品规则才能继续时交给 Lan；范围外问题只记录。

## 运行与比较

Node 24；安装仓库已有依赖后运行：

```sh
npm run test:memory
```

入口先以 `tsconfig.memory-evaluation.json` 编译当前源码，再运行 `memory-context`、`memory-retrieval-quality`、`memory-retrieval-safety`、`memory-retrieval-p4` 四份测试。编译/测试失败即非零退出；不会执行其他模块测试或残留的旧测试文件。生成完整报告：`node_modules/.cache/veil-memory-evaluation/report.json`。

只需要可比较 JSON 时（仍重新编译，并执行全部 100 项评估断言；不执行四份 Node 测试）：

```sh
node scripts/test-memory-retrieval.mjs --report-only > report.json
```

报告不含时间、机器路径、随机 ID、CPU 耗时；`baselineSha` 指固定预期来源，**不是运行时当前 head**。比较时另行记录 `git rev-parse HEAD`，不要把旧基线 SHA 当成当前被测提交。`version` 和 `fixtureSha256` 标识样本、已知漏召回及边界/来源夹具；同版本/同样本先比较逐项 `expectedIds`、`actualIds`、`characters`、`failures`，再比较汇总。源码和报告均不包含真实聊天数据。

任何 ID 集合/排序、序列化正文、预算、outcome、重复/逆序/循环移位结果或输入只读性偏离都报出 case id 和原因，并使评估失败。现有 `scripts/evaluate-memory-retrieval.mjs` 保留为历史 M4 对照和 CPU 探针；P4 不把不稳定时间数据放入固定报告，不重复建设质量数据。

## 固定范围与结果

复用 [M4.1 固定集与相关性标签](../tests/memory-retrieval-fixture.ts) 和[已批准的既有规则/局限](memory-m41-evaluation.md)。不改原 82 项输入或标签。新增[固定预期与边界](../tests/memory-retrieval-p4-fixture.ts)、[评估实现](../tests/memory-retrieval-p4-evaluation.ts)及[断言](../tests/memory-retrieval-p4.test.ts)。

| 范围 | 项数 | 预期一致结果 |
|---|---:|---:|
| 原有英文/中文/混合语言、直接匹配、词形/短语、近期锚点、竞争对象、旧主题/无关负例 | 82 | 82/82 |
| Character 隔离；flagged/archived/superseded 排除；Journal 独立通道；无关 manual 不填充；NFKC 去重；已在 Prompt 排除；5 条/排序/优先级；原文与 JSON 转义超长；2,000/2,001 字符边界；两条各 1,000 字符加换行超限 | 15 | 15/15 |
| fresh fake IndexedDB 中先存入、确认能检索、执行既有 `completeClear`、再读回检索：自动记忆唯一来源撤销、剩余来源保留、manual 撤销来源后保留 | 3 | 3/3 |

评估预期一致 **100/100，失败 0**。语义质量为**正例 35/46 命中、11 项漏召回；负例 0/36 误召回**，和既有文档一致。已有 11 项漏召回的 ID/原因固定列在夹具与每次报告中；其 baseline 预期为 `[]`，不把它们计为语义命中。完整 `actualIds` 断言也阻止多候选时偷偷注入非预期竞争项。未来算法有意改善漏召回也会产生 baseline 差异，须审查变化后显式调整预期；不能从当次实际输出自动刷新答案。

本地 Node v24.19.0：定向测试 **167/167，零跳过**（含 P4 103 个 Node test/subtest；评估样本与 Node 测试数分开）；`tsc --noEmit`、改动文件 ESLint 通过。三项隔离编译产物负对照分别移除 Character guard、active guard、行间换行预算，评估均退出 1；还原后编译产物 SHA-256 一致，正常评估通过。两次独立编译/报告输出文件 SHA-256 同为 `a1ed2435ebee155f238932b6fe74f88b93701ba3e8af19a13ed92053a02604b1`。固定夹具 SHA-256：`c96fa5377d29cea72bdb3cde84f56ec7885ee098595d7a8eb6c1e7f69d1ddf4e`。

## 已知局限与证据层级

- `selectMemoryContext` 不检查来源消息是否实时存在；来源有效性依赖既有清理/维护流程。这里覆盖的是来源撤销**完成后**的存储 → 检索行为，不证明任意原始失效行会被选择器自行排除，不扩建来源服务。
- 失效行指既有 non-active 状态与来源清理删除的行；P3 的日期复查/结束/延期不在此基线上，不猜测尚未合并的新规则。
- 5 条/2,000 个 UTF-16 序列化正文字符是临时护栏，含 JSON 转义和条目间换行，不含 Preset 节标题；不是精确 Token/费用预算。
- 固定合成集不是盲测、真实聊天分布或模型采用率。无模型、网络、浏览器或真实数据访问；fake IndexedDB/Node 自动化不替代 iPhone/Safari、多真实 tab 验收。未跑全套测试或 build，生产代码未变。
- CI/CodeRabbit 是针对发布 head 的外部状态，见 PR；本地通过不等于外部检查通过，等待 Lan 手动合并。
