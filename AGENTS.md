# VEIL — Repository Agent Guide

VEIL is a small, local-first companion phone application. This repository, `yecays-ai/veil`, is the canonical repository. Confirm the repository before editing; do not make changes in forks or reference repositories unless asked.

## Product principle

Keep VEIL understandable, observable, testable, and maintainable. Prefer the smallest architecture that cleanly solves the demonstrated problem.

- Inspect the current implementation and its boundaries before proposing changes.
- Remove duplicate work and fix ownership before adding abstractions, caches, synchronization, registries, event systems, or background machinery.
- Do not build speculative frameworks or compatibility layers. A possible risk alone is not evidence for a subsystem.
- Preserve simple replacement and deletion paths. Consider how feature data, subscriptions, requests, and background work are cleaned up.
- Measure before optimizing; performance changes need evidence and a regression check.

## Data and local-first behavior

Browser data belongs to the user. Treat Character, User, Universe, chat, appearance, and other persisted data as valuable.

- Keep unrelated data domains and storage boundaries separate.
- Storage changes must preserve existing data unless the task explicitly authorizes a migration or deletion.
- Migrations, imports, exports, backups, restores, and recovery paths must be deliberate, validated, and failure-safe. Do not silently overwrite or discard user data.
- Keep secrets out of source, logs, client bundles, and diagnostics. Minimize sensitive diagnostic content.
- Do not introduce a server dependency or network request where local behavior is sufficient.

## Storage, performance, and async work

- Avoid repeated storage reads, redundant API/model requests, unnecessary rerenders, duplicate subscriptions, and cross-tab races.
- Keep IndexedDB work within clear transaction and ownership boundaries; do not perform unrelated asynchronous work inside a transaction.
- Every background task or subscription needs a clear trigger, owner, cancellation/cleanup path, and bounded lifetime.
- Preserve cancellation and stale-response handling for async UI and AI requests.
- Add caching only when measured behavior justifies its invalidation and memory costs.

## AI requests and context

- Keep provider requests explicit and avoid duplicate calls, hidden retries, or unbounded work.
- Build context from the intended Character, conversation, and relevant data only. Respect context budgets and avoid loading or repeating unrelated history.
- Keep prompts and generated context focused. Do not add prompt layers or abstractions without a concrete need.
- Handle provider errors and cancellation without losing user-authored or persisted data. Never expose API keys.

## Git and GitHub workflow

- When direct Git network operations such as `fetch`, `pull`, or `push` fail or time out because the execution sandbox cannot reach GitHub, do not repeatedly retry the same failing transport or troubleshoot or modify the user's Git, SSH, credentials, DNS, proxy, or remote configuration when those configurations are otherwise known to be valid.
- Use the available GitHub integration/API for remote repository operations instead and continue the original task without asking the user to manually intervene.
- If the execution environment is already known to restrict direct GitHub network access, prefer the GitHub integration/API immediately rather than attempting the known-failing transport first.
- A direct Git transport failure alone is not a reason to stop the task when an authorized GitHub integration/API path is available.
- Every PR is merged manually by the repository owner. Do not add the `automerge` label, enable auto-merge, or call the merge API, however ready the PR looks, unless the owner explicitly asks for that specific PR.
- When CI or a preview cannot run because of account or billing limits, report those checks as not run (never as passed), name each one, and give the local substitute check with its command and version.

## Changes and verification

- Keep changes within the requested scope. Do not opportunistically refactor neighboring features.
- Prefer existing project conventions and dependencies; explain any new dependency or architectural boundary.
- Add or update focused behavior tests for changed logic, especially storage, migrations, request counts, cancellation, and data safety.
- Run the relevant checks. The repository provides `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build`.
- Report what was checked and any environment or device behavior that remains unverified.
- Keep commits focused. Do not call the merge API, enable auto-merge, add the `automerge` label, or publish a release unless explicitly requested for that specific PR; the owner merges PRs manually.

## Scoped checks by default

These rules apply to every AI development task (Codex, Claude Code, and others). Lan set them on 2026-10-12.

