# VEIL 审计总账（完整合并版）

更新：2026-10-10（Lan 所在时区）｜核对时 main 头 `5137d9a56099827a4289bc3dfce3cac534088e27`（2026-10-10 第六刀阶段性收口时读取；合并记录覆盖 #38–#100；#38–#83 未逐项复验各 PR 的内容与范围，#86–#100 为本轮逐项核对（第六刀 #92–#100 的收口对账见板块六）；并入 Lan 2026-10-10 的人工验收自述，见“真机验收记录”，录屏/截图未入库）｜来源：六轮审计总账 v2、第一板块交接报告、第二板块核销报告、第三刀对账报告、#61/#56 报告、《前端》审计、仓库原根目录总账（F1/F2/F3/F5）
主状态只用五种：**已验证修复 / 已修待验 / 部分修复 / 未修 / 新回归**；另有处置说明：接受风险、后移、搁置、不纳入、明确延期。正文里的“已完成”“已验证”“有条件通过”“通过”不是主状态：“已完成”指施工完成，“已验证/通过/未通过/未验”是验收结果，“有条件通过”是附条件的验收结果；每条以其所在行的主状态为准，两者冲突时按“已修待验”处理并回头核对。板块标题括号内的“阶段性关闭/结案”是板块阶段说明，不是主状态。
本文件是全仓库**唯一**总账（`docs/AUDIT_LEDGER.md`）。原根目录 `AUDIT_LEDGER.md`（#61 起只含 Theme 的那份，后加入 F5/F3）已并入板块五并删除，不留两份。
原稿里的"待补"已按《6刀》《前端》两份材料补齐；两份材料里也没有原文的内容仍标"待对账"，不得猜，找到原始材料再补。

## 固定规则
1. 每张工单开头必须有：总账 ID / 这一刀只解决 / 验收话 / 做完划掉 / 不做 / 停止条件。缺一块就打回。
2. 动手前先只读对账；先找总账 ID，找不到标"新增"，不编号。
3. 不自动合并；合并前看：CodeRabbit 最新一轮针对最新提交、无未解决评论、CI 绿、预览是最新提交。；CI 或预览因账户额度/计费不足未运行时，不得写成通过：PR 描述必须列出未运行的检查名与原因，写明用什么本地验证代替（命令与版本），并由 Lan 人工决定是否合并，这属于人工例外记录，不改变“未运行”这一事实。
4. 没有前后对比证据不得写"已验证修复"；新回归测试先在 main 上证明会失败。
5. 发现旁支问题只登记，不扩 scope。Low 不要求清零。
6. #36 冻结，不改、不关、不合。
7. JSDOM、假 IndexedDB、无头 Chromium、iPhone 真机互不替代。
8. 不碰用户已存数据；没有备份，任何会改存量数据的改动先停下问人。
9. 历史审计报告、PR 描述、旧工单保留其原始状态，不作为当前验收状态的最终依据。当前状态以本账本最新核对记录为准；冲突时核对时间、验证对象与证据，不得用较早的“待验”覆盖较新的“已验”。

## 板块一：存储与数据安全（阶段性关闭）
| ID | 问题 | PR | 状态 | 验收话 |
|---|---|---|---|---|
| S1 | Theme 读取失败无法恢复 | #39 | 已修待验 | 读取失败有 Retry，不用默认值覆盖旧数据 |
| S2 | Preset 删除回滚原因不清 | #40 | 已修待验 | 删除失败可重试，错误原因不被吞 |
| S3 | Chat 孤立图片无人回收 | #41 | 已修待验（靠下次存图触发） | 超 1 小时无引用的图被清，有引用的不删 |
| S4 | Binding 清理误删别窗口新绑定 (C9) | #42 | 已修待验 | 两窗口同时操作，新绑定不丢 |
| S5 | Chat 跨标签页收不到更新 (C8) | #43 | 已验证修复（G1 Chromium） | 一窗发消息，另一窗自动出现 |
| S6 | Foundation 跨标签页过期显示 (C6) | #44 | 已验证修复（G1 Chromium） | 改角色资料，另一窗自动更新 |
| S7 | Foundation 读取失败当空数据 (R5) | #45 | 已修待验 | 读取失败显示错误+Retry，禁止写入 |
| S8 | 删除角色留下残余 (R3) | #46 | 已修待验 | 删角色后其私聊/消息/联系人/群成员/小组件绑定全清，群聊本身保留，先弹确认清单。Lan 2026-10-10 真机：确认清单会弹出，写明将删除聊天与联系人；“确认删除”本身未试 |
| S9 | 存储权威/备份覆盖文档 (G2) | #47 | 已完成 | 文档与行为一致 |
| S10 | 真实浏览器跨窗口验收 (G1) | — | 有条件通过 | 仅 Chromium 无头；Firefox/WebKit/iPhone 未测 |
| S11 | 全站备份与恢复 (R2) | — | 未修（已决策延期） | Memory 系统建成后统一设计；目前没有完整备份 |
| S12 | C3 偶发消息缺失 | — | 未修（未定位，接受风险） | 再出现时记录发送→写入→持久化→刷新时序；不得称已修 |
| S13 | 一次静态资源 404 | — | 未修（未调查） | 待查 |
R3 产品决策：删除角色 = 关于该角色的所有记录都删。
板块一旧项待对账：S14 Regex/WorldBook 旧草稿覆盖（#38 开放，部分修复）；S15 Contacts/Bindings/TextAPI/Character 并发覆盖（#34 #35 #37，已修待验）；S16 Theme 壁纸 blob 误删/清理后又分配（未修，待对账）；S17 全局背景选图晚到覆盖、模糊度失败不回滚（未修，待对账）；S18 global.presetId 被启动强塞 Default（未修，待对账）。

