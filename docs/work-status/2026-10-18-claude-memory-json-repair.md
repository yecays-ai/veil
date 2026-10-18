# STATUS — 2026-10-18-claude-memory-json-repair

更新人：Claude
更新时间：2026-10-18T07:30:00Z
发现范围：origin/main 884f595（2026-10-18）；通过 GitHub API 查看远程 open PR，开始时无重叠的 Memory 维护任务；未读取真机数据库。

## 当前任务

待审查：Peter 的 Failed 5（单个 JSON 对象、无代码块、finish stop，但判为 not valid JSON）的诊断加无损容错（lan 2026-10-18 在决策卡选择"诊断加容错"）。

## 谁在改哪里

Claude；分支 `claude/project-thread-18lv2g`；PR 见创建后的链接。
涉及：`lib/memory/maintenance-operations.ts`、`lib/memory/maintenance-diagnostics.ts`、`tests/memory-maintenance-results.test.ts`。无持久化结构变更。

## 已完成

- 诊断：失败形状新增解析器错误类别（枚举，不含报错文本）、字符串内原始控制字符数、结尾多余逗号数、疑似未转义引号数。只有数字和枚举。
- 容错：严格解析失败、且恰有一个完整对象时，仅做两种有唯一读法的无损修复——字符串内的原始换行/制表等控制字符转为转义，`}`/`]` 前的多余逗号删除；之后仍走原有严格校验。未转义的内部引号有歧义，只计数、不修复。
- 自动化测试（假模型、fake IndexedDB，无真实模型调用）：计数与修复、含换行文本被原样写入且只发 1 次请求、修复后仍需通过完整校验、引号问题仍判 json 失败并记录类型且不含文本。memory/backup 相关回归 851 项通过；eslint 通过；tsc 仅有已有的 `emoji-picker-react` 缺失报错。

## 尚未验证

- 真机：Peter 的 5 个失败是否由这两类语法问题造成，未知（没有原文，也没有错误位置）；若是未转义的内部引号，本次修复不会解决，新诊断会在下一次失败时显示。
- 已用完 2 次请求的 5 个失败范围不会自动再处理；是否额外补跑它们（每个约 5k tokens）需要 lan 决定。

## 下一步

lan 真机观察新失败行里的 parser/控制字符/多余逗号/疑似引号计数，再决定是否处理内部引号或补跑旧范围。
