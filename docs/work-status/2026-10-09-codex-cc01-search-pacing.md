# CC-01 Chat search jump and bubble pacing

Updated: 2026-10-09  (Asia/Shanghai)

Base: `main@1804f74b45f74f550dbbe429262d5554d2aa3a90`.

Scope: Search result jump to a message still hidden by bubble pacing. PR #36 remains open and untouched. PR #56 is independent; its diagnostic changes were not included. No other audit areas were changed.

Implementation: the search jump reveals only the selected ID through the existing reveal queue. Other hidden IDs and pacing order remain intact. A mounted ChatRoom regression covers result click, search close, scroll/highlight, persistent target visibility, and ordered reveal of the other bubbles.

Validation: focused chat pacing/search/layout tests passed (30/30); test TypeScript compile passed; app typecheck passed; lint passed with one existing warning at `components/chat/use-chat-background.ts:47`; production build passed after running outside the restricted filesystem sandbox.

Awaiting human review of the minimal PR. No merge or auto-merge was requested or performed.
