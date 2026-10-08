# AI task handoffs

These files are short, per-task snapshots for GPT/Codex, Claude, and human collaborators. They describe what an updater observed on a particular branch at a particular time. They are not locks or an authoritative global task registry.

## Start and discover parallel work

1. Confirm the repository is `yecays-ai/veil`; read root and applicable nested agent guides. Check the current branch, base revision, and uncommitted changes.
2. Refresh remote information without discarding local work. List open PRs, including drafts, and inspect their changed files and head branches. Read `docs/work-status/*.md` on the default branch **and on relevant PR heads**; an unmerged record will not appear on main. Look at recent remote branches/commits for tasks that have not opened a PR yet, and read their records where available. Use the GitHub integration/API when direct Git transport is restricted.
3. Cross-check records against live PR state, head revision, changed paths, and recent activity. Note discovery time and sources in your own record. A missing record does not mean a module is free. A local checkout or an open-PR search can miss unpublished tasks; if remote access fails, state the limitation and treat ownership as unknown.
4. For overlapping paths, coordinate in the relevant task/PR before changing them, or narrow your work to independent paths. Do not infer permission to take over from silence or a stale timestamp.

## One file per task

Copy [TEMPLATE.md](TEMPLATE.md) to `<task-id>.md`, for example `2026-10-08-codex-ai-handoff.md`. Use a unique date/agent/topic or task ID, check for filename collisions, and keep the filename stable after receiving a PR number. Add branch and PR links inside it. Continue an existing task's file only when explicitly handing over that same task.

Publish the first snapshot on the task branch with its first commit/push. Update only your task's record when scope, ownership, blockers, or checks change and before stopping/handoff; overwrite the snapshot, then commit/push it with your changes. Git history provides the log. Do not maintain a shared STATUS file or mutable index, edit other active records, or bulk-create records claiming ownership of other PRs.

Use timezone-qualified timestamps (for example `2026-10-08T11:30:00+08:00`). Identify the updater, observation sources/time, and base or tested revision where useful. Record real checks and their outcomes; anything not exercised on a preview/device stays under **尚未验证**, even if automated tests pass. Documentation-only work can state device checks are not applicable.

## Stale and finished records

Treat an active record older than 48 hours, a record whose linked PR is closed/merged, or one inconsistent with the live diff as **possibly stale**, not proof that work is abandoned. Verify live PR/branch activity and clarify ownership before overlap. Do not automatically delete, reassign, or update another task's file.

Before finishing, mark your record completed, blocked, paused, or superseded in **当前任务**, explain remaining work, and link any successor. A merged record may still say “awaiting CI/review” because its last update preceded merge; live GitHub state determines PR completion. Retain finished snapshots as history; readers should filter them using live PR state rather than treating every file on main as active.

This is a lightweight human/AI convention, not an enforcement service. Unpublished local work remains invisible, and each discovery pass has a stated scope and time.
