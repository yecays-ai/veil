# STATUS — 2026-10-10-claude-dry01-b01-b02-settings-record

更新人：Claude
更新时间：2026-10-10T11:55:00Z
发现范围：观察时间 2026-10-10T11:45Z；基于 origin/main `df4d9f9`（#105 已合并，现场核实）；开放 PR：#106（DRY-01 PR-A，改 README/CSS/天气/Custom CSS 等死代码，不涉及 `lib/chat/storage.ts` 与 `here-there-comment.ts`，不改同一文件）；其他分支上的任务记录未逐一检查。依据：Lan 批准的 PR-B（对话中交付），审计为 DRY-01（报告未入库）。

总账 ID：新增（板块六 “DRY-01 PR-B”，对应审计 B01、B02）。
这一刀只解决：B01 评论间隔常量有两份且测试断言的不是生产用的那份；B02 全局资料设置记录在多处各自拼装。
做完划掉：[x] 先补 12 条特征测试并在未改动的代码上通过；[x] B02 统一由 `globalProfileRecord` 构造记录；[x] B01 常量只留 `chat/storage.ts` 一份并导出，测试改引用；[x] 反向验证；[x] typecheck/lint/测试/build；[ ] 合并（Lan 决定）。
验收话：每个写入点存下的记录与重构前逐字段相同（只有 `id`、`bubbleTiming`、`hereThereEnabled`、`nextCommentAt` 四个字段，未改动的字段原样带过，非法值被规范化，不该写时不写）；现有测试全过；常量只有一个定义。
不做：不改存储结构、数据库版本、字段名或读写时序；不改 Here & There 的调度逻辑与生成路径；不动 B03、B04、C01–C03 与 D 类；不碰 #36、ChatRoom、在线系统；不追加新的仓库审计。
停止条件：本 PR 经 Lan 手动合并，或 Lan 要求关闭。

## 当前任务

待审查：DRY-01 PR-B，B01+B02。

## 谁在改哪里

Claude；分支 `claude/dry01-b01-b02-settings-records`；PR：创建后补链接。涉及：`lib/chat/storage.ts`、`lib/here-there-comment.ts`（仅删两行常量）、`tests/here-there-comment.test.ts`（仅改导入）、`tests/global-profile-record.test.ts`（新增）、`docs/AUDIT_LEDGER.md`、本文件。

## 已完成

- 基线（改动前，Node 24.21.0 / npm 10.9.4，main `df4d9f9`）：`npm test` 801/801（含已合并内容；PR-A #106 尚未合并）。
- 先补测试：`tests/global-profile-record.test.ts` 12 条，直接用 fake IndexedDB 读存下来的原始记录（而不是经读取函数规范化后的结果）：每个写入点逐一覆盖——已有记录、记录缺失、非法的已存值（排期为字符串或 NaN、`bubbleTiming` 为垃圾值）、不该写的情形（未到期、已关闭、无排期时 claim 不写；排期合法时 ensure 不写；过期期望时 reschedule 不写）。**在未改动的代码上 12/12 通过**，作为写入格式的基准。
- 重构：新增私有 `finiteOrNull` 与 `globalProfileRecord(current, change)`；读取与 5 个写入点都改用它；`claim` 与 `ensure` 里的合法性判断改用 `finiteOrNull`。B01：常量只在 `chat/storage.ts` 定义并导出，`here-there-comment.ts` 的两份删除（它们在生产里没有使用，只被测试引用），`here-there-comment.test.ts` 改为从 `chat/storage` 导入，断言的是生产用的值。
- 重构后 12/12 通过。反向验证（逐个改坏 `globalProfileRecord`/`finiteOrNull`/claim 守卫，测试均失败，恢复后通过）：OFF 开关恒为开（1 条失败）、`bubbleTiming` 不规范化（3 条）、已存排期被丢掉（1 条）、非法排期被照抄（2 条）、claim 不看 OFF（1 条）。
- 检查（Node 24.21.0 / npm 10.9.4）：typecheck 通过；lint 0 error / 6 warning（与基线相同，PR-A 的清理未合并）；`npm test` **813/813**（801 加 12 条新测试）；`npm run build` 通过（退出码 0）。证据级别：自动化测试（fake IndexedDB）与源码阅读；无真机。
- 观察（只记录，未改）：所有写入点都只写 4 个已知字段，已存记录里若有其他字段会在下一次写入时被丢掉。这是原有行为，没有改变，也没有被固定为期望行为；将来给记录加字段，只需改 `globalProfileRecord` 一处。

## 尚未验证

- 真机（iPhone）：没有验证 Here & There 排期、气泡间隔设置在手机上的实际表现。
- 跨标签并发：写入点的事务边界与广播域（`global-profile`）没有改动，也没有新增并发测试。
- 远端 CI 与 CodeRabbit 结果待核对；CF-02 偶发失败如在 CI 再出现，按总账“已知偶发失败”处理。

## 下一步

开 PR 后等待 CodeRabbit 与 CI，由 Lan 手动合并；不自动合并。合并后在线系统另行开始。
