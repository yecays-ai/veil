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

Chat critical-path contracts additionally cover read-only existing-session hydration
overlapping Foundation, publication and creation only after character validation,
one authoritative hydration and one cleaned-up subscription per route mount,
scoped change refreshes, obsolete request suppression, and overlapping known-ID
session/message requests within one IndexedDB transaction.
Already validated routes retain the existing openSession/readSession path without
an additional speculative lookup; early read-only work is for pending Foundation.
These checks test the lifecycle owner used by the hook with real fake IndexedDB
and controlled promises; they do
not claim mounted React/router or device acceptance. No session cache is introduced.

Direct-chat first-paint contracts also protect the absence of a full-page route
fallback, awaited/keyed route identity, neutral pending header/history/composer
anchors, and visible notices only for unavailable Foundation, missing characters,
or failed conversation reads. Warm validated identity paints the chat structure
with a busy history and disabled composer until the authoritative session resolves;
it does not display a transient conversation-loading paragraph or reuse old content.
Real fake-IndexedDB navigation/remount checks retain one hydration and one cleaned-up
subscription per mount across different characters. Route/anchor checks inspect
component wiring; the jsdom interaction test mounts ChatRoom but does not emulate
the Next.js network router or claim iPhone visual acceptance.

Secondary chat lifecycle contracts mount the actual direct-chat page and ChatRoom
while global bubble timing, Regex, and Background reads are held pending. Current
session/history still renders; Background settings are read and observed only once
a session ID exists. Scoped background changes refresh that session, overlapping
refreshes cannot apply an older result last, and a late image read after navigation
cannot create an orphan object URL. The mount releases its subscriptions and owned
URLs on unmount. Bubble timer contracts check direct queue cancellation and mounted
hook route changes: the former route's timer is cancelled, the next route's timer
proceeds, and unmount clears the current timer. These are mounted jsdom and
controlled-timer checks, not browser-router
or iPhone visual acceptance.

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