- **Default scope.** Check the task's files first, then their direct dependencies, then the affected interfaces, then targeted tests, then any regressions the change needs. A local task never means scanning the whole repository. Read the existing architecture docs, `docs/AUDIT_LEDGER.md`, and the relevant module docs first. Don't re-explore structure that is already documented.
- **Test tiers.**
  - *Everyday UI or small feature changes.* Check the changed files and the components they directly affect. Run targeted tests, the typecheck, and lint on what changed. Don't run a repository audit or the full test suite by default.
  - *Cross-module changes.* Check the modules and data flows that are actually affected, and run those modules' regressions. Widen testing only where a clear impact calls for it.
  - *High-risk changes* (backup, restore, data deletion, authentication, credentials, storage migration). Focus on the affected safety boundaries and write paths, and run targeted safety regressions. One full test-suite run is allowed when there is a good reason. A full test-suite run is not a source audit of the repository.
- **Repository-wide audits.** Consider one only in three cases: the user explicitly asks for it; the core architecture is being restructured at scale; or there is concrete evidence that a problem spans several unknown modules and local checks cannot locate it. Before widening any check, state the reason, the scope, and the expected benefit, and wait for the user's authorization.
- **Quota and context.**
  - Don't repeatedly read the whole repository or regenerate a site-wide architecture analysis that already exists.
  - Don't re-map every module for a single problem, or expand large numbers of source files indiscriminately.
  - Prefer file paths, symbol search, `git diff`, existing tests, and earlier audit evidence.
  - For large logs, read only the failure summary and the relevant excerpts.
  - Reuse earlier results instead of starting from zero when a different agent picks up the task.
  - Don't add unrelated scans for the sake of coverage.
- **New findings.** You may record a real problem you notice in passing. It needs a minimal reproduction or specific code evidence (`file:line`). Say whether it blocks the current task or is an unrelated side issue, and give its risk level and practical impact. Don't widen the scope of work without the user's authorization. Don't open a new repository-wide audit on your own, and don't keep extending a project that has met its acceptance criteria.

## AI collaboration handoff

- At startup, read this guide, applicable nested agent guides, and [work-status conventions](docs/work-status/README.md). Confirm `yecays-ai/veil`, the current branch/base, and local changes before editing.
- Before editing, fetch and record the full SHA of the latest `origin/main` (or its GitHub API equivalent) and your branch's base. A document that says it was checked against another SHA may be stale until the relevant parts are re-verified; say which SHA you actually read.
- Discover parallel work from current remote open PRs (including drafts), their changed files and head branches, and task records on those branches as well as the default branch. Record when and where you checked; local files and a PR list alone are not a global registry. If remote discovery is unavailable, say so and treat ownership as unknown.
- Before editing overlapping paths, coordinate through the task/PR or choose a non-overlapping scope. Do not overwrite another task's work or handoff record.
- Maintain one uniquely named `docs/work-status/<task-id>.md` per task/PR on its own branch, using [TEMPLATE.md](docs/work-status/TEMPLATE.md). Keep its filename stable when a PR is assigned, and add the PR link in the record. Do not create a shared root STATUS file or a shared mutable task index.
- Publish the initial record with the task's first commit/push so others can discover it. Refresh it when ownership, scope, blockers, or verification changes, and before stopping or handing off. Rewrite the snapshot rather than appending a log; commit and push it with the task's changes.
- Include updater, timezone-qualified update time, branch/PR, touched paths, verified evidence, unverified behavior, and next step. Mark finished, blocked, paused, or superseded work explicitly. Check suspected stale records against live PR/branch state; age alone does not authorize takeover, deletion, or edits to someone else's record.

## Audit status and evidence

- `docs/AUDIT_LEDGER.md` is the single current audit ledger. Read it from the latest `origin/main`, not from pasted summaries, chat memory, or old local copies. Do not create a second ledger or a root STATUS file.
- Historical audit reports, PR descriptions, and old tickets keep their original state and are not the final source for current status. When they conflict with the ledger, check time, target, and evidence before changing either; never overwrite a newer "verified" with an older "pending".
- Name the evidence level when reporting status: source reading or an audit report; an automated test (JSDOM, fake IndexedDB, headless browser); or real-device acceptance (owner-reported or recorded). They do not substitute for one another, and a fix is never called device-verified from source reading or tests alone.
