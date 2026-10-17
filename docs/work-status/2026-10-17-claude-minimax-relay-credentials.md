# STATUS — 2026-10-17-claude-minimax-relay-credentials

更新人：Claude
更新时间：2026-10-17T17:30:00Z
发现范围：基于 origin/main 4769627；改动只在 lib/tts/speech.ts 与 tests/tts-providers.test.ts。

## 当前任务

relay 请求带上同源 cookie（待审查）。

## 谁在改哪里

Claude；分支 `fix/minimax-relay-credentials`；PR 见 PR 页面。

## 已完成

- MiniMax 的 relay 请求改为 `credentials: "same-origin"`（其余 provider 仍为 omit）。推断原因：受保护的 Vercel 预览对不带 cookie 的请求会跳转到站外登录，浏览器报 fetch 失败（「could not be reached (VEIL server)」）。
- 测试断言 relay 请求带 same-origin；typecheck、tts-providers 测试通过。

## 尚未验证

- 真机/预览上的实际效果；上述原因是推断，沙箱无法访问预览域名。

## 下一步

lan 在测试链接重试 Preview；若仍失败，把新的错误文字发回。
