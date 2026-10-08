# STATUS — 2026-10-08-claude-network-timeouts-cancel

更新人：Claude
更新时间：2026-10-08T17:00:00+00:00
发现范围：2026-10-08 经 GitHub 集成列出 open PR：仅 #36（冻结，Chat 首帧，不触及本任务文件）。基准 main `0c00851`。

## 当前任务

第二板块 B1/B2 最小生命周期修复（网络超时与取消）。待审查。

## 谁在改哪里

Claude；分支 `claude/network-timeouts-cancel`；PR https://github.com/yecays-ai/veil/pull/54。
涉及：`lib/request-timeout.ts`（新）、`lib/chat/provider.ts`、`lib/weather.ts`、`lib/place-lookup.ts`、`lib/here-there-comment.ts`、`components/widgets/here-there-widget.tsx`、`tests/network-timeouts.test.ts`（新）。

## 已完成

- 用户指定的数值：模型连接 30 秒、流中空闲 45 秒；天气/地点请求 12 秒。本任务没有自行设定其他数字。
- 模型请求：`createOpenAITextProvider({ connectMs, idleMs })`（默认 30000/45000，`openAITextProvider` 即默认实例）。连接超时后取消请求并报“API 未及时响应”；流中每次 `read()` 与非流式 `json()` 受空闲超时约束，超时取消流并报“回复停止到达”。用户 Stop 仍立即取消（转发到内部 controller）；超时按失败处理，引擎照常释放生成锁，可重新生成。
- 天气/地点：`withRequestTimeout`（`lib/request-timeout.ts`）给请求加期限；超时返回现有的错误状态，共享的 in-flight 条目随之清除，之后（短时错误缓存过期后）可重新发起；迟到的结果被丢弃。命名地点的“地点查询 + 天气请求”共用一个 12 秒期限。聊天引擎无需改动：天气失败即 error 状态，上下文被跳过，回复继续。保留缓存、最后有效读数与界面。
- Here & There：`HereThereGenerationOwner` 增加 `signal`，失效（卸载、换角色、关闭开关）时中止；`ensureHereThereComment` 把该 signal 接到模型请求。失败、取消、超时、结果被丢弃都走现有 5 分钟短重试交还评论机会；成功提交后仍按 1–5 小时调度。同次挂载内重试靠 `nextCommentAt` 变化产生的新机会键恢复。
- 测试 `tests/network-timeouts.test.ts`（14 项）：天气/地点超时与恢复、忽略 signal 的请求、命名地点单一期限、加入共享请求的调用方按自己的期限放行且不取消共享请求、模型连接超时释放锁并可重新生成、流中空闲超时取消流并可重新生成、正常慢速流不受影响、Stop 仍立即取消且之后的超时无影响、天气永不应答时聊天继续回复且无天气上下文、Here & There 失效取消并交还机会、失败/超时保留机会、丢弃迟到结果、成功不动调度。旧实现上相关用例会挂起。
- Node 24：`npm test` 658/658、`npx tsc --noEmit`、`npx eslint .`、`npm run build`、`git diff --check` 通过。

## 尚未验证

- 真实浏览器/真机未测；超时均以受控 Promise/stream 验证。
- 首页天气小组件在超时后的重试节奏沿用现有退避逻辑，未改动，也未新增专门的挂载测试。
- Here & There 小组件的挂载级流程（卸载时取消）通过 owner 与 `ensureHereThereComment` 单元级验证，没有新增挂载测试。
- 模型空闲超时对 `response.json()`（非流式）的整体读取使用同一个空闲期限，未单独设限。

## 下一步

等待 CodeRabbit 与 CI，由用户本人手动合并（不加 automerge）。
