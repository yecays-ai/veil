# VEIL 全站备份格式 v1（第 1 张：格式与只读校验）

代码基线：`yecays-ai/veil` main `1a281e33c8317f9ea9dbd71f5b700fc916dc2669`。

## 已批准产品决策（Lan，2026-10-11，UTC+08:00）

- 全站备份为 **P0**。复用现有存储结构，不整体重写。核心要求：完整、可靠校验、引用不丢失、中断可继续或回退、失败无静默损坏。
- 普通备份不包含 API Key。保留配置 ID、名称、提供商、模型、地址和绑定；未来恢复必须明确提示重新填写密钥，不能静默沿用设备现有密钥或回退到其他 API。加密凭据备份暂不开发。
- 首版范围包括空环境完整恢复和已有数据设备上的明确整站覆盖恢复；不做跨设备合并。允许耗时较长、文件较大、明确确认和重新加载页面。
- 在线系统仍在开发且暂时受阻，现在先推进备份专项；在线系统完成后基于最新 main 增量审计并补齐覆盖；**在线系统及备份均验收完成后才启动 Memory / Context**。这取代 S11 原“Memory 完成后设计备份”的延期说明，不代表在线系统完成。
- 开发及自动化测试只用模拟数据，不修改或清除真实 VEIL 数据。
- 第 1 张只授权格式定义、解析、只读校验和必要测试；无全站导出、恢复执行器、UI 或业务改动。提交 PR 后停止，等待 Lan 审查和手动合并。
- 后续施工以最新 `origin/main`、`docs/AUDIT_LEDGER.md`、执行基线及当次工单为准；MPB 为非必需背景，不作为阻塞或验收项。Vercel 每日额度耗尽时不主动追踪或重试部署，仅在实际需要 Preview 验收时告知 Lan。

## 格式边界

这是逻辑文件包契约，不是已实现的 ZIP、下载器或恢复器。入口为 `parseBackupManifest(text)` 和 `validateBackupPackage(manifestJson, files)`；后者接收调用者提供的 `ReadonlyMap<string, Uint8Array>`，其中键为逻辑相对文件路径。未来容器解包必须先限制解压数量和总大小，禁止路径穿越和重复归档条目，不能在创建 Map 时静默覆盖重复条目。

清单字段：

| 字段 | v1 规则 |
|---|---|
| `schema` / `version` | `veil.full-backup` / `1` |
| `backupId` | 非空、无首尾空白的稳定 ID |
| `createdAt` | 非负安全整数毫秒时间 |
| `sourceCommit` | 40 位小写 Git SHA；用于追溯，不是兼容性证明 |
| `credentials` | 只能为 `excluded` |
| `domains` | 下表十个域全部各出现一次，即使数据为空或文档未创建 |
| `assets` | 独立二进制图片清单，不携带临时 staging holders |

每个域文件含 JSON payload；清单条目包括 `domain/version/path/bytes/sha256/records`。长度是 UTF-8 **字节数**，SHA-256 对实际文件字节计算。未知字段、未知域和不支持版本均拒绝，不隐式迁移或截断。`null` 表示单文档键不存在，不等同于默认文档。

| 域 | 版本 | payload / records 定义 |
|---|---|---|
| foundation | 1 | FoundationDocument 或 null；存在时 1，含用户、Character、Universe、runtime |
| appearance | 1 | 整个 ThemeDocument 或 null；存在时 1，含当前及全部命名预设、Widget 绑定和评论 |
| bindings | 1 | BindingDocument 或 null；存在时 1；保留省略/null/空列表语义 |
| presets | 3 | PresetDocument 或 null；Preset 数量 |
| regex | 1 | RegexDocument 或 null；Group 数量 |
| worldbooks | 1 | WorldBookDocument 或 null；Book 数量 |
| contacts | 1 | ContactDocument 或 null；Contact 数量，含备注变更和内联背景 |
| presence | 1 | 当前 main PresenceDocument 或 null；Character 记录数量 |
| chat | 1 | `{sessions,messages,chatSettings,worldBookStates}`；四个数组记录数之和 |
| apiConfigs | 1 | `{id,name,provider,baseUrl,model}[]`；配置数量；禁止 `apiKey` 和额外字段 |

