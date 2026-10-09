# STATUS — 2026-10-10-codex-profile-view-scroll-container

更新人：Codex
更新时间：2026-10-10T01:00:00+08:00
发现范围：2026-10-10 00:40–00:56 +08:00，核查远端 main `9919b3a`、GitHub 开放 PR 列表（空）、远端分支及其相对 main 文件清单；无其他分支修改 `components/profile-view.tsx`，`fix/nav-contact-info-reentry` 只改 `profile-pages.tsx` 等导航文件，与本修复无文件重叠。读取 ProfileView、ProfilePages、PageShell、滚动 CSS、相关测试及 work-status 规范；用 main 挂载复现。本地 Node/JSDOM 验证；没有 iPhone Safari 访问。

## 当前任务

进行中：修复原始 Part 5 / F8 的 ProfileView 页面滚动容器定位。

## 谁在改哪里

Codex；分支 `fix/profile-view-scroll-container`；PR 尚未创建；base main `9919b3a27465823a0e95c279b01fe3e2af8ca24e`。仅 `components/profile-view.tsx`、新增挂载测试及本 work-status。

## 已完成

- 最新 main 的 `ProfileView` 仍在挂载时滚动 `.phone-content`；该容器在 `app/globals.css` 是 `overflow: hidden`。页面实际滚动容器是 `PageShell` 的 `.app-page-body`（`app/page-shell.css` 的 `overflow-y: auto`）。
- 新挂载测试在 main 旧实现上，用户资料与角色资料均复现：编辑页将 body 滚到 219 后取消，返回展示页 body 仍为 219。
- 最小修复使用 ProfileView 自身 header 查找祖先 `.app-page-body` 并将 `scrollTop` 立即设为 0；没有改 PageShell。StrictMode 下用户/角色资料 Edit→Cancel、重复进入均通过，phone-content 与无关滚动容器保持原位置。
- 定向 ProfileView + navigation-reentry 挂载测试 9/9 通过；应用及测试 TypeScript 通过；目标 ESLint 0 errors；diff check 通过。
- 首轮全套 763 项，762 通过、1 个 Chat Retry 测试偶发失败；该文件单独复跑 11/11 通过，随后全套复跑 763/763 通过。
- 应用与测试 TypeScript 通过；目标 ESLint 0 errors/0 warnings；`git diff --check` 通过。

## 尚未验证

- CodeRabbit 尚未审查。
- CI 未运行；Vercel 额度不作为阻碍；iPhone Safari 真机未验。

## 下一步

完成全套检查，提交此记录与实现到独立 F8 PR，请 CodeRabbit 审查并处理有效意见；保持 PR open、人工合并。