## 板块二：异步 / 生命周期（Lan 确认 10/9 已收口）
来源：第二板块核销报告（基准 main `1804f74`）与《6刀》第二段审计。本板块 ID 只在本表内有效，与板块一、三、四的同名项不得混用（尤其：本表 C3 ≠ 板块一 S12 的 C3）。
| ID | 问题 | PR | 状态 |
|---|---|---|---|
| Stop 准备阶段 | 生成前准备阶段（天气/地点/regex 等）点 Stop 停不下来（原 High） | #20 #48 | 已修待验（#20 的 `awaited()` 已修；#48 补回归测试；真实网络待验）。Lan 2026-10-10 真机：生成中点停止，消息生成真的停止（准备阶段的停止未单独验） |
| A1 | 带草稿点 Reply、草稿落库前点 Stop，留下空的 stopped 气泡，其 Retry 在没有用户内容时调用模型 | #48 | 已修待验 |
| A2 | 领取生成权前被 Stop，聊天里显示原始 `AbortError` 文本 | #48 | 已修待验 |
| U1 | `regenerate()`/`reply()`/Send 的 finally 清锁没有会话归属保护 | #48 #55 | 已修待验（锁仅在仍挂载且是原会话或暂无会话时释放；另见板块三 CF-03） |
| B1 | 天气、地点、模型请求无超时，挂起会占住共享条目/生成锁 | #54 | 已修待验（模型连接 30s、流空闲 45s、天气与地点 12s；真实网络待验） |
| B2 | Here & There 评论从不真正取消，失效后请求跑完且评论机会被消耗 | #54 | 已修待验（取消、保留机会、5 分钟短重试；挂载级取消未测） |
| C1 | 页面卸载后仍 `router.push`，把用户拉回旧页面 | #49 #53 | 部分修复：联系人页/创建群聊/删除联系人（#49）、Preset/Prompt 编辑器（#53）已修；角色页创建、删除、Retry cleanup 仍无保护，降为 Low，接受风险 |
| C2 | 聊天背景设置有两处异步读取未捕获 | #50 | 已修待验 |
| C3（板块二） | 添加联系人无进行中保护、写入失败无反馈 | #49 | 已修待验 |
| C4 | 加载失败后没有 Retry（Foundation、Binding/Preset/Regex/WorldBook、Contacts） | #45 #51 #52 | 已修待验 |
| U3 | 离开聊天室/换角色/卸载会取消本地生成，并留下持久的 “Reply stopped” 气泡；重进不恢复 | — | 接受（当前行为）：Lan 于 2026-10-10 确认接受“离开聊天室/换角色/卸载即取消本地生成”这一产品行为，本行即为该决策的书面记录（此前仓库内没有出处）；不当作缺陷整改 |

Low 接受风险（不追求清零；以下均不是已修复）：D1 键盘收起后 200ms 轮询继续运行直到卸载；D2 同步卸载后 chat session lifecycle 多一次只读读取（与冻结的 #36 同文件，等其结论）；D3 角色删除善后期间短暂显示 “Character not found.”；E1 AvatarEditor 连续选图的竞态（仅键盘/读屏可达）；E2 删除预览“打开-取消-重开”用旧结果；E3 `saveBubbleTiming` 无版本保护；E4 Preset 导入在忙碌时静默丢文件（几乎不可触发）；E5 删除最后一个角色后历史残留不提示清理；E6 `readImage` 无超时；E7 Foundation 刷新的窄微任务窗口；U2 模型流读取错误以浏览器原文显示在失败气泡；#55-L1 同一角色的会话被替换时旧操作不释放锁（未复现）。

待对账（沿用旧账，不得写成已修）：#21 遗留的“关闭后旧结果仍提交”——Here & There 部分由 #54 覆盖（见板块三 D8），其余待对账；天气缓存过期不自动刷新——第二板块核销时代码已含带退避与清理的刷新，待对账确认；多个小组件抢评论机会的规则未定；Chats 预览旧刷新覆盖新刷新——#58（板块三 D7c，同时是 Part 5 F1，同一修复，不重复计数）；Custom CSS 旧保存关掉新编辑器——#69（Part 5 F6，已合并）；裁剪换图残留上一张状态——Part 5 F9（#86 已合并，已验证修复，见板块五 F9 行）。

