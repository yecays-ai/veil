# STATUS — 2026-10-10-claude-dry01-dead-code

更新人：Claude
更新时间：2026-10-10T12:04:00Z
发现范围：观察时间 2026-10-10T11:25Z；基于 origin/main `16fdafc`（#104 已合并，现场核实）；开放 PR：#105（CI 触发成本，仅改 `.github/workflows/ci.yml` 与文档，不与本任务改同一文件，但两者都在 `docs/AUDIT_LEDGER.md` 不同位置新增条目）；其他分支上的任务记录未逐一检查。依据：Lan 批准的“PR-A”（对话中交付），审计为 DRY-01（Opus 5.5，报告未入库）。

总账 ID：新增（板块六 “DRY-01 全仓重复实现与废弃代码审计”；关联 C1 的休眠接口决定、M3（#25）、S11 无关）。
这一刀只解决：DRY-01 的 A01–A06（确认可删除的死代码、只保护死代码的测试、无人引用的 CSS 类、3 条 lint 警告）。
做完划掉：[x] A01 `config/character.ts`；[x] A02 天气预留 adapter 与 `WeatherRequest.timezone`；[x] A03 时区下拉残留函数、测试与样式；[x] A04 Custom CSS 旧包装函数，测试改走生产路径；[x] A05 16 个无引用 CSS 类；[x] A06 lint 警告 6→3；[x] README 与总账同步；[x] 合并（Lan 手动；合并时 PR 上带一个 CF-02 偶发失败的叉，同提交重跑成功，见总账 CF-02）。
验收话：删除的名字在 `docs` 之外不再被引用；`npm run typecheck`、`npm run lint`、`npm test`、`npm run build` 通过；被删测试只保护死代码，被改测试仍覆盖生产路径；行为不变。
不做：B、C、D 类；任何存储或生成路径的改动；不顺手重构邻近代码；不追加新的仓库审计；不碰 #36、ChatRoom、在线系统。
停止条件：本 PR 经 Lan 手动合并，或 Lan 要求关闭；PR-B 在本 PR 收尾后另行安排。

## 当前任务

已合并（#106）：DRY-01 PR-A 死代码清理。

## 谁在改哪里

Claude；分支 `claude/dry01-dead-code`；PR：[#106](https://github.com/yecays-ai/veil/pull/106)。涉及：`config/character.ts`（删除）、`lib/participant-config.ts`、`lib/weather.ts`、`lib/chat/custom-css.ts`、`components/chat/use-chat-background.ts`（仅删两行 eslint-disable）、`app/appearance.css`、`app/desktop.css`、`app/foundation.css`、`app/globals.css`、`app/messages/chat.css`、`README.md`、`tests/chat-custom-css.test.ts`、`tests/custom-css-isolation.test.ts`、`tests/desktop.test.ts`、`tests/network-timeouts.test.ts`、`tests/widget-weather.test.ts`、`tests/chat-initial-render.test.ts`、`docs/AUDIT_LEDGER.md`、本文件。

## 已完成

- 基线（改动前，Node 24.21.0 / npm 10.9.4，main `16fdafc`）：`npm test` 801/801；lint 0 error / 6 warning。
- 删除测试（共 2 条，均在 `tests/desktop.test.ts`）：“timezone options include supported, saved, device and UTC values”只测已删除的 `getTimezoneOptions`；“supported browser timezone data includes a comprehensive IANA list”只测已删除的 `getSupportedTimezones`。生产里的 UTC 偏移选择器（`lib/timezone-label`）与 IANA/DST 本地时间测试（“IANA local times account for DST…”）保留，README 对应说法仍成立。
- 改写测试：`chat-custom-css` 的两条测试与 `custom-css-isolation` 的空输入断言改为调用生产路径 `analyzeSessionCSS(...)`；旧 `removeCssImports` 的断言被 `analyzeSessionCSS` 的 `@import` 被拒绝（错误提示加结果不含该规则）取代；`custom-css-isolation` 中一条 `removeCssImports` 断言与其上方的 `@import` 循环（大小写、转义）重复，已删除。`network-timeouts` 与 `widget-weather` 里 5 处 `timezone: "UTC"` 随 `WeatherRequest.timezone` 一并删除。
- 实际运行结果（Node 24.21.0）：typecheck 通过；lint 0 error / **3** warning（以实际运行为准：剩 ChatRoom 两条 hook 依赖警告与 `use-chat-background` 的 ref 警告）；`npm test` **799/799**（比基线少的 2 条就是上面删除的测试）；`npm run build` 通过（退出码 0）。
- grep 证明：`docs` 之外不再引用 `characterConfig` / `config/character` / `openMeteoWeatherProvider` / `WeatherProvider` / `getSupportedTimezones` / `getTimezoneOptions` / `removeCssImports` / `scopeSessionCSS`，也没有被删 CSS 类的引用。
- 与审计的差异：A06 提到的 `tests/core-document-storage.test.ts` 里 `IDBDatabase` 实际在使用，未改。证据级别：自动化测试（本地）、grep、源码阅读；无真机。

## 尚未验证

- 页面渲染：删除的是页面代码已无引用的 CSS 类，没有做逐页视觉对比，也没有真机验证。
- 用户自定义 CSS 若指向这些旧类名本来就不生效，删除不影响（审计结论，未单独验证）。
- `place-lookup.ts` 解析的 `timezone` 字段是否还有消费者：未核查，未改。
- 远端 CI：本 PR 的 `verify` 结果待核对；CodeRabbit 审查待核对。

## 下一步

开 PR 后等待 CodeRabbit 与 CI，由 Lan 手动合并；不自动合并。PR-B（B01+B02，先补字段保留测试）在本 PR 收尾后另行安排。
