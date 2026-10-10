# STATUS — 2026-10-10-claude-p6-browser-sync-smoke

更新人：Claude
更新时间：2026-10-10T08:25:00Z
发现范围：观察时间 2026-10-10T11:50Z；基于 origin/main `651769ca9f6c306f13a5be0b6bec624576fcc8ac`（#96 已合并）；GitHub open PR 列表（含 draft）为空，无重叠；其他分支上的任务记录未逐一检查。需求来自 Codex 的 C2 只读核查与 GPT 的意见（对话中交付，未入库），新增开发依赖已获 Lan 同意。

## 当前任务

待审查：第六刀 C2 后续——本地专用的 Chromium 双标签同步冒烟测试（总账板块六“BroadcastChannel 同步 mock”）。

## 谁在改哪里

Claude；分支 `claude/p6-browser-sync-smoke`；PR：[#97](https://github.com/yecays-ai/veil/pull/97)。涉及：新增 `playwright.config.ts`、`e2e/cross-tab-sync.spec.ts`；`package.json`/`package-lock.json`（开发依赖 `@playwright/test` 精确锁定 1.56.1，新脚本 `test:browser`）；`.gitignore`（测试输出）；`README.md`（运行说明）；`docs/AUDIT_LEDGER.md` 板块六。不改业务代码，不接 CI，`npm test` 不变。

## 已完成

- 两条测试（同一 BrowserContext 的两个真实页面，不手动派发事件，不替换 BroadcastChannel/IndexedDB，不调用模型）：Chat 一页发送、另一页自动出现且只出现一次，并核对 `veil-chat-v2` 的 messages；Foundation 一页给 Character 改名、另一页列表自动更新，并核对 `veil-core-v1` 的 documents。每个测试用全新 context，不碰真实数据。
- 负对照：临时把 `lib/chat/storage.ts` 与 `lib/foundation-storage.ts` 的 postMessage 关掉并重新构建，两条测试均失败（消息不出现、改名不出现）；恢复后 2/2 通过。关掉前先发现 `reuseExistingServer` 会复用旧构建而假通过，已杀掉旧进程后重做；CodeRabbit 同样指出这一点，已把 `reuseExistingServer` 改为 false（端口被占用时直接失败，不再复用旧服务器）。
- 检查（Node 24.21.0，本地）：`npm run test:browser` 2/2（Chromium 1194，本机预装）；`npm test` 797/797；`npm run typecheck` 通过；`npx eslint app components lib tests scripts e2e playwright.config.ts` 0 error（6 条既有 warning）；`next build` 在 Playwright 的 webServer 中成功。证据级别：自动化浏览器测试（本地）。

## 尚未验证

- 仅 Chromium、仅本地；Firefox/WebKit/iPhone、后台恢复、真双窗口生成竞争未覆盖。CI 不运行这些测试，也没有核实 CI 上安装浏览器的额度与耗时。
- 未覆盖 Settings 等其他域（没有统一跨标签订阅）。
- GitHub Actions `verify` 与 Vercel 预览：`verify` 已失败（几秒内、没有步骤、没分配到 runner、日志取不到），按“未运行”处理，不算通过；注意本 PR 的新依赖会让 CI 的 `npm ci` 安装 Playwright 包（不下载浏览器），这一点在 CI 恢复可用前无法验证。

## 交接（2026-10-10，Claude 额度用完前写下）

- 本 PR 状态：最新提交 `f129423`；CodeRabbit 第一轮的 1 条意见（`reuseExistingServer`）已改并解决，对 `f129423` 的结论还没收到；Vercel 部署成功；`verify` 已失败（几秒内、没分配到 runner、日志取不到），按“未运行”处理。接手人看到 CodeRabbit 结论后，按 AGENTS 的规则读审查正文与评论串再决定；合并由 Lan 手动。
- 已决定、尚未施工（顺序）：① 本 PR 合并后，修复入库变异脚本 `scripts/check-lifecycle-test-mutations.mjs`：第一个检查（迟到背景）匹配的源码文字 `if (!active || !blob)` 已不存在（现为 `components/chat/use-chat-background.ts` 的 `if (!active) return;`），脚本在 main 上直接失败；该脚本没有接入 `package.json`、CI 或文档，所以悄悄失效。已在本地验证把匹配文字改成当前写法后三个检查都能检出保护被删（未提交）。建议同时接成 `npm run test:mutations`。② 清理类测试补强两张：聊天背景设置的已创建 URL 释放与退订后通知断言（`tests/chat-background-settings-ui.test.ts`，当前把 `URL.revokeObjectURL` 换成了空函数）；Foundation 卸载后 focus/visibilitychange 监听器移除、频道关闭后投递与重订阅断言（`tests/foundation-cross-tab.test.ts`）。天气计时器只登记，不绑进这两张。③ chat-room 拆分（已于 2026-10-10 改口径，以总账停车场为准）：只拆 Chat Header，行为与布局不变，验收后再做在线状态/个性签名；Reaction 时再评估消息区；不做整体拆分。（原记录写的是“先评估整个 chat-room 再分小 PR”，已作废。）
- 仍待办但未排期：假绿测试专项核查、源码字符串测试清点、故障注入覆盖清单（等额度后交给只读模型做）；总账停车场的“下一轮候选”清单。
- 这些在总账里尚未全部落字（变异脚本失效、清理类测试结论）；做相应 PR 时一并写入板块六。

## 下一步

等待 CodeRabbit 针对最新提交完成审查，并确认无未解决评论、CI 为绿且预览对应最新提交后，由 Lan 手动合并；若 CI 或预览未运行，按人工例外记录并由 Lan 决定是否合并；不自动合并，不加 automerge 标签。