## 板块三：聊天核心（阶段性结案，人工验收开放）
剩余确认 High 0、Medium 0。
| ID | 问题 | PR | 状态 |
|---|---|---|---|
| D1 | 孤立 streaming 永久阻塞维护 | #20 | 已修待验（原生崩溃恢复待验） |
| D2 | 同会话跨窗口并发生成、Stop 到不了 owner | #20 #22 | 已修待验（真实双窗口待验） |
| D3 | 草稿保存期间 Stop 后仍启动生成 | #20 #48 | 已修待验 |
| D4 | 等待依赖时 Stop 不能结束 | #54 | 已修待验（真实网络待验） |
| D5 | 生成期间改历史致答案错配 | — | 已验证 |
| D6c | length 截断被当普通完成 | — | 已验证 |
| D7c | MessagesHome 旧请求覆盖新列表 | #58 | 已验证 |
| D8 | Here&There 禁用后迟到提交 | #54 | 已修待验 |
| R1 | Regenerate 提前删原回复 | #20 | 已修待验（多气泡人工验收待做） |
| R2c | 失败/取消无显式恢复 | #20 | 已修待验 |
| CC-01 | 搜索跳转目标被 pacing 重新隐藏 | #57 | 已修待验（iPhone 待验） |
| CF-01 | ChatStorage 连接异常关闭后不恢复 | #60 | 已修待验 |
| CF-02 | 草稿保存前失败，Retry 丢原问题 | #60 | 已修待验。边界：仅当前页内存保留；离开聊天或刷新后需重新输入 |
| CF-03 (=#55-L2) | Reply 已保存草稿在会话暂失后重复发送 | #60 | 已修待验 |
| #59 | Core IndexedDB 异常连接恢复 | #59 | 已修待验（仅 Core，不覆盖 ChatStorage） |
后移：CC-02 Regex 执行预算；CC-03 Prompt 总量预算 → Context/Prompt Budget；统一终态诊断事件 → 板块六。R5 文档/显示顺序不一致：Low 残余。
人工验收（优先三项）：iPhone 搜索跳转；生成中点 Stop；失败后点 Retry。其余清单见第三刀报告。
注意：板块三编号 D1–D8/R1–R5 与板块一、二同名项不得混用。

## 板块四：模块 / 契约
本板块 ID 只在本表内有效，与板块一、二、三的同名项不得混用（尤其：本表 D2 ≠ 板块三 D2，本表 D6/D7 ≠ 板块三 D6c/D7c）。
| ID | 问题 | PR | 状态 |
|---|---|---|---|
| M1（第四刀 D4） | WorldBook 用户顺序被库顺序覆盖；生成流程现按 Binding 顺序解析（`selectBoundWorldBooks()`） | #27 | 已验证修复（自动化：实际生成上下文、默认继承、显式 None 及故障注入测试；依据第四刀交接报告）；无独立真机记录 |
| M2（第四刀 D1） | Bindings 默认=全选，UI 误显示 None；未设置现显示 Default (All)，显式空列表才显示 None | #29 | 已验证修复（自动化：挂载级测试覆盖显示、保存与继承；依据第四刀交接报告）；无独立真机记录 |
| D6 | Preset ID 与 Binding ID 长度/空白契约不一致 | #62 | 已验证修复：导入验收通过（正常导入、非法 ID 拒绝、非 Preset 文件拒绝）；Lan 手机验收通过：正常 Preset 导入，绑定测试 Bot，聊天成功生成，重新检查绑定仍保留（记录来自 GPT 窗口，Lan 确认；截图/录屏未入库） |
| 兼容性（未编号） | iPhone Preset 导入选择器里合法 JSON 文件发灰、不可点击 | #64 | 已修待验：移除文件输入的 `accept` 后，Lan 在同一台 iPhone、同一文件上确认可选；#64 已合并。未编 D 号，不改 D6 归属 |
| D7 | Prompt 顺序（含 prompt 显示启用但不在 promptOrder） | #65 | 已验证修复：`promptOrder` 为运行时启用的权威，不在其中的 Prompt 显示为禁用且不发送，显式启用时追加到末尾；Lan 手机验收通过：特殊未排序 Prompt 导入后默认关闭；关闭时不触发；开启后发送 `D7check` 得到预期回复（记录来自 GPT 窗口，Lan 确认；未入库） |
| D2 | Theme 导出包含 Here & There 的角色 ID 与生成评论（隐私） | #66 | 已验证修复：导出边界移除 `characterId` 与 `comment`，保留布局与显示设置；Lan 手机验收通过：真实导出 JSON 检查未发现角色 ID 与评论；在无角色数据的另一网页导入，壁纸恢复、小组件正常（记录来自 GPT 窗口，Lan 确认；未入库）。（编号取自 Codex 工单；《6刀》第四段 P1 原条目为 “Theme Export 泄露本地角色信息”） |
| M3（第四刀 D3） | Custom CSS 大写/转义 `@import` 逃逸作用域；`@font-face`、`@keyframes` 无命名空间 | #25 | 已验证修复（自动化：`tests/custom-css-isolation.test.ts` 含大写/混写 `@import`、`@FONT-FACE`、keyframes 加前缀、JSDOM 泄漏及故障注入；依据第四刀交接报告，并已在仓库核对 #25 与该测试）；无独立 iPhone 记录。此前本行误写“未修（待对账）”，已更正 |
| D5 | 启动过程覆盖 Use active Preset 继承状态；bootstrap 现保留未设置值 | #24 | 已验证修复（自动化：启动流程回归测试；依据第四刀交接报告）；无独立真机记录 |
| D8 | Theme 导出包可能超过自身导入限制（典型约 3.3 MB 导出 > 导入端 3,000,000 字符，导出后无法重新导入） | — | 明确后移（既有审计决定；后续归属待定，不并入 D2）。本行 D8 与其他板块的 D8 不是同一问题 |

## 板块五：界面 / 导航 / 前端渲染
说明：本板块 F1–F8 来自《前端》审计（Theme 首帧、Chat 首帧、缓存与异步生命周期）。《6刀》Part 5 报告另有自己的一套 F1–F11 与 R1–R4，编号相同但不是同一批问题，引用时必须写明命名空间（“《前端》F3”或“Part 5 F3”，不得只写 F3）。经第五刀窗口核对 GitHub PR 标题及合并状态，Part 5 F1–F8 依次对应：F1→#58（Chats 旧刷新覆盖；与板块三 D7c 是同一修复，不重复计数）、F2→#71（设置错误归属）、F3→#73（浮层焦点边界）、F4→#76（消息键盘操作）、F5→#57（搜索跳转后目标消息被 pacing 隐藏，已修，不得重复开单）、F6→#69（Custom CSS 保存归属）、F7→#79（Theme 资源延迟发布）、F8→#82（资料页滚动容器）；八个 PR 均已合并。这只确认了 PR 与合并状态，不代表这八项已通过人工验收，也不改变其验收状态。Part 5 F9 已在 270f726 复现并由 #86 修复（已合并，见板块五 F9 行）；Part 5 F10 已在 72c3bd8 复现，部分修复：①③④ 已修待验（#88），②暂停待决定（见板块五 F10 行）；Part 5 F11 已在 8df9abc 复现并由 #89 修复（已合并，已修待验，见板块五 F11 行）；Part 5 R1–R4 已于 2026-10-10 逐项核查并有结论（见各行）：R1 核销/接受风险、R2 已修（#90）、R3 核销（按产品设计接受）、R4 接受现状；均未新增施工任务。
| ID | 问题 | PR | 状态 |
|---|---|---|---|
| F1 | Theme 先发布默认主题再切换（冷启动）：已保存 Theme 先发布、其当前图片 URL 后准备，服务端与首次客户端输出用默认主题（《前端》F1） | #61 #79 #83 | 已验证修复（人工验收，证据未入库，账本不能独立复核；接受残余）：Lan 自述 2026-10-10 真机逐帧观察录屏——重开后依次为白色加载底色、已保存布局（刻意换过位置后仍是换后的位置，不再先出默认布局）、壁纸，壁纸比桌面晚零点几秒，Lan 接受；修前 Lan 曾观察到默认布局先出现；录屏未入库，未随 PR 提交。#83 起主题读完前不画默认桌面。原证据：加入有界的当前资源准备边界和 hydration 前已验证的 CSS bootstrap；自动测试覆盖延迟图片发布；iPhone 首帧对比待做 |
| F2 | 未使用的 preset 图片拖慢当前主题：图片 URL 同步把 current 和全部 presets 一起读（《前端》F2） | #61 | 已修待验（同上；注意图片读取等待上限 1 秒）。原证据：只为当前快照准备显示；presets 引用仍由存储回收的引用集保护 |
| F3 | Chat 把“尚不知道背景”当成“使用 global/default 背景”（《前端》F3） | — | 已核对，当前 main 无需再改代码；待验：《前端》F3 的“尚不知道背景”不再被当成“默认背景”发布——设置未读到时 `readyForFrame` 为假，不发布首帧；读取失败不写入缓存，下次进入重新读取；晚到的全局设置不会覆盖角色自己的壁纸；明确选择默认时立即发布。保护来自 #63（设置就绪门控）与 #67（revision 粒度）。有意保留的行为：设置读取超过 1200ms 或读取失败时按 F5 设计回退到 Theme 背景发布以免聊天一直空白，晚到结果再更新。#81 只补了回归测试（未改生产代码）（失败读取不当作默认、明确默认立即发布、晚到全局设置不覆盖角色壁纸）。注意：#73 的“Part 5 / F3”是聊天浮层焦点，与本编号无关。iPhone 真机未验 |
| F4 | #33 的背景失效粒度过大：所有 session 变更都递增同一个 background revision，Pin 等普通 session 修改会使有效 hint/settings 作废，暖进入的底色闪现可能回来（《前端》F4） | #67 | 已修待验：#67 已合并，只有全局背景变更和明确标记 `backgroundChanged` 的 session 变更才推进 revision；自动测试通过，设备验收未做 |
| F5 | Chat 和 Messages 仍是每挂载读取，外壳与内容天然分批出现（《前端》F5） | #63 #70 #83（#36 冻结，是另一条 Messages 点击入口的方案） | 部分修复：Lan 2026-10-10 真机——Chats↔Chat、联系人进聊天的 `Loading…` 已消失（#83），背景与消息一起出现；仍有一帧主题底色空帧，从任何入口进聊天都有（原因读码：正则读取每次挂载异步，发布又经 useEffect，未修；是外壳还是路由空档待 `chat-frame` 诊断数据）。#63 已合并，协调发布当前会话、人物身份、初始消息、Custom CSS 与选定壁纸，设置/壁纸读取最多等 1200ms 后回退到现有 Theme 背景；自动测试通过；仍待做：iPhone Safari/Standalone 的前后对比录屏（本行当前主状态为部分修复，见上文真机记录）。补充真机观察（Lan，2026-10-10，iPhone，#102 合并后）：从聊天点联系人名进入联系人资料很顺畅，但从联系人资料页返回聊天时会闪一帧白帧；这是 Lan 的真机观察，属于 F5(a) 范围内的新增入口记录。它与上面“主题底色空帧”是否同一机制、是否在 #102 之前就存在，均未用拆分前后版本对照确认，不据此认定为 #102 引入，也不据此排除新回归；未做诊断，未改代码。 |
| F6 | Contact Info 重复进入仍有等待：外层 route loading 与内层真实页面是两种等待，共享 Contacts 快照不是原因（《前端》F6，设备因果待核实） | — | 已修待验：#74 已合并（联系人动态路由占位改用 ContactInfo，避免外层 route loading 与内层页面两种等待），#80 已合并（更新 navigation-feedback 旧断言）；二次进入约 2 秒的设备因果未核实，与 U4 同类，待真机 |
| F7 | 初始消息定位在 effect 中、display Regex 异步加载，消息出现后才定位或转换；同挂载多次 Regex load 无请求序号（《前端》F7） | #75 | 已修待验：#75 已合并（初始消息定位与 display Regex 读取），自动测试 `chat-initial-render` 等通过；iPhone 真机未验 |
| F8 | 异步与缓存生命周期标准未统一：Foundation 无跨标签页订阅、Messages 列表无请求版本、Regex/WorldBook Hook 保护不全、头像无 decode 边界、Chat 缓存只限条目数、decode 失败也标 decoded（《前端》F8） | 本 PR；既有 #44 #45 #51 #58 | 已修待验：六处已逐项核对（核对基线 main `30437ae`）。①Foundation Provider：已保护，有跨标签页订阅、focus/可见性复读、请求序号与卸载保护，测试 `foundation-cross-tab`。②Messages 列表：已保护，`requestRevision` + 卸载失效，测试 `messages-home-refresh`（旧结果成功/失败都被丢弃）。③Preset/Regex/WorldBook：已保护，三个 Hook 都有 lifetime、请求序号、pending 去重与卸载失效，测试 `resource-load-retry`、`regex-worldbook-editor-safety`、`preset-persistence-safety`；聊天页自己的 display Regex 读取归 F7（#75）。④头像/Hero：无需修改——它们是普通图片、不参与首帧门控，没有任何代码把 `src` 存在当作像素完成；首帧只等当前壁纸的解码状态（见⑥）。⑤Chat 缓存：阻塞（待设备）——上限是 2 个条目，Blob 每个至多 25 MiB，解码位图由浏览器持有且可被丢弃，没有字节预算也没有真机内存数据；按“先测量再优化”不改，已在代码注释写明预算依据。⑥decode 状态：已修——解码失败不再标记为已解码，`ready` 会 reject、缓存不再把它当作可绘制壁纸，等待者立即回退到 Theme 背景（不再误判成功，也不再等 1200ms 超时）；新增两项测试，在旧行为上失败。未验证：iPhone 真机；⑤的真机内存。F8 在 ⑤ 有设备数据前保持“已修待验”，不标已解决 |
| U1 | 聊天壁纸进入闪一下 | #32 #33 | #61 后 Lan 主观验过不再闪；仍待正式对比录屏 |
| U2 | 点击进聊天后约 1 秒无反馈（老问题） | — | 未修，原因未明；归 Chat 首屏准备那一刀；可考虑点击即时按下反馈 |
| U3 | 整屏一次性出现，观感突兀 | — | 接受（整帧发布的代价），暂不处理，不用淡入遮 |
| U4 | Contact Info 二次进入仍 Loading 约 2 秒 | — | 未修（待测，低置信度） |
| U5 | Character 返回应回真实来源页 | — | 未修（待对账） |
| U6 | standalone 主屏幕模式 Dock 上移（#56） | #56 | #56 已合并；Dock 回归是否已修待确认 |
| U7 | Overlay 下输入框可聚焦；错误提示被盖住；Home 编辑模式有无效按钮；离页保护不统一 | — | 部分修复，已按归属拆分：错误提示被盖住 → Part 5 F2（#71，已合并，人工验收未记录）；Overlay 下输入框可聚焦（浮层焦点）→ Part 5 F3（#73，已合并，人工验收未记录；Lan 决定焦点规范不纳入）；Home 无效按钮 → Part 5 F11（已修待验，见板块五 F11 行）；离页保护不统一 → 第五刀-R2（#90 已合并，已验证修复） |
| U8 | 键盘弹出时 header 飞走（iOS） | — | 搁置（Lan 决定） |
| F9 | ImageCropDialog 切换图片后保留旧的加载状态、尺寸、缩放与位置，Save Crop 仍可用（原文标题：Crop readiness and dimensions survive a source replacement；Medium；`components/image-crop-dialog.tsx`） | — | 已验证修复（[#86](https://github.com/yecays-ai/veil/pull/86)，已合并；见 work-status `2026-10-10-claude-p5-f9-crop-source-reset`。修复本身的证据是自动化测试 JSDOM：修复前 4/5 条失败、修复后全过；真机验收（Lan，2026-10-10，见“真机验收记录”）只证明正常裁剪流程没有回归，不能复现修复场景——调用方都是关掉再重开的模态流程，弹窗开着时换图只可能经键盘/读屏触达，属组件契约缺陷；损坏图片的报错路径未在真机试过）。原审计证据级别：Mounted reproduction——加载图片 A 后弹窗保持挂载并切换为 B，B 尚未加载或加载失败时旧 loaded、尺寸、zoom、position 仍保留，Save Crop 继续可用。原始建议：切换 source 时重置加载状态与几何参数，失败时清除 ready，并拒绝旧加载事件。来源：《6刀.docx》Part 5 前端/导航审计报告原文（由 Lan 摘录提供）。Part 5 内编号，与本表 F1–F8（《前端》审计）不是同一批；这是补全审计来源，不代表当前 main 已重新验证，不新增编号、不扩大整改范围、不自动开工单。 |
| F10 | 四种页面状态错误暗示加载中、不存在或失败（原文标题：Several route states incorrectly imply loading, absence, or failure；Low） | — | 部分修复（①③④ 已修待验；②暂停待决定；[#88](https://github.com/yecays-ai/veil/pull/88)，见 work-status `2026-10-10-claude-p5-f10-route-states`；自动化测试 JSDOM 已覆盖，未做真机验证；②暂停，待 Lan 决定）。在 72c3bd8 上四种情况均复现。②暂停原因：bce4305（2026-10-06，“stabilize chat keyboard layout and empty state”）曾有意移除 MessagesHome 的 “No conversations yet / No matching chats” 文案，并由 `tests/contacts-conversations.test.ts` 钉住；是否恢复空状态/无匹配提示需要 Lan 决定。注意：①只结束了 Loading 并显示错误，`MessagesHome` 本来没有重试入口，没有新增；④只区分了 Foundation 未就绪与已就绪，Foundation 加载失败仍无法在编辑器内区分（Provider 未暴露失败状态，不改 Foundation）。原审计证据级别：四种情况均为 Mounted reproduction：① `MessagesHome` 首次列表读取失败时错误与 Loading 同时持续显示；② `MessagesHome` 空列表或搜索无匹配时缺少说明；③ `GroupRoom` 读取到非群聊 session 时永久显示 Loading；④ `BindingEditor` 在 Foundation 尚未加载时先错误显示 Binding target not found。原始建议：区分 pending、failed、empty、no-match、invalid identity。来源：《6刀.docx》Part 5 前端/导航审计报告原文（由 Lan 摘录提供）。Part 5 内编号，与本表 F1–F8（《前端》审计）不是同一批；这是补全审计来源，不代表当前 main 已重新验证，不新增编号、不扩大整改范围、不自动开工单。 |
| F11 | Home 编辑模式存在两个可用但无效的按钮：Add Widget、Edit Pages（原文标题：Home exposes enabled actions that do nothing；Low；`components/home-edit-shell.tsx`） | — | 已修待验（[#89](https://github.com/yecays-ai/veil/pull/89)，见 work-status `2026-10-10-claude-p5-f11-home-actions`；自动化测试 JSDOM 已覆盖，未做真机验证）。在 8df9abc 上复现：两个按钮可用且没有处理函数；修复：两个按钮改为 disabled（不开发对应功能）。这两个按钮是 Lan 与 GPT 早先留下的计划功能入口（Add Widget、Edit Pages），原设计者已不记得细节，暂时禁用以免误导；功能本身登记在“停车场”，未删除。原审计结论：按钮显示可用但没有处理函数，点击无反应。证据级别：Mounted reproduction + code-confirmed。原始建议：标记不可用或暂时隐藏，无需开发对应功能。来源：《6刀.docx》Part 5 前端/导航审计报告原文（由 Lan 摘录提供）。Part 5 内编号，与本表 F1–F8（《前端》审计）不是同一批；这是补全审计来源，不代表当前 main 已重新验证，不新增编号、不扩大整改范围、不自动开工单。 |
| 第五刀-R1 | 身份与查询状态的边界依赖路由重新挂载（原文标题：Some identity and query-state boundaries depend on router remount behavior；Medium；涉及 ContactsHome、ContactInfo、GroupRoom） | — | 已核销（`ContactInfo`、`GroupRoom`）/ 接受风险（`ContactsHome`）。2026-10-10 在 main `711ae2da25c1d5db112498b843cd04bfa517094e` 上核查，未改业务代码。真实 Next 16.3.8 生产构建 + Chromium 探针（结构相同的临时页面，不是 VEIL 本身，探针未入库）：动态路径变化（`/c/a`→`/c/b`）会重新挂载，组件 state 丢失，Back/Forward 后也是空；只改查询参数、停留在同一页面时组件被复用，`useState(初始值)` 不重置。`ContactInfo`：`9e98ab1` 已修，测试覆盖换联系人后草稿、裁剪弹窗、旧请求清理，且走动态路径。`GroupRoom`：#88 加了 sessionId 归属保护，测试覆盖切换目标，且走动态路径。`ContactsHome`：组件层面确实保留旧选择，真实路由在只改查询参数时会复用它；但应用内没有任何入口产生“只差查询参数”的连续两条 `/contacts` 历史（Chats 菜单与创建群页返回都是不同页面之间的跳转；手动改地址栏会整页重载），属理论风险，Lan 同意接受。若将来新增这类入口，最小修复是在 `ContactsRoute` 给 `ContactsHome` 加以查询参数为 key 的一行。证据级别：自动化测试 + 临时真实浏览器探针；没有在 VEIL 本身真机点 Back/Forward 逐页验证。来源：《6刀.docx》Part 5 原文（由 Lan 摘录）；Part 5 内编号，与《前端》F1–F8 不是同一批；与板块三 R1 无关 |
| 第五刀-R2 | 未保存离开页面的保护不统一（原文标题：Unsaved-navigation protection is inconsistent；Medium） | — | 已验证修复（[#90](https://github.com/yecays-ai/veil/pull/90)，见 work-status `2026-10-10-claude-r2-leave-guards`）。产品规则（Lan 选方案 3）：有实际未保存修改时，应用内主动离开长文本编辑器需确认，没有修改直接离开，不做自动保存、不拦浏览器刷新/关标签/Back/Forward。覆盖：WorldBook 详情与条目、Regex 详情/规则/新建组、用户资料/角色资料/新建角色、联系人资料编辑、Appearance CSS 变量、聊天内 Custom CSS；新建 Preset Prompt 空白返回不再多余确认。证据：自动化测试 JSDOM 13 条（未改组件的 `711ae2d` 上 11 条失败、修复后全过）+ Lan 真机验收 8 项通过（iPhone，合并后的 main 部署，见“真机验收记录”）。**未经真机的部分**（仅自动化覆盖）：Regex 各页面、聊天内 Custom CSS、用户资料编辑、新建角色整页（后两者与已真机验过的角色资料共用 `ProfileForm` 逻辑）。按设计不保护：浏览器刷新、关标签页、浏览器 Back/Forward。已知边界：dirty 用 JSON 比较，字段顺序不同视为已修改。来源：《6刀.docx》Part 5（仅摘录到标题与严重程度）；Part 5 内编号，与板块一/三的 R2 无关 |
| 第五刀-R3 | 屏幕外的 Home 页面仍保留活动的小组件工作（原文标题：Offscreen Home pages retain active widget work；Medium） | — | 已核销（按产品设计接受），未改代码。Lan 的产品决定：Here & There 就是要角色“有话随时留”、翻到那一页时能看到它在后台生成的评论，所以挂载着的隐藏页上的 Here & There 继续领取机会并生成是有意行为，不是缺陷（曾考虑“隐藏页不领取”，Lan 否决，对应修复单作废）。规则：整个 Home 最多一个 Here & There，待将来启用 Add Widget 时落实该限制，这样就不存在“多个组件抢机会”（并解决《未完成清单》里“多个小组件抢评论机会的规则未定”）。当前默认桌面只有一个，Add Widget 已禁用（F11），用户无法加第二个。接受的副作用：隐藏页上时钟这类每秒刷新的任务仍在运行，耗电没有真机数据；Lan 此前决定不统一暂停。未验证：布局导入是否可能带入多个 Here & There 未核查。证据级别：源码阅读 + Lan 的产品决定；无自动化/真机验证。来源：《6刀.docx》Part 5（仅核对到原标题与严重程度）；与板块一 R3 无关 |
| 第五刀-R4 | 返回导航时滚动与临时状态的预期不明确（原文标题：Back-navigation scroll and transient-state expectations are not explicit；Low；涉及 PageShell 滚动、Chats/Contacts 搜索筛选、Chat 草稿与选择状态） | — | 已定义预期，接受现状，未改代码。2026-10-10 在 main `14c9629cb6f922440aa9b884d61fdbc4ab81cb6a` 上核查。**现状（源码阅读 + R1 的真实 Next 探针）**：离开页面后再回来（链接或 Back/Forward），页面组件重新挂载，以下状态全部回到初始：Chats/Contacts 的搜索词与筛选（`useState`）、聊天输入框里未发送的文字（`draft` 是 `useState`，仅“发送失败”的 `failedDraft` 随消息持久化）、消息多选状态；页面滚动位置不恢复（滚动发生在 `.app-page-body` 容器而非文档，仓库内没有任何滚动恢复代码，浏览器自带的 Back 滚动恢复对它不起作用）。已保存的数据（会话、消息、设置）不受影响。**预期定义**：这些都属于“临时界面状态”，离开即丢弃，不持久化、不做 keepalive、不做全局状态；这与 R2 的“长文本编辑器有改动才确认”并存——需要保护的是用户写的长内容（R2 已处理），不是搜索词/筛选/多选/滚动位置。**唯一值得 Lan 将来考虑的是聊天未发送草稿**：目前离开聊天室会丢，若体验上不可接受，最小做法是在 `ChatRoom` 卸载或输入时把草稿按 session 存入已有存储并在发送/清空时删除（需要定清理与长度规则），现不建议做。证据级别：源码阅读 + R1 的临时探针（组件重新挂载）；**没有**在 VEIL 本身真机点 Back/Forward 验证滚动与草稿，也未用探针单独验证滚动容器的表现。来源：《6刀.docx》Part 5 原文（由 Lan 摘录）；Part 5 内编号，与《前端》F1–F8 不是同一批 |
冻结：#36（Chat 首帧）。Chat 首屏设计方案：先在 iPhone 量，再决定；一轮测量，出结论即止，不往 React/Next 内部深钻。

## 板块六：测试 / CI / 维护
生命周期测试变异验证工具失效（新发现，本次最小施工）：**已修待验**。核查基线 `8d13788cef3533d775e0ff04a270f4f19fbb67f6`（#97 已合并）。原 `scripts/check-lifecycle-test-mutations.mjs` 的迟到背景检查仍匹配已不存在的 `if (!active || !blob)`；本轮先运行原脚本，退出 1、报 `production mutation must execute`，并非业务保护已删除。现仅移除迟到图片读取分支带专属注释的 early return，避免误匹配另一个 active guard；保留背景、气泡计时器、disabled Switch 三项验证意图。新增手动入口 `npm run test:mutations`（先编译当前源码，不接 CI）及必要运行说明。Node 24.21.0 / npm 11.19.0 本轮实际运行：三项各自正常 exit 0 → 变异 exit 1 且命中指定保护断言 → 恢复 exit 0；缺失目标 found 0、不唯一 found 2、变异 no-op、缺失生效标记四个负对照均明确报错、exit 1；三个编译目标运行前后哈希一致，业务源码与测试无变异残留，产物均被忽略。`npm test` 串行重跑 797/797、typecheck、lint（0 error / 6 条既有 warning）及 build 通过；一次并行校验期间 CF-02 Retry 用例失败，未改业务代码后串行通过，保留为不稳定观测，不归因或顺手修复。历史 #26 的补测与变异验证记录保留；上述是本轮重新运行的证据，不沿用历史通过。边界：仅三个命名保护，仍依赖编译后的匹配锚点，今后漂移必须失败；不证明全仓清理或浏览器/iPhone 释放，聊天背景 URL 与 Foundation 卸载补测不在 #98（分别见 #99、#100）。#98 已合并，状态仍为“已修待验”，未核销。

假绿测试；清理类测试真实性（**部分修复**）：历史 #26 已补强迟到背景读取和气泡计时器的清理行为；本次在 #99 补充 Chat 背景设置的行为断言（成功创建预览 URL 后换图/卸载会调用 `URL.revokeObjectURL`，卸载后设置通知不再启动读取，迟到图片读取不创建 URL；证据：本地 JSDOM 挂载测试）。现有部分清理测试已有有效行为断言，不再笼统称为假绿。Foundation 卸载局部此前未核销；#100 在 `tests/foundation-cross-tab.test.ts` 补充卸载后 focus/visibilitychange 监听集合为空、事件不再触发 storage load、重挂载后事件与存储订阅恢复；存储层用 fake IndexedDB + TestChannel 验证关闭频道退出活动房间、关闭后不向 peer 投递、旧订阅不再收到变更且新订阅可收到变更。三个隔离负对照分别移除两项事件监听清理和 `channel.close()`，对应测试均失败；恢复后的编译产物哈希与变异前一致。证据级别：本地自动化测试（JSDOM / fake IndexedDB / TestChannel），局部已修待验（#99、#100 均已合并，未核销为“已验证修复”）；独立复核（Claude，2026-10-10，分支头 `3ca7b5f`）：分别删除生产代码里 focus 监听的移除、visibilitychange 监听的移除、`channel?.close()` 三处，对应测试均失败，还原后 4/4 通过、`npm test` 799/799；真实浏览器、真双窗口与 iPhone 未验证。天气计时器及其他未验证清理范围仍保留，清理类测试总项继续为“部分修复”。旧编译产物残留（第六刀 A1：#92 已修，已修待验——`scripts/run-tests.mjs` 改为按 `tests/*.test.ts` 源文件决定要跑哪些编译产物，已删除源文件的旧 `.test.js` 不再执行，源文件缺编译产物则报错而不是静默跳过；修复前复现：往编译目录放一个无源文件的失败测试，`npm test` 771 条中 1 条失败、退出码 1；修复后 773/773 通过且不执行它；证据级别：自动化测试，本地运行器问题，CI 干净检出不受影响，无真机层面）；源码字符串测试过多；BroadcastChannel 同步 mock（第六刀 C2 核查：这是测试层级与可重复性缺口，不是已确认的同步业务缺陷。Chat 已有 Node 原生异步 BroadcastChannel 测试，Foundation 与部分通知路径用 mock/JSDOM/fake IndexedDB，G1 只留有无头 Chromium 验收摘要、脚本未入库；#97 补本地专用浏览器冒烟 `npm run test:browser`：同一 Chromium context 的两个真实页面，验证 Chat 消息与 Character 改名在另一页自动出现且已存入 IndexedDB；先把 postMessage 关掉做负对照，两条都失败，恢复后通过；不接 CI，Firefox/WebKit/iPhone/后台恢复/真双窗口生成竞争仍未覆盖，Settings 等其他域没有统一跨标签订阅，未纳入；已修待验，证据级别：自动化浏览器测试（本地）。新增开发依赖 `@playwright/test@1.56.1`，已获 Lan 同意）；无服务端分支保护；README/架构文档落后（第六刀 C1 已修正已核实的事实，已修待验：README 的天气说明、上传上限 20 MB、测试输出目录、存储健康检查措辞，Chat Core 的联系人、发送中拒绝与 Retry、键盘收起自动回复、读取会触发恢复写入、群聊/WorldBook/Regex/消息菜单已存在，并在 Chat Core 加了版本定位说明；只改文档、不重写结构，证据级别：源码阅读；其余段落未逐条核对，Chat Core 其他 v1 描述仍可能落后）；休眠的备份/健康检查代码需接入或删除（第六刀 C1 核查并决定：`lib/storage-health.ts` 是历史遗留——曾是已删除备份设置页的功能，生产未调用，只有测试调用；Lan 决定保留，不接入、不删除，将来设计完整备份或存储管理时再评估，现无证据表明必须恢复；联系人与气泡时间的局部导出/恢复接口同样只有测试调用，暂不动；未找到休眠的完整备份模块，历史 `lib/backup/*` 已删除；证据级别：源码阅读 + 提交历史）；统一终态诊断事件（request-diagnostics 缺关联终态事件）——部分修复，不得整体销账：第六刀 B1 已补模型调用层（`lib/chat/request-diagnostics.ts`、`provider.ts`、`text-api.ts` 的测试连接）：开发环境下每次实际模型调用有且仅有一条 `completion:terminal`，带 requestId、source、结果（completed / truncated / error / timeout / cancelled / abandoned）、finishReason（只记录常见取值，其余记为 other）、错误类别（network / http / invalid-reply / invalid-stream / no-stream / stream-ended / stream-error / no-completion）、HTTP 状态码、超时阶段（connect / idle）与耗时；Abort 一律记为通用取消，不归因为 Stop；证据级别：自动化测试（修复前 main 上 10 条中 9 条失败，修复后全过），无真机层面，生产环境不输出；状态“已修待验”。第六刀 B2 已补 Chat 最终持久化结果（`lib/chat/persistence-diagnostics.ts`、`engine.ts`）：开发环境下每个已领取 attempt 在释放之后有且仅有一条 `generation:persisted`，带 requestId（即 attemptId，与 `completion:terminal` 关联）、source、结果（committed / failure-recorded / stopped-recorded / owner-lost / failure-record-failed / nothing-persisted）、`releaseFailed` 与耗时；`finalizeReply` 返回才算 committed；证据级别：自动化测试（修复前 main 上 7 条中 6 条失败，修复后全过），无真机层面；状态“已修待验”。已知边界：无草稿时的跨窗口 Stop、崩溃恢复新建的标记没有原 attemptId，不能承诺所有恢复记录都可追溯；`releaseGeneration` 抛错会盖掉已提交的返回值使整个调用 reject（本次只观察、不修，另记旁支）。第六刀 B3 已补 Here & There 最终处置（`lib/here-there-diagnostics.ts`、`lib/here-there-comment.ts`）：开发环境下每个已发起模型调用的评论请求有且仅有一条 `here-there:disposed`，带 requestId（与该次 `completion:terminal` 同一个）、固定 source、结果（adopted / stale-discarded / cancelled / empty / commit-failed / error）、阶段（model / commit）与耗时；adopted 必须同时观察到更新命中目标且 commit 返回，commit 成功但目标已删除或换绑记为 stale-discarded；判定优先级固定为取消 > stale > empty > commit-failed > error；未调用模型的跳过路径（开关关闭、未领到机会、身份不符）与模型调用之前的准备异常不输出；不报告重试是否安排成功；证据级别：自动化测试（修复前 main 上 7 条中 5 条失败，修复后全过），无真机层面；状态“已修待验”。至此板块六“统一终态诊断事件”的 B1、B2、B3 均已施工待验，总项仍为“部分修复”：待三项验收后再决定是否销账，并仍有已记录的旁支（见下）。旁支（只记录，不修）：评论 owner 检查发生在进入 commit 队列之前，排队期间 OFF/卸载后更新函数只检查目标身份，可能仍采用旧结果，源码支持、尚未复现，本次测试把“已排队的提交仍会落地”钉为既有行为；已领取机会后第二次开关检查关闭会直接返回，不交还机会。已合并：#19 #26 #31，以及第六刀 #92–#100（A1=#92，B1=#93，B2=#94，B3=#95，C1=#96，C2=#97，变异脚本=#98，聊天背景清理=#99，Foundation 清理=#100；逐项见各条）。
已知偶发失败（2026-10-10 登记，未调查）：全量 `npm test` 中板块三 CF-02 的 Retry 用例（断言 0 != 1）偶发失败，单独或串行重跑通过；在 #86、#89、#98 的全量运行中观察到，#100 的全量运行也出现一条“无关 Chat 合约测试”失败（未写编号，不一定是同一条）；根因未查、未修，不据此宣称业务缺陷。
第六刀阶段性收口（2026-10-10，基线 `5137d9a56099827a4289bc3dfce3cac534088e27`，#92–#100 均已合并，无开放 PR）：无代码层面的已知阻塞项，但 CI 与预览校验不完整（见下）；上述各项都只有自动化测试证据（Node/JSDOM/fake IndexedDB；C2 为本地 Chromium），无真机或浏览器验收，状态均为“已修待验”或“部分修复”，不得写成“已验证修复”。登记后延期、尚未启动：天气计时器清理测试；假绿测试专项核查；源码字符串测试清点；故障注入覆盖清单；B1–B3 旁支；CF-02 偶发；`main` 无服务端分支保护（管理决策，归 Lan）。GitHub Actions `verify` 在这些 PR 上均几秒内失败、无 runner、日志取不到，按“未运行”处理（原因未调查）；Vercel 近期受每日部署限额影响，部分 head 无预览。因此这些 PR 只有本地检查与 CodeRabbit 审查，未经远端 CI 或预览验证；是否接受这一手动例外由 Lan 决定，此处不代为记录。
放后面：Regex/WorldBook 无执行预算；prompt/流式写入无总量上限；Theme 导出可能超过自己导入上限。

## 真机验收记录（Lan，2026-10-10，iPhone）
记录的是 Lan 亲手验过的结果；录屏/截图未入库。与上表冲突时，以对应行为准并回头核对。
| 项目 | 结果 |
|---|---|
| 重开 App（F1） | 通过：先白色底色，再已保存布局，再壁纸；壁纸晚零点几秒，接受 |
| Chats ↔ Chat、联系人进聊天（F5 b/d） | 通过：`Loading…` 消失 |
| 进聊天（F5 a） | 未通过：背景与消息一起出现，但仍有一帧主题底色空帧 |
| 从联系人资料页返回聊天（F5 a 补充，#102 合并后） | 未通过：返回聊天时闪一帧白帧；点联系人名进入资料页本身很顺畅。是否既有问题、是否 #102 引入未做前后版本对照，不下结论 |
| ChatHeader 拆分验收（#102，Lan 2026-10-10 iPhone） | ①从 Chats 进聊天无首帧闪：未通过（见上两行，归因未确认）；②设置面板打开、关闭、再次打开：正常；设置关闭后的**焦点恢复**：未验（触屏无法直接确认焦点，不以“设置能再次打开”代替）；③点联系人名进入联系人资料：通过 |
| 编辑预设、联系人等时不被覆盖 | 通过（未逐项对应到上表 ID） |
| 生成中点停止 | 通过 |
| 删除角色 | 确认清单弹出；确认删除本身未试 |
| 天气/地点超时 | 未验：平时一转就出来，碰不到超时 |
| 板块四 D2/D6/D7 | 通过（记录来自 GPT 验收总结） |
| 键盘/读屏焦点规范（#73 #76） | 不纳入：Lan 决定，软件仅自用手机 |
| 离页确认（Part 5 R2，#90） | 通过（8 项，iPhone，合并后的 main 部署）：WorldBook 修改后返回弹确认；WorldBook 改回原值不弹；WorldBook 保存后返回不弹；角色资料 Cancel 与返回；联系人资料 Cancel 与返回；新建 Preset Prompt 空白返回不弹；新建 Preset Prompt 填写后返回弹；Appearance CSS 变量。未试（仅自动化覆盖）：Regex 各页面、聊天内 Custom CSS、用户资料编辑、新建角色整页 |
| 图片裁剪（Part 5 F9，#86） | 通过（回归层面）：选图→裁剪弹窗→拖动/缩放/Save crop→重开选另一张图（显示新图、缩放拖动正常）→Use original 保存当前图→取消后重开，五项均正常；聊天背景裁剪、壁纸裁剪也正常。未试：损坏图片的报错路径（手机上不方便造假图） |

## 停车场
- ChatRoom 拆分（Lan 2026-10-10 决定）：只拆 Chat Header，行为与布局不变，验收后再做在线状态/个性签名；以后做 Reaction 时再评估消息区；其余 ChatRoom 暂不重构，不做整体拆分。Header 拆分已开工（2026-10-10，基线 `a9d770de1f2b726c851426671ef5cd414b31a496`，记录见 `docs/work-status/2026-10-10-claude-chat-header-split.md`）：范围仅新增 `components/chat/chat-header.tsx`（纯展示），加载态与已加载态用同一组件、同一 key 渲染，设置按钮 ref、焦点来源记录、键盘/安全区副作用留在 ChatRoom；不改 CSS、行为与数据结构；同时把 `chat-layout-ui` 与 `contact-info` 各一条源码文字断言改为新增的挂载测试，另有一条仅因文件移动而失败的导航源码断言改读新文件。验收：真机三项（从 Chats 进入聊天无首帧闪动；打开设置再关闭焦点回到按钮；点联系人名进入联系人资料）。状态（2026-10-10 真机后更新）：#102 已合并；自动化验证（JSDOM 挂载测试、typecheck/lint/测试/build）与联系人跳转真机验收保留为通过；首帧闪屏验收未通过，但是否属于既有问题未做前后版本对照，不认定为 #102 引入，也不排除新回归；设置面板开合真机正常，焦点恢复仍为“未验”。不继续拆分 ChatRoom，不动冻结的 #36。
- 下一轮候选（只列不做，2026-10-10 整理）：F10② 空列表/无匹配提示（待 Lan 的统一 UI 整理）；R4 聊天未发送草稿离开即丢；owner 检查早于 commit 队列导致可能采用旧评论（B3 旁支）；`releaseGeneration` 抛错盖掉已提交返回值（B2 旁支）；`failureStage=provider` 包含流式写入存储失败（B2 旁支）；布局导入可能带入多个 Here & There；README/Chat Core 其余未核对段落；联系人与气泡时间导出/恢复接口只有测试调用；源码字符串测试清点与故障注入覆盖清单（待 Opus 只读核查）。
- Home 的 Add Widget、Edit Pages：Lan 与 GPT 早先留下的计划功能，目前按钮已禁用（Part 5 F11，#89），功能未开发、未删除。启用 Add Widget 时需落实 Lan 的产品决定：整个 Home 最多一个 Here & There（Part 5 R3）。
- Part 5 F10②：Chats 空列表/搜索无匹配提示。`bce4305` 曾有意移除，是否恢复待 Lan 在后续统一 UI 整理时决定（暂停，非缺陷）。
- Part 5 R4：聊天未发送草稿离开即丢；若将来不可接受再考虑按 session 持久化（见 R4 行）。
- 布局导入是否可能带入多个 Here & There：未核查（Part 5 R3 的未验证项）。
- Contacts → Contact Info → Profile：未完成的社交主页外壳仍显示 Loading。待 Profile 正式开发时处理。（只登记；本次 F7 不处理）
- ChatRoom 第二块拆分（Lan 2026-10-10 授权“只选一个边界清楚、风险低、不涉及 #36 冻结区的组件”；基线 `1498bd4`，记录见 `docs/work-status/2026-10-10-claude-chatroom-multi-select-bar.md`）：选中多选操作栏（`components/chat/chat-multi-select-bar.tsx`，纯展示），因为它只在进入多选后渲染、不在首帧路径、没有 ref/副作用/焦点/异步；不改行为与 CSS。明确未选：消息气泡与列表（在首帧路径，处理器多）、输入栏（键盘/焦点/ref 测量）、消息操作菜单与 Chat Info（焦点恢复）、编辑对话框（autoFocus + 异步保存）、输入中提示（在首帧路径的历史列表里）。状态：待审查；自动化测试，真机未验证。
#36 冻结｜备注/签名/最后在线/在线系统｜Memory 系统｜R2 备份｜固定"测试站"域名（让预览共享本地数据，避免每次重配 API）｜CI 额度用尽后的省分钟办法｜GPT 自定义指令改写
