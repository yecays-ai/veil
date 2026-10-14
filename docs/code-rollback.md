# Rolling back a code change

This covers one thing: returning the **code** to the previous stable version. It is not a data rollback; nothing here touches anyone's browser data.

1. On GitHub, open the merged pull request and note its merge commit.
2. Open a revert pull request: use the **Revert** button on the merged PR, or branch from `main` and run `git revert -m 1 <merge-commit-sha>` and push that branch.
3. Never push to `main`. The revert goes through the normal CI and review like any other PR, then is merged with the merge API.
4. Merging is not the same as deploying. If Vercel deploys `main` automatically, the merge is what ships the revert; the owner decides whether to promote or redeploy anything else.
5. Check the revert on the preview before relying on it. If the original change was already deployed, treat the revert as a new release.

## What a code rollback does not undo

- **Data in the browser.** IndexedDB and local storage keep whatever the newer code wrote. Reverted code must still read it.
- **Newer backup files.** Backup validation accepts only the fields it knows. If the reverted version is older than a change that added a persisted field, it may refuse to restore a backup exported by the newer code. Export a backup with the version you intend to restore it with.
- **Anything outside the repository**, such as Vercel project settings or provider configuration.

If a change must be undone together with data it wrote, that needs its own deliberate plan; do not improvise one from this page.
