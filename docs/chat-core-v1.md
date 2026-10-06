# Chat Core v1

Messages lists every existing Character. Opening a Character creates or reuses
one session by `characterId`; there are no separate contacts or friend records.
A deleted Character is hidden from Messages and cannot request replies. Its chat
records are retained rather than silently erased.

## Send and Request Reply

Send saves one user bubble and never calls a model. Send several messages, then
use Request Reply (even with an empty composer). The engine atomically marks
all unrequested user messages with the new assistant message's request ID before
calling the API. An already claimed batch cannot generate again, across reloads
or concurrent tabs. New messages sent during generation remain pending for the
next explicit request. Stop preserves partial output. Failed/stopped batches
remain consumed; no retry action is included. Missing/invalid API configuration
is checked before a batch is claimed.

The optional `autoReplyOnKeyboardDismiss` field is reserved and defaults to false.
The trigger and its UI are deferred: ordinary input blur cannot reliably identify
keyboard dismissal and must not turn Send into generation.

## Storage and boundaries

`lib/chat/storage.ts` uses native IndexedDB (`veil-chat-v2`, version 1):

- `sessions`: independent Conversation ID, display summary,
  optional remark and a monotonic `nextOrder` counter.
- `messages`: individual records keyed by message ID, indexed by session; role,
  text, status, creation time, stable order and optional batch/error metadata.

Text API resources and credentials live in the separate `veil-api-config-v1`
database. They are never stored in bindings, themes, messages, URL parameters
or logs.

Every mutation is an atomic record operation, not a cache/snapshot replacement.
Loads are read-only. Empty/failed hydration has no path to clear existing data.
Opening an existing session does not overwrite it. The provider receives a fresh
storage snapshot for each request. Future message edits/deletes must change these
records; prompt history does not maintain a second cached copy.

An interrupted page reload may leave a streaming draft. It is shown as interrupted,
retained for the user, excluded from model history, and its batch is still claimed.
The application does not reset persisted drafts merely because a page loaded.

## API configuration

Open **Settings → Text API**. Create a named config,
enter Base URL, API Key and Model, save, then explicitly choose **Use as default**.
The Base URL
may end at the provider API root (`https://provider.example/v1`) or the full
`/chat/completions` path. Requests use the OpenAI-compatible streaming text format;
JSON completion responses are also accepted. No provider is hardcoded.

Requests run directly from the browser. The provider must support browser CORS;
there is no server proxy or server-side key storage in v1. Keys remain local to
this browser and are sent only to the configured provider. IndexedDB is browser
storage, not an encrypted secret vault. HTTP error bodies are deliberately not
shown because gateways may echo credentials.

The default local configuration ID is `chat-default`. The engine resolves the
existing Global → Character → Character × Messages API binding, using the default
when the binding is absent; explicit null disables generation. A reference to a
missing configuration fails visibly. No additional binding/provider editor is added.

## Prompt order

1. Base system instruction.
2. Populated User profile fields.
3. Universe name and world setting.
4. Current Character profile.
5. Only current Character's direct one-hop relationships, excluding missing peers.
6. Isolated, empty Memory slot.
7. Up to 40 recent eligible messages.
8. The current pending user messages, each once, in stable order.

The pending IDs are excluded from recent history. Failed, stopped and unfinished
assistant drafts are excluded. API settings and avatars are not prompt fields.
No Memory retrieval, instruction-message UI, side-story mode, groups, tools,
media, calls, reactions, WorldBook, regex or message action menus are implemented.

## Extension points and validation

The storage model, prompt sections/Memory slot, request adapter, engine and message
renderer are separate modules. Future typed content and message actions can extend
these boundaries without importing an old chat engine or modifying Foundation data.

`npm test` includes real IndexedDB transaction tests using the dev-only
`fake-indexeddb` emulator, engine/prompt/provider tests and all existing suites.
Build, typecheck and lint remain the standard repository commands. Browser checks
exercise the production build against a local OpenAI-compatible streaming server
at 320px, 390px and desktop Phone Shell sizes, including Stop, errors, reopen and
blocked storage. External paid providers require the user's own configuration.

Text API resources retain stable IDs and live in the private independent API Config
storage. Saving is separate from testing.
Test Connection sends a tiny, capped non-streaming text request; Fetch Models uses
`/models`, with manual model entry always available. Both operate on the editor
fields without saving them. No provider error bodies or generated previews are shown.
Deleting a config through Settings also clears its Binding references. Selecting a
global default is explicit and preserves Character/app overrides. The former
`/messages/settings` redirects to Settings; there is only one credential-management UI.
