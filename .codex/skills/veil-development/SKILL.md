---
name: veil-development
description: Implement and validate scoped changes in the VEIL repository using its existing architecture, regression checks, and delivery workflow. Use for VEIL development tasks; read-only reviews do not authorize edits or releases.
---

# VEIL Development

## Scope and implementation

- Follow the current task and applicable AGENTS.md instructions. Task-specific product decisions belong in the task, not this skill.
- Inspect the relevant implementation, callers, persistence boundaries, and tests before editing. Check the worktree and preserve unrelated changes.
- Make the smallest scoped change that satisfies the task. Do not invent adjacent features or perform unrelated cleanup.
- Preserve existing architecture, data contracts, and working behavior unless the task explicitly changes them. Prefer existing helpers and components.
- Add or update regression tests for changed behavior, covering meaningful outcomes and failure boundaries.

## Validation and delivery

Read [references/validation.md](references/validation.md) when validating or preparing delivery. Use the actual package scripts and complete tests, TypeScript checks, lint, production build, and diff checks.

Fix failures introduced by the change and rerun affected checks. Report unrelated failures or unavailable checks accurately; do not expand scope to fix them.

Desktop and headless visual checks are preliminary evidence for mobile UI. iPhone testing is final acceptance for mobile-specific behavior; state clearly when that acceptance remains unverified.

For completed implementation work, commit and push after validation unless the task explicitly requests otherwise. Inspect the final diff, stage only task files, use a concise commit message, and push the intended branch without force-pushing. This workflow does not authorize commits or pushes during read-only reviews or tasks that prohibit them.

Report changed files, the resulting behavior, validation results and limitations, commit SHA, push result, and final worktree status. Stop at the requested delivery boundary.
