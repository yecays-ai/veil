# STATUS — 2026-10-10-claude-chatroom-multi-select-bar

更新人：Claude
更新时间：2026-10-10T12:04:00Z
发现范围：观察时间 2026-10-10T09:00Z；基于 origin/main `1498bd451560a8be2dd2fe5c0c9abf0356dd16fe`（#102 已合并，现场核实）；GitHub open PR 列表：#103（仅改 `docs/AUDIT_LEDGER.md` 的 F5 行、真机验收表、停车场“ChatRoom 拆分”条，以及 Header 拆分的 work-status 记录），与本任务不改同一行、不改同一文件的同一段；其他分支上的任务记录未逐一检查。依据：Lan 的授权（对话中交付）、总账停车场“ChatRoom 拆分”条、此前 ChatRoom 评估、#102 的 CodeRabbit 审查（无可处理意见，未建议进一步拆分）。

总账 ID：新增（停车场条目“ChatRoom 第二块拆分”，非审计问题）。
验收话：多选操作栏由独立的纯展示组件渲染，选中数、四个按钮（Select all、Select from here to latest、Delete selected、Cancel）行为与拆分前一致；选择状态和全部处理函数仍在 ChatRoom；CSS、DOM 结构、行为不变。
不做：不改 CSS 与行为；不拆消息列表、输入栏、消息操作菜单、Chat Info、编辑对话框、输入中提示；不碰 #36、消息生命周期、焦点恢复；不加新功能。
停止条件：本 PR 经 Lan 手动合并后停止，不自动开下一个拆分。

## 当前任务

已合并（#104）：把 `chat-room.tsx` 里多选操作栏（`.chat-multi-select-bar`）抽成 `components/chat/chat-multi-select-bar.tsx`。

## 谁在改哪里

Claude；分支 `claude/chatroom-next-split`；PR：[#104](https://github.com/yecays-ai/veil/pull/104)。涉及：`components/chat/chat-multi-select-bar.tsx`（新增，纯展示）、`components/chat/chat-room.tsx`（一处 JSX 换成 `<ChatMultiSelectBar …/>`，新增一行导入）、`tests/chat-multi-select-bar.test.ts`（新增）、`docs/AUDIT_LEDGER.md`（停车场新增一条）。

## 选择依据

- 候选与结论：多选操作栏——只在进入多选后渲染，不在首帧路径；没有 ref、副作用、焦点和异步；原先没有任何测试覆盖。入选。
- 输入中提示：纯展示，但渲染在首帧路径的历史列表里，且依赖 reveal/生成状态，靠近 #36，不选。
- 消息气泡与列表：在首帧路径，处理器与状态多，Lan 此前决定以后做 Reaction 时再评估，不选。
- 输入栏：textarea 是键盘/焦点目标，composerBar 参与高度测量，与加载态输入栏同 key，涉及键盘和焦点，不选。
- 消息操作菜单、Chat Info、确认对话框：焦点恢复，不选。编辑对话框：autoFocus + 异步保存，不选。

## 已完成

- 基线（改动前，Node 24.21.0 / npm 10.9.4，main `1498bd4`）：`npm test` 800/800。
- 拆分：`ChatMultiSelectBar` 接收 `selectedCount`、`canSelectFromHere` 和四个回调；选择状态、`selectMessageRange` 调用和删除确认仍在 ChatRoom。渲染的 DOM 与拆分前相同。
- 新增挂载测试 `chat.multi-select-bar-actions`：从第二条消息进入多选（选中数 1）；四个按钮的文字与顺序；Select from here to latest 仍为 1，Select all 为 2；逐条点掉后为 0 且 Delete selected 禁用；Delete selected 打开“Delete 2 messages…”确认，取消后消息仍是 2 条、多选保持；Cancel 退出多选并清空选择。该测试同样通过在拆分前的原代码上（已用 `git show origin/main:components/chat/chat-room.tsx` 验证），说明它描述的是既有行为。
- 反向验证（逐个变异后测试均失败，恢复后通过）：Select all 无动作；Select from here 接成 Select all；Delete 永不禁用；Cancel 无动作；Delete 接成 Cancel。
- 检查（Node 24.21.0 / npm 10.9.4）：typecheck 通过；lint 0 error / 6 条既有 warning；`npm test` 801/801；`npm run build` 通过。证据级别：自动化测试（JSDOM）与源码阅读。
- 过程中发现：测试失败时对 DOM 节点用 `assert.equal` 会序列化整个 JSDOM，造成内存暴涨（一次近 12 GB，一次约 5 GB），已手动按进程号结束；测试里相关断言改为布尔比较。这是写 JSDOM 断言时的注意事项，不是业务问题。

## 尚未验证

- 真机（iPhone）：长按/点击消息 → Select → 多选栏的实际表现、Delete selected 的确认流程，未验证。
- 焦点恢复（删除确认关闭后的焦点位置）不在本次范围，未验证、未改动。
- GitHub Actions `verify` 与 Vercel 预览：此前同类 PR 上 `verify` 几秒内失败、无 runner，Vercel 受每日部署限额影响；如本 PR 上同样无结果，按“未运行”处理。

## 下一步

开 PR 后等待 CodeRabbit 审查最新提交，由 Lan 手动合并；不自动合并，合并后不自动开下一个拆分。
