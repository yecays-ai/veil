# STATUS — 2026-10-13-claude-memory-t1

更新人：Claude
更新时间：2026-10-13T13:40:00Z
发现范围：base origin/main 4d53d637b292cfc3c4799de7a09d5f21070493bc；仅本任务相关路径（lib/memory、components/memory-bank.tsx）；未逐一检查其他开放 PR。

## 当前任务

Memory 重做工单 1：第一人称、克制的记忆内容（进行中，待开 PR）。

## 谁在改哪里

Claude；分支 `claude/memory-t1-first-person`；PR 尚未创建。涉及 `lib/memory/{types,progress,bank,maintenance-input,maintenance-operations,maintenance-runner,maintenance-browser}.ts`、`components/memory-bank.tsx`、`tests/memory-t1-content.test.ts`、`tests/memory-maintenance-source.test.ts`。

## 已完成

- 单条记忆上限 600 字符（自动与手动）；超长的自动条目单独丢弃，不再让整批失败重试。
- 维护 prompt 改为第一人称、允许零产出、不复制联系人/昵称/资料、Relationship 用 UPDATE 保留转折。
- 维护输入的每条消息带用户时区的时间。
- 验证（自动化测试，非真机）：`npx tsc --project tsconfig.tests.json` 通过；`tests/memory-t1-content.test.ts` 6/6；`memory-maintenance-source` 9/9；`npm run test:memory` 167 通过 0 失败；eslint 干净。

## 尚未验证

- 真实模型下的输出质量（“改备注”样例只用桩模型验证；真实模型评测需 lan 另行批准）。
- 真机行为。
- 注入格式未改（召回时间字段留给工单 3）；已有的重复记忆不自动清理。

## 下一步

开 PR，等 CI 绿后合并，然后开始工单 2。
