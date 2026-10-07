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

## Changes and verification

- Keep changes within the requested scope. Do not opportunistically refactor neighboring features.
- Prefer existing project conventions and dependencies; explain any new dependency or architectural boundary.
- Add or update focused behavior tests for changed logic, especially storage, migrations, request counts, cancellation, and data safety.
- Run the relevant checks. The repository provides `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build`.
- Report what was checked and any environment or device behavior that remains unverified.
- Keep commits focused and do not merge or publish a release unless explicitly requested.
