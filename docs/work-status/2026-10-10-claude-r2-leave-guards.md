# STATUS — 2026-10-10-claude-r2-leave-guards

更新人：Claude
更新时间：2026-10-10T05:00:00Z
发现范围：观察时间 2026-10-10T04:30Z；基于 origin/main `711ae2da25c1d5db112498b843cd04bfa517094e`（#89 已合并）；远程 open PR 列表（含 draft）为空，无重叠；R2 原始审计只摘录到标题与严重程度，页面清单来自上一轮只读核查（对话中交付，未入库）。

## 当前任务

Part 5 R2（《6刀.docx》，Medium）按 Lan 选定的方案 3 施工：有实际未保存修改时，用户主动离开编辑器需要确认；没有修改时直接离开；确认后丢弃草稿并按原路径离开，取消则留在原页保留草稿。同时修新建 Prompt 空白返回也弹确认。状态：待审查。

## 谁在改哪里

Claude；分支 `claude/r2-leave-guards`；PR：[#90](https://github.com/yecays-ai/veil/pull/90)。涉及：新增 `components/leave-guard.ts`（确认文案与两个小函数）；`components/page-shell.tsx`（新增可选 `guardLeave`，拦截页内链接点击与 `onBack` 按钮）；`components/settings/worldbooks/worldbook-detail.tsx`、`worldbook-entry-editor.tsx`；`components/settings/regex/regex-detail.tsx`、`regex-rule-editor.tsx`、`regex-new.tsx`；`components/profile-form.tsx`、`profile-pages.tsx`；`components/contact-info.tsx`；`components/appearance.tsx`；`components/chat/custom-css-settings.tsx`；`components/settings/presets/prompt-editor.tsx`；`tests/leave-guards-ui.test.ts`（新）。base revision `711ae2da25c1d5db112498b843cd04bfa517094e`。

## 已完成

- 各页面的 dirty 基准与离开入口（均沿用原有离开行为，只在有改动时先 `window.confirm("Discard unsaved changes?")`）：
  - WorldBook 详情、Regex 详情：草稿 vs 最近保存值；入口＝页头返回链接及页内链接（PageShell `guardLeave`）。
  - WorldBook 条目：已有条目对比最新保存值，新建条目对比进入时的空白条目；入口同上。
  - Regex 规则：草稿 vs 保存值（沿用原有 `dirty`）；入口同上。
  - 新建 Regex 组：整组草稿 vs 进入时快照，入口为 “Cancel new Regex Group”；规则子视图单独对比该规则进入时的值，入口为其 Back 按钮（`onBack`）。
  - 用户资料、角色资料、新建角色：`ProfileForm` 以进入时值为基准（`""` 与 `null` 视为相同，写了又删回原值为 clean），保存成功后基准更新；入口为 Cancel 按钮和页头 Back（链接或 `onBack`）。
  - 联系人资料编辑：remark 与 hero 背景 vs 进入编辑时的基准；入口为 Cancel 按钮、页头返回及页内链接。
  - Appearance 的 CSS 变量：文本框内容 vs 已应用值；入口为页头返回；Apply 成功后清空草稿。
  - 聊天内 Custom CSS：草稿 vs 会话已保存的 CSS；入口为 Back 按钮；Apply/Clear 成功后直接关闭，不再询问。
  - 新建 Preset Prompt：只有与初始空白不同才确认（原来无条件确认）。
- 未改：Bindings 及各自动保存控件、Preset 详情与 Text API 的既有确认、保存接口与数据模型、布局与文案体系；没有 `beforeunload` / `popstate` / 全局路由拦截。
- 测试（Node 24，jsdom；`npx tsc --project tsconfig.tests.json` 后 `node --test node_modules/.cache/veil-desktop-tests/tests/leave-guards-ui.test.js`）：新增 13 条挂载级测试，在未改组件的 711ae2d 上 11 条失败、2 条（切换对象、Preset 详情既有保护）本就通过作防回归，修复后 13/13 通过。`npm test` 770/770 通过；`npm run lint` 0 error（既有 warning 不变）；`npm run build` 成功。
- 证据级别：自动化测试（JSDOM）；真机未验证。

## 尚未验证

- 真机行为未验证；浏览器刷新、关闭标签页、浏览器 Back / Forward 按设计不保护。
- 未自动化覆盖：用户资料/角色资料里“通过 router.back() 的页头 Back”这条路径只经 PageShell 的 `onBack` 共用逻辑间接覆盖（该逻辑由 Regex 规则子视图测试直接覆盖）；新建角色整页、角色资料编辑页本身没有单独挂载测试（其表单与 Cancel、dirty 逻辑由用户资料页测试覆盖）。
- GitHub Actions `verify` 与 Vercel 预览：在本记录写下时 PR 刚创建，尚无结果；结果以 PR 评论为准，未运行成功则逐项记录原因，不算通过。本地命令（修订 9b6bd19，Node 24）：`npm test` 770/770，`npm run lint` 0 error，`npm run build` 成功。

## 下一步

等待 CodeRabbit 审查最新提交，由 Lan 手动合并；不自动合并，不加 automerge 标签。账本 R2 的最终状态留待第五刀统一文档 PR。R3、R4 不自动开始。
