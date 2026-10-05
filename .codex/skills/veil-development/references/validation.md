# Repository checks

Run from the VEIL repository root. Recheck package.json if scripts have changed.

```sh
npm test
npm run typecheck
npm run lint
npm run build
git diff --check
```

`npm test` compiles with tsconfig.tests.json and runs scripts/run-tests.mjs. Typecheck uses `tsc --noEmit`; lint uses `eslint .`; production build uses `next build`.

If npm is unavailable but Node and installed dependencies are available, invoke the same underlying commands, checking each exit status:

```sh
node node_modules/typescript/bin/tsc --project tsconfig.tests.json
node scripts/run-tests.mjs
node node_modules/typescript/bin/tsc --noEmit
node node_modules/eslint/bin/eslint.js .
node node_modules/next/dist/bin/next build
git diff --check
```

After route removal, stale generated `.next/types` can reference the deleted route. Regenerate them with the production build and rerun typecheck; do not change application code to satisfy stale generated declarations.

Before committing, review the diff and run `git diff --cached --check` on staged task files. After pushing, verify the commit SHA and worktree status. Do not claim mobile acceptance from tests or a desktop browser.
