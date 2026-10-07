# PR #16 auto-merge audit

All times below are UTC on 2026-10-07. The manual merge is not workflow acceptance.

## Recorded pre-merge sequence

- 10:21:00: `automerge` label added; no subsequent removal. PR was same-repository, non-draft, targeting main.
- 10:36:49: CodeRabbit submitted its sole formal review, on initial head `325c8539c90965fa20ad4512b724db5a89e177ef` ([review](https://github.com/yecays-ai/veil/pull/16#pullrequestreview-5441060173)).
- 11:01:30–11:02:31: [final CI](https://github.com/yecays-ai/veil/actions/runs/37611278074) succeeded. Checkout logs explicitly test `55c854afa50d4b7dbc63f3b8447bc0404d8e4696` merged into base `511e637b679e0d33b3bd41182667a9481d8804cc`.
- 11:01:47 / 11:01:49: the two review comments were updated with `Addressed in commit 55c854a`. Their threads are resolved by CodeRabbit. These are comment-update times, not independently recorded resolution timestamps.
- 11:14:01–11:14:09: [scheduled recheck](https://github.com/yecays-ai/veil/actions/runs/37612693023) ran while CodeRabbit's final-head status was still pending.
- 11:14:39: CodeRabbit posted a success status on final head, description `Review completed`, creator `coderabbitai[bot]` ([statuses](https://api.github.com/repos/yecays-ai/veil/commits/55c854afa50d4b7dbc63f3b8447bc0404d8e4696/statuses)). No second formal review was submitted.
- 11:14:41–11:14:48: [completion-triggered auto-merge](https://github.com/yecays-ai/veil/actions/runs/37612765194) ran successfully but did not merge.
- 11:19:47: user manually merged. No recorded scheduled run occurred between final CodeRabbit completion and manual merge.

## Proven blocker and evidence limits

The old workflow required a CodeRabbit formal review with `commit_id === pull.head.sha`. The sole review remained on the initial head, so this condition was necessarily false after the final fix, even with successful final-head CI and resolved threads. CodeRabbit's actual incremental review behavior invalidates that requirement.

The completion event was delivered; missing triggers do not explain this instance. Scheduled discovery selects open, labeled main PRs, which included #16 at the last pre-merge schedule, but that run preceded review completion. The old logs did not report candidates or gate outcomes, so they cannot prove which earlier `continue` executed first or reconstruct the exact historical API response. CI run associations are now empty after merge/branch deletion; this must not be mistaken for their pre-merge state or used to relax CI validation.

## Narrow correction and regression

Current-head freshness comes from the latest status fetched for the exact head: it must be successful, authored by CodeRabbit, and explicitly say `Review completed`. A submitted, non-blocking CodeRabbit formal review is still required, but may precede incremental fixes. Latest blocking reviews across heads and every unresolved thread still block. CI lookup, label, draft, same-repository, main target and SHA-guarded merge remain unchanged. Repository branch-deletion configuration is untouched.

`tests/safe-pr-auto-merge.test.ts` executes the actual embedded workflow script. The #16 fixture keeps the initial formal review unchanged while progressing through unfinished CI, completed CI, resolved threads, and final-head review completion. Only the final completion event (or subsequent schedule) requests a merge using the final SHA. Negative cases retain incomplete/skipped/spoofed review, unresolved findings, blocking reviews, stale completion and stale/wrong CI protections. Minimal gate logs make future no-op runs observable without logging review contents.

These deterministic tests prove the workflow's merge request, not a live GitHub merge. CI/review on the diagnostic PR remain separate acceptance; it must not be manually merged as proof.
