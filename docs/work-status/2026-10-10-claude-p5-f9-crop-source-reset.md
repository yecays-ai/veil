# STATUS — 2026-10-10-claude-p5-f9-crop-source-reset

更新人：Claude
更新时间：2026-10-09T20:35:00Z
发现范围：fetch 后 `origin/main` = `270f726f141c13f41919ddcfdfc3c67d7260a06f`，本分支基于该提交。GitHub 查询 open PR 列表（含 draft）为空，无并行任务重叠；#84 已合并。

## 当前任务

Part 5 F9（《6刀.docx》；与《前端》F9 无关）：ImageCropDialog 在保持挂载时更换 `source`，残留旧图的加载状态、尺寸、缩放和位置。状态：待审查。

## 谁在改哪里

Claude；分支 `claude/p5-f9-crop-source-reset`；PR：[#86](https://github.com/yecays-ai/veil/pull/86)。base revision `270f726f141c13f41919ddcfdfc3c67d7260a06f`。涉及：`components/image-crop-dialog.tsx`、`tests/image-crop-dialog-source.test.ts`、`docs/AUDIT_LEDGER.md`（仅 F9 行）、本文件。

## 已完成

- 当前 main 复现（Node 24，jsdom，fake-indexeddb；命令 `npx tsc --project tsconfig.tests.json` 后 `node --test node_modules/.cache/veil-desktop-tests/tests/image-crop-dialog-source.test.js`；未改生产代码，基于 270f726）：5 条（当时）中 4 条失败——换 source 后 Save/Use original 仍可用、缩放残留、B 加载失败后仍可用、A 迟到的 load 事件。
- 最小修复：`ImageCropDialog` 改为以 `key={source}` 渲染内部组件，source 变化时 state、拖动 ref、`<img>` 及其事件整体丢弃；`onError` 同时 `setLoaded(false)`。调用方与存量数据不变。
- 修复后（同一命令）6 条挂载级测试全部通过（含 source 不变时缩放/拖动/原图不回归）；`npm test` 772 中 771 通过，唯一失败为已知偶发 CF-02，单独重跑 11/11；`npm run lint` 0 error；`npm run build` 成功。
- 证据级别：自动化测试（JSDOM）；未做真机验证。
- 与工单差异：五个调用方都用 `{crop && <ImageCropDialog .../>}` 且为模态框，正常 UI 无法在挂载中换 source，所以 F9 是组件契约缺陷，现有 UI 路径未必触发。

## 尚未验证

- GitHub Actions `verify`（head 2bab5fb）：未运行成功——2 秒内失败，job 无 step、日志 404，原因未知（疑似额度/计费，未确认）；不得当作通过。
- Vercel 预览：未运行——部署因免费额度限制失败（`api-deployments-free-per-day`）。
- 替代检查：上列本地命令（Node 24）。
- 真机未验证。

## 下一步

等待 CodeRabbit 审查最新提交，由 Lan 手动合并；不自动合并。
