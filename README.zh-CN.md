# VEIL

> A phone across worlds.

[English](README.md)

VEIL 是一部住在浏览器里的陪伴手机。你可以创建 Characters、搭建他们的世界、和他们聊天、让他们拥有记忆，也可以把整部手机装扮成自己喜欢的样子。

它本地优先、移动端优先，也不预设任何 Character 的身份。VEIL 提供手机和系统，而人物、故事、提示词与世界都属于你。

## ✨ 里面有什么？

| | |
| --- | --- |
| 💬 **Messages** | 私聊与群聊、流式回复、引用、搜索、消息操作、重试、自定义背景和单会话样式 |
| 🧠 **Memory** | 每个 Character 独立的 Memory、Journal、State、History、滚动摘要、手动编辑、撤销与可选自动维护 |
| 🌌 **Characters & Universe** | Character 资料、人物关系、共同历史、Presence、日常情境和可拖动的关系图 |
| 🪪 **Profile & Contacts** | 你的资料、Character 联系人、备注、联系人背景、Last Seen 和快捷聊天入口 |
| 🎨 **Appearance** | 壁纸、颜色、字体、图标、Dock 样式、布局、Widgets 和可复用的主题预设 |
| 🏠 **Home Screen** | 多页 App 网格、可编辑 Dock、可调整尺寸的 Widgets，以及桌面和移动端的手机体验 |
| 🧩 **创作工具** | Presets、Text API、Bindings、WorldBooks、Regex 规则和聊天上下文调节工具 |
| 💾 **Backup & Restore** | 整站 ZIP 备份、文件校验、恢复预览、回滚和中断恢复 |

## 💬 会记得事情的聊天

Messages 不只是一个普通聊天框。VEIL 会把聊天记录保存在设备中，支持私聊、群聊、引用、搜索、多选操作、继续或重新生成回复、气泡节奏、聊天背景和自定义 CSS。

构建 Character 回复时，VEIL 可以组合当前会话、Character 与 Universe 信息、人物关系、Presence 与 State、已激活的 WorldBook，以及和本轮对话有关的 Memory。Bindings 决定每个 Character 或 App 使用哪套 API、Preset、WorldBooks 和 Regex 规则。

发送消息和请求 Character 回复是两个独立动作。即使模型请求失败或被取消，已经保存的用户消息也不会丢失。

## 🧠 Memory 有自己的家

每个 Character 都有独立的 Memory 空间，分成四个页面：

- **Memories**：长期事实与经历；
- **Journal**：由用户写下、通过关键词触发的笔记；
- **State**：Character 此刻正在经历的事情；
- **History**：较早或已被替代的记忆。

你可以新增、编辑、删除、搜索、筛选和撤销 Memory 变更。可选的 Memory Maintenance 会在新对话积累到一定数量后整理记忆；它只会在 VEIL 打开时运行，可以单独选择模型，也不能覆盖受保护的手动记忆。

每条回复还可以查看它当时实际获得了哪些 Memory 和 Journal 内容。

## 🌌 不只是联系人列表，而是一个世界

VEIL 里有一个 User、多个 Characters，以及一个共享 Universe。

- Character 资料会分别保存外观、背景故事、性格、说话方式、生活设置、State 和 Presence。
- Universe 保存世界信息、有方向的人物关系、关系类型、共同历史和关系图位置。
- Presence 根据时区与作息展示情境、状态和 Last Seen。
- Character 可以通过受支持的聊天动作更新自己的部分情境。
- 删除 Character 时，会协调清理联系人、聊天、群成员、Bindings、Widgets、Presence 和 Memory。

## 🎨 把手机变成自己的样子

Appearance 只负责手机的外观，不会把装饰数据混进 Character 资料。你可以调整颜色、字体、壁纸、图标、Dock、透明度、模糊、位置和布局，也可以用命名预设保存完整外观快照。

Home Screen 支持多页布局、无需拖拽的网格编辑、防碰撞摆放、可编辑 Dock 和可调整尺寸的 Widgets。**Here & There** 可以显示 User 与 Character 的时间、位置、天气和可选的模型评论。

**Moments** 目前只有空页面框架，还不是能真正发布内容的社交动态功能。

## 🔒 数据留在你的浏览器里

VEIL 没有账号系统、云同步，也不会在服务器保存一份本地应用数据。资料、对话、Memory、设置和图片都属于当前网站在浏览器里的存储。

只有功能需要时，VEIL 才可能发出网络请求：

- 你配置的 OpenAI-compatible 服务，用于聊天和可选的生成能力。聊天请求会把对话上下文和你的 API Key 直接发送给该服务；
- 保存了位置并请求天气时使用的 Open-Meteo 天气或地点查询；
- 你自己选择展示的外部图片地址。

这个仓库里没有 VEIL 自有的遥测服务。

### 记得备份

清除网站数据会删除 VEIL 的本地数据。可以通过 **Settings → Backup & Restore** 下载经过校验的 ZIP 备份。

备份会包含受支持的应用数据和本地图片，但永远不会包含 API Key。导入是替换当前设备数据，不是合并。VEIL 会先预览并校验文件，在替换期间保留安全副本；恢复被中断后，也可以继续或回滚。

备份文件没有加密，里面可能包含私密对话、资料、Memory、位置和图片，请放在安全的地方。

