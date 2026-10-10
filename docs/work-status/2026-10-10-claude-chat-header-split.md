# STATUS — 2026-10-10-claude-chat-header-split

更新人：Claude
更新时间：2026-10-10T11:30:00Z
发现范围：观察时间 2026-10-10T08:35Z；基于 origin/main `a9d770de1f2b726c851426671ef5cd414b31a496`（#101 已合并，现场核实）；GitHub open PR 列表（含 draft）为空，无重叠；其他分支上的任务记录未逐一检查。依据：Lan 在对话中批准的 ChatHeader 最小拆分方案（总账停车场“ChatRoom 拆分”条）。

总账 ID：新增（停车场条目“ChatRoom 拆分”，非审计问题）。
验收话：加载态与已加载态的 Header 是同一个组件、同一个 key、同一个 DOM 位置，进入聊天无首帧重挂载；设置按钮 ref、焦点来源记录、键盘/安全区副作用仍在 ChatRoom；CSS、行为、数据结构不变。
不做：不改 CSS；不拆 ChatRoom 其他部分；不做在线状态/个性签名；不改存储与数据结构；不顺手重构邻近文件。
停止条件：本 PR 经 Lan 手动合并后停止，不自动开下一个拆分。

## 当前任务

已合并（#102）；真机验收部分未通过/未验，见下。内容：把 `chat-room.tsx` 里加载态和已加载态两份 `<header>` 抽成 `components/chat/chat-header.tsx`。

## 谁在改哪里

Claude；分支 `claude/chat-header-split`；PR：[#102](https://github.com/yecays-ai/veil/pull/102)。涉及：`components/chat/chat-header.tsx`（新增，纯展示）、`components/chat/chat-room.tsx`（两处 `<header>` 换成 `<ChatHeader key="header" …/>`，删除不再使用的 `Link` 导入）、`tests/chat-header.test.ts`（新增）、`tests/chat-layout-ui.test.ts`、`tests/contact-info.test.ts`、`tests/root-app-navigation.test.ts`、`docs/AUDIT_LEDGER.md`。

## 已完成

- 基线（改动前，Node 24.21.0）：`npm test` 799/799。
- 拆分：`ChatHeader` 接收 `contact`（未发布时为 null，标题显示 “Chat”）、`settingsTrigger` ref 和可选的 `onOpenSettings`；未传 `onOpenSettings` 时渲染禁用的设置按钮（无 title、不挂 ref），与原加载态一致。ChatRoom 里的打开设置回调（记录焦点来源并打开 Chat Info）原样保留。
- 新增挂载测试 `chat.header-keeps-identity`：加载态 Header 的标题是 “Chat”、设置按钮禁用；加载完成后同一个 header 元素与设置按钮节点被原地更新（不重挂载），联系人链接指向 `/contacts/peter?from=direct`，标签含联系人名，设置按钮启用且带 title。负对照：把加载态的 key 改成不同值，该测试失败；恢复后通过。
- 源码文字断言处理：`chat-layout-ui` 的 “Conversation settings” 与 `contact-info` 的联系人链接两条已改由上述挂载测试覆盖（原位置留指向说明）；`root-app-navigation` 的返回链接断言原读 `chat-room.tsx`，因 Header 移走而失败，改读 `chat-header.tsx`（仅此一处最小调整）。`chat-first-paint` 对 `key="header"` 出现两次的源码断言仍满足。
- 检查（Node 24.21.0 / npm 10.9.4）：typecheck 通过；lint 0 error / 6 条既有 warning；`npm test` 800/800；`npm run build` 通过。证据级别：自动化测试（JSDOM）与源码阅读。

## 真机验收（Lan，2026-10-10，iPhone，#102 合并后）

- ①从 Chats 进聊天无首帧闪：未通过。另观察到从联系人资料页返回聊天会闪一帧白帧。是否既有问题未用拆分前后版本对照确认，不认定为 #102 引入，也不排除新回归。
- ②设置面板打开、关闭、再次打开正常；设置关闭后的焦点恢复**未验**（触屏无法直接确认，不以设置能再次打开代替）。
- ③点联系人名进入联系人资料：通过（很顺畅）。
- 本次只更新记录，未改代码，未碰冻结的 #36，未继续拆分 ChatRoom。
## 归因调查收尾（2026-10-10，#102 前后版本对照）

- iPhone 真机（Lan）：`a9d770d`（拆分前）与 `1498bd4`（拆分后）两个 Vercel 历史部署都会偶发闪白，并非每次触发；反复进出测试并录屏逐帧观察（录屏未入库）。
- 本地无头 Chromium（Claude，iPhone 尺寸，构建两个提交的副本各跑 10 次、两个入口）：拆分前后都有 1–2 帧、约 11–32 ms 的外壳帧，次数与时长无可见差别，没有空白路由间隙；脚本在临时目录，未入库，副本与服务器已清理。
- 结论：闪白在 #102 之前就存在，没有证据表明 #102 引入新问题；不能据此断定触发频率完全没变。F5(a) 保持“部分修复”，根因未确认、未修复。Chromium 外壳帧与 iPhone 白帧是否同一件事，未确认。
- 调查收尾；未改业务代码，未碰 #36，未继续拆分 ChatRoom。

## 尚未验证

- 设置关闭后焦点回到按钮：真机未验。
- 首帧闪屏的触发频率在拆分前后是否有统计差别：未做统计对比。
- 首帧是否闪动靠 JSDOM 只能证明 DOM 节点未重挂载，不能证明真实渲染无闪动。
- GitHub Actions `verify` 与 Vercel 预览：此前同类 PR 上 `verify` 几秒内失败、无 runner，按“未运行”处理；Vercel 受每日部署限额影响时可能无预览。
- 本次环境默认是 Node 22，没有 `navigator.locks`，Regex/WorldBook 的两条测试在 Node 22 下失败；上述结果均在另行安装的 Node 24.21.0 下取得。

## 下一步

归因调查已收尾；F5(a) 的根因诊断（涉及冻结的 #36）需 Lan 点头才开始；不自动开下一个拆分。本次记录改动尚未合入 main，待并入下一次正常的文档更新（Lan 不要求单独 PR）。
