# STATUS — memory-m2-startup-resume

更新人：Claude (Claude Code, session https://claude.ai/code/session_018UGk5R7bjtTckrCwpfw7n4)
更新时间：2026-10-12T08:30:00Z
发现范围：`git fetch origin main` 得到 `198df8412e365e4a5797d1c22c0b71b2aa5cfa81`（含已合并的 #154），分支 base 同此。本次未再列开放 PR；未检查他人未发布的本地工作。

## 当前任务

M2 补充：启动时自动完成未完成的 Memory 清空意图（Lan 2026-10-12T07:13Z 批准；待审查，Lan 手动合并）。

## 谁在改哪里

Claude；分支 `claude/memory-m2-startup-resume`；PR 见 GitHub。
新增 `lib/memory/startup.ts`、`tests/memory-startup.test.ts`；改 `lib/memory/lifecycle.ts`（`completeClear` 增加可选 `cutoff`）、`lib/memory/browser.ts`（`resumeBrowserClears`）、`components/product-bootstrap.tsx`（唯一触发点：挂载时一次，卸载时 abort）。

## 已完成

- 只处理已存在且带 `clearRequestedAt` 的游标，不新建删除；可重复执行；每次页面加载一次，无轮询、无订阅。
- 意图落库时在游标记录 `clearMessageIds`（该会话来源所指向的消息 id；备份校验已接受该可选字段，须伴随 `clearRequestedAt`）。启动恢复据此区分：
  - 会话已不存在或无消息：清空已发生，按记录的消息 id 清理来源；
  - 会话有消息且记录的目标消息仍有存在：聊天清空失败，撤回意图、保留 Memory；
  - 会话有消息且目标消息都已不在：清空已发生、之后又有新消息，只清理目标来源，新来源保留；
  - 旧意图（无 `clearMessageIds`）且会话有消息：无法可靠区分，选择保全数据，撤回意图。不使用时间戳判断。
- 去掉 5 次失败后的永久停止：`failureCount`/`failureReason` 仅作诊断，每次启动都可重试。
- Foundation：只有“已保存的文档且解析成功、角色列表为空”才视为合法的空（最后一个 Character 被删），此时待处理清空对应的已消失 Character 的 Memory 被删除；读取失败、解析失败、文档从未保存（尚未初始化）一律视为未证明，什么都不删。`readAliveCharacters` 直接读原始文档以区分“未保存”与“已保存且为空”，因为 `FoundationStorage.load()` 对两者都返回空列表。
- 新增 `ChatStorage.existingMessageIds`（只读，按 id 点查）。
- 检查（Node v22.22.0）：见本单 PR 评论。证据等级：仅自动化测试。

## 尚未验证

- 真机/真实浏览器行为；Node 24 未运行。
- 残余风险：旧意图（无 `clearMessageIds`）在会话已有新消息时被撤回，旧来源的 memory 会保留；意图落库到聊天清空之间新增的来源不在目标集合内，若清空成功其来源会残留（偏保全）；目标消息个别在清空前已被单独删除时，只要仍有目标存在即视为清空失败；Foundation 文档从未保存时待处理清空会一直推迟；启动时会打开（必要时创建）空的 Memory 库。

## 下一步

Lan 审查并手动合并。`memory-m2-backup.md` 中“启动恢复未定”的开放项由本单取代。