这些版本不是数据库名称后缀，也不是 IndexedDB 内部版本。API Key 排除是配置字段契约，并不声称能发现或清除用户在聊天正文、自由文本或 URL 中自行写入的秘密。

图片条目包括 `domain/id/path/bytes/sha256/mime/createdAt`；域只能为 appearance 或 chat。保留原 ID；appearance ID 必须等于字节的 SHA-256，chat 保留原始 ID。相同 ID 可在两个图片域中分别存在。图片字节不重新编码、不执行浏览器解码；哈希证明传输完整性，不证明图片可显示。头像和 Contacts 内联图片继续留在原文档内。

当前防资源耗尽边界：清单最多 4 MiB、单域 JSON 最多 128 MiB、包内声明文件总量最多 1 GiB、图片最多 10,000 个、JSON 嵌套最多 64 层。超限明确失败；这些是当前校验实现上限，不是用户数据裁剪规则。全站导出前若真实规模超过上限，另行评估并调整，不静默丢记录。该接口不是流式实现，实际 iPhone 可承受规模尚未测试。

## 只读校验保证与限制

- 不加载浏览器数据、不写 localStorage/IndexedDB、不查询设备凭据、不 fetch、不调用模型。仅验证传入文件；不发布到任何 UI。
- 重复 JSON 成员（包括转义后相同的键）、危险对象键、非有限数值、无效 UTF-8、缺失/额外文件、长度/摘要/记录数不符均拒绝。错误只含固定代码及域/数组位置，不回显正文、密钥、URL 或原生解析错误。
- 复用已有纯校验/归一化函数，但对原数据与结果做严格结构比较；会补默认值、截断、改 ID、丢未知字段或修复布局时**拒绝**，不返回修复后的数据。Contacts 在归一化前检查现有 ID，不生成缺失 ID。
- 引用只对本包检查：Character、会话、消息、Binding 资源、当前及命名外观预设图片、聊天全局和会话背景。禁止重复私聊、消息序号冲突、跨会话引用；空群 `characterId:""` 合法。
- 已删除消息的 quote 预览本来就是持久化快照：保留并给 `missing-quote` 警告。`requestedBy` 只引用消息；`turnId` 只按回合命名空间校验；`attemptFor` 按当前写入语义 `target.turnId ?? target.id`，优先使用幸存回合归属，旧消息无回合时回退消息 ID。回合/重试目标允许已删除，但存在的目标不能属于另一会话。WorldBook 激活状态可因正常编辑变为旧状态，保留原样；后续应用按原有兼容规则使用，不在校验中清理它。
- 普通完整包缺少必需 Character/资源/图片时拒绝。历史残余不被删除；本张不提供抢救包或残余清理流程。
- 每个 API 配置产生 `credentials-required` 警告；外部图片 URL 产生 `external-image` 警告，不下载外部资源，不能宣称图片离线可用。
- 活跃 generation 和 streaming 不属于 v1 静止快照；拒绝而非停止请求、改消息或复活生成。未来导出一致性工单决定何时取得静止快照。
- 校验通过不等于可信来源、加密、跨域原子恢复或真机可恢复；本张没有恢复能力。未来恢复需确保使用的字节和已校验字节一致，不能把一次校验当成之后可变输入的永久授权。

## 扩展与后续边界

开放 PR #117 的 `situationChange` 尚不属于本基线，v1 不静默忽略它；该 PR 合并后应按最新 main 有界补核并更新备份域契约和测试。未来 Memory、Character State、Journal 各加独立域、域版本和引用规则；本张不建这些业务。未知域拒绝确保旧校验器不会把未来完整包误判为已完整覆盖。

下一张及以后才处理全站读取、容器编码、快照协调、恢复预览、恢复日志/继续/回退、空环境及覆盖恢复、用户入口和 iPhone 验收。该列表是范围边界，不是自动启动授权。
