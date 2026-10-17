# STATUS — 2026-10-17-claude-api-error-code

更新人：Claude
更新时间：2026-10-17T19:05:00Z
发现范围：2026-10-17T18:55:00Z 基于 origin/main 0fa0cf3；开放 PR #251 只动 lib/tts/voice-cache.ts，与本任务不重叠；本任务动 lib/chat/provider.ts、tests/completion-terminal.test.ts 和本记录。

## 当前任务

Text API 返回 HTTP 错误时，错误信息里带上提供方给的短错误码（如 content_filter），用来区分 Peter 的 403 原因（待审查，不自动合并）。

## 谁在改哪里

Claude；分支 `fix/api-error-code`；PR 见 PR 描述（创建后补链接）。

## 已完成

- 失败时只读响应体前 4096 字符，取 `error.code` 或 `error.type`，且必须是 40 字符内的字母数字 `_ . -`，否则不显示；`message` 等自由文本从不读出（可能回显 Key 或提示词）。读取有 3 秒上限。
- 检查（代码版本为本分支首个提交）：`completion-terminal` 11、`text-api` 5、`chat-image-input` 13 项通过（新增 1 项）；`npm run typecheck` 通过；`npm run lint` 0 错误（3 个已有警告）；未运行 build 与全量 `npm test`。

## 尚未验证

- 真实 Text API 的 403 会不会带 code/type；很多网关 403 没有响应体，那就仍显示 HTTP 403。

## 下一步

lan 在测试链接重现 Peter 的 403，看错误里有没有新增的错误码。
