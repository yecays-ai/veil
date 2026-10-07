# Lifecycle regression contracts

Contracts are ordinary `node:test` behavior tests with stable metadata, not a second
test suite. `npm test` still runs the existing compiled tests and fails normally on
assertion failures. Its additional reporter writes
`node_modules/.cache/veil-regression-contracts.json`; existing CI uploads this file
as `lifecycle-regression-contracts`, including when a test fails.

Use `regressionContract(id, category, title, check)` from
`tests/regression-contract.ts` to mark a demonstrated lifecycle invariant. IDs must
be unique across the repository and stable across title/file changes. Categories
are `storage-read-budget`, `render-lifecycle`, `subscription-hygiene`, and
`async-race-safety`. Keep assertions close to the existing domain tests and use
real storage adapters, counted events, or controlled promises rather than timing
benchmarks or source-string checks. Do not add suites just to populate categories.

The first contracts cover Contacts/Bindings shared hydration, snapshot identity
and read counts through simulated route subscribe/unsubscribe cycles, consumer
cleanup with one app-session event pair, and obsolete async success/error
suppression. App-session window listeners intentionally survive route gaps.
These are store lifecycle checks, not mounted React/router or iPhone acceptance.

The versioned JSON contract is:

```json
{
  "schemaVersion": 1,
  "project": "rendering-navigation-lifecycle",
  "contracts": [{ "id": "contacts-bindings.shared-hydration", "category": "storage-read-budget", "status": "passed" }]
}
```

Rows sort by ID and contain no timings, stack traces, document contents, or secrets.
Status is `passed`, `failed`, or `skipped` (including TODO); absent IDs are not
evidence of a pass. Duplicate IDs fail reporting. Consumers must also check the
overall test/CI outcome: failures before a test is registered can leave rows absent.
Future maintenance slices should tag an existing meaningful test or add one
focused behavior test, retain the ID when moving it, and extend this report
contract only when a concrete consumer needs new fields. No runtime dashboard,
repair tools, broad suites, or production observability seams are introduced here.