## 📱 添加到 iPhone 主屏幕

VEIL 提供 Web App Manifest、Apple 独立模式 metadata、安全区支持和 iOS standalone fallback。通过 Safari 的 **分享 → 添加到主屏幕**，可以获得更接近原生手机的展示方式。

目前还没有 Service Worker 和内置安装图标。部署信息变化后，需要删除旧快捷方式再重新添加。自动化测试只能提供初步证据，iPhone 上的实际效果仍需要真机检查。

---

## 🛠️ 给开发者

### 技术栈

- Next.js 16 App Router
- React 19
- TypeScript 5
- 浏览器 `localStorage` 与 IndexedDB
- Node test runner、JSDOM、fake IndexedDB 与 Playwright

VEIL 的基础功能不需要后端或环境变量。模型凭据由用户在浏览器中本地配置。

### 快速开始

使用 Node.js 24.x 和 npm。

```sh
npm ci
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000)。

Foundation、Home、Appearance、Contacts、本地编辑器和已有数据都不需要模型服务。若要生成文本，请在 **Settings → Text API** 添加 OpenAI-compatible 配置，再全局选择，或通过 **Settings → Bindings** 指定。

### 代码怎么组织

```text
Next.js 路由
    ↓
React 功能组件与 Providers
    ↓
Chat / Memory / Presence / Foundation / Theme / Backup 服务
    ↓
存储适配器与协调写入
    ↓
浏览器 localStorage + IndexedDB
```

| 路径 | 用途 |
| --- | --- |
| `app/` | 路由、布局、metadata、manifest 和全局样式 |
| `components/` | 产品 UI、Providers、对话框、Widgets 和设置页面 |
| `lib/chat/` | 会话、消息、模型请求、Prompt、上下文和聊天行为 |
| `lib/memory/` | Memory 存储、检索、摘要、Journal、State 和维护 |
| `lib/presence/` | 作息、情境、笔记、动作和实时 Presence |
| `lib/backup/` | 备份包、快照、校验、恢复、回滚和中断恢复 |
| `lib/` | Foundation、主题、Contacts、资源、Bindings 和共享领域逻辑 |
| `tests/` | Node、JSDOM 和 fake IndexedDB 回归测试 |
| `e2e/` | 本地 Playwright 浏览器冒烟测试 |
| `docs/` | 架构说明、审计证据和任务交接 |

`app/layout.tsx` 持有长期存在的应用外壳。它会在中断恢复期间阻止普通启动，加载产品默认项和可选的 Memory Maintenance，再挂载手机、主题、Foundation 与明确启用的诊断 Providers。

App 列表只有一个事实来源：`lib/app-registry.ts`。不同数据域拥有各自的存储权威；React Provider 与缓存只是视图，不是备份。

### 存储速览

| 数据 | 持久化权威 |
| --- | --- |
| 外观元数据、Contacts、Bindings、Presets、Regex、WorldBooks、Presence | `localStorage` 文档 |
| User、Characters、Universe | IndexedDB `veil-core-v1` |
| 聊天、消息、设置和聊天图片 | IndexedDB `veil-chat-v2` |
| Memory、Journal、历史、操作记录和维护状态 | IndexedDB `veil-memory-v1` |
| Text API 配置与密钥 | IndexedDB `veil-api-config-v1` |
| 外观图片字节 | IndexedDB `veil-appearance-images-v1` |

请保持这些数据域相互独立。存储修改必须有明确的迁移和清理行为；方便使用的 React 快照永远不是第二份持久化权威。

### 检查命令

```sh
npm test
npm run typecheck
npm run lint
npm run build
```

聚焦测试与浏览器检查：

```sh
npm run test:mutations
npm run test:memory
npm run test:browser
```

`npm test` 还会把当前生命周期回归契约写成 JSON。`test:browser` 会在端口 `3123` 启动隔离构建，使用全新的 Chromium context，不调用模型，也不会接触真实数据。首次使用需运行 `npx playwright install chromium`，或设置 `PLAYWRIGHT_CHROMIUM_EXECUTABLE`。

### 推荐阅读

- [仓库 Agent 指南](AGENTS.md)
- [Chat Core v1](docs/chat-core-v1.md)
- [备份格式](docs/backup-format-v1.md)与[备份入口](docs/backup-entry.md)
- [Memory 构建](docs/memory-m5a-construction.md)与[Memory 集成](docs/memory-m6-p2-integration.md)
- [生命周期回归契约](docs/regression-contracts.md)
- [当前审计总账](docs/AUDIT_LEDGER.md)

历史报告只描述它写作时的版本。出现冲突时，以当前源码和当前审计总账为准。

### 部署到 Vercel

导入仓库根目录，选择 Next.js preset 和 Node.js 24.x，保留默认安装与构建命令即可。基础应用不需要环境变量。Text API Key 保留在每个浏览器本地，不属于部署 Secret。

### 提 PR 之前

- 阅读 `AGENTS.md` 和相关领域说明。
- 除非任务明确包含迁移，否则必须保留已有用户数据。
- 每个请求、订阅和后台任务都需要所有者、清理路径和有限生命周期。
- 为变更行为补充聚焦回归测试。
- 将源码阅读、自动化测试、浏览器检查和真机验收视为不同证据等级。
- 保持 PR 聚焦，把合并与发布决定留给仓库所有者。
