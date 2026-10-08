# VEIL

'A phone across worlds.'

Minimal, character-neutral Next.js App Router and TypeScript app. Mobile-first phone viewport with a Home Screen, Character text conversations in Messages, and Appearance settings.

## Development

Use Node.js 24 and npm.

```sh
npm ci
npm run dev
```

## Validation

```sh
npm run build
npm run typecheck
npm run lint
npm test
npm start
```

`npm test` also reports the current rendering/navigation lifecycle regression
contracts as JSON. See [Lifecycle regression contracts](docs/regression-contracts.md)
for the protected invariants and how to add a focused maintenance check.

The Home Screen reads the App Registry and links to Messages, Appearance, User Profile, Characters, and Universe.

Character and user defaults live separately in `config/character.ts` and `config/user.ts`. The only placeholder names are `Character` and `User`; generic routes and UI remain independent of identity configuration.

The Foundation and Home work without external services or credentials. Optional Character text chat uses a locally configured OpenAI-compatible provider and IndexedDB. See [Chat Core v1](docs/chat-core-v1.md) for API setup, Send versus Request Reply, storage and context behavior.

## Storage and Data Safety

VEIL's app data is stored by the browser for this site origin. There is no app-wide backup, cloud sync, or server-side copy of these local documents. The storage adapters below are the persistence authorities; React provider snapshots and in-memory caches are views of that data, not extra backups.

| Data | Authoritative storage and main read/write entry | Delete and residual cleanup | Import, export, and backup coverage |
| --- | --- | --- | --- |
| Appearance and Home layout | `localStorage` key `companion-phone.appearance.v1`; `lib/theme-storage.ts`, `lib/theme-types.ts`, `components/theme-provider.tsx`, and `components/appearance.tsx`. The document contains the current snapshot and named Appearance presets; the current snapshot includes decoration, App/Widget positions and Dock order. | Restore Default replaces the current snapshot and layouts but retains named presets. Removing a Widget removes its layout instance; it does not delete its registry entry or other data. | Appearance exports/imports the current snapshot only. It does not include the Appearance preset list or other app data. |
| Appearance image files | IndexedDB `veil-appearance-images-v1`, object store `assets`; `lib/appearance-image-storage.ts`. The Theme document stores references to these blobs. | After a successful Theme write, collection removes unreferenced assets after a 10-minute grace period when no active staging holder protects them. This is opportunistic collection, not a full database sweep on page entry. | A Theme package embeds referenced image bytes in the exported snapshot. There is no separate full image-library backup. |
| User, Characters, Universe, runtime | IndexedDB `veil-core-v1`, object store `documents`, document key `veil.foundation.v1`; `lib/core-document-storage.ts`, `lib/foundation-storage.ts`, `components/foundation-provider.tsx`. | User and Universe are edited in Foundation screens. Current Character deletion removes that Character; Foundation normalization also drops its dangling relationships and node position. The current deletion path does not clear separate Contact, Chat, or Binding records; see the R3 note below. | No Foundation export/import or app-wide backup is implemented. Clearing this site's browser data removes the local Foundation document. |
| Bindings | `localStorage` key `veil.bindings.v1`; `lib/binding-storage.ts`, `lib/bindings.ts`, and Settings Binding screens. Bindings are a separate document, not part of the Foundation IndexedDB record. | Deleting a Preset, Text API config, WorldBook, or Regex group clears references through the corresponding cleanup path. Character-associated Binding cleanup is part of the in-progress R3 work and must be rechecked after it merges. | No Binding import/export or backup is implemented. |
| Presets and prompts | `localStorage` key `veil.preset.v1`; `lib/preset-storage.ts`, `lib/preset-library.ts`, and Settings → Presets. | Deleting a Preset clears its Binding references; a failed cross-document cleanup attempts a guarded rollback. VEIL Default is protected. | The UI imports/exports one Preset at a time. This is not a Preset-library backup. |
| Regex groups and rules | `localStorage` key `veil.regex.v1`; `lib/regex-storage.ts`, `lib/regex.ts`, and Settings → Regex. | Deleting a Regex group clears its Binding references; group deletion has rollback handling if cleanup fails. Rules are deleted within their group. | The UI imports/exports one group or rule at a time. There is no full Regex-library backup. |
| WorldBooks and entries | `localStorage` key `veil.worldbooks.v1`; `lib/worldbook-storage.ts`, `lib/worldbook.ts`, and Settings → WorldBooks. | Deleting a WorldBook clears its Binding references; book deletion has rollback handling if cleanup fails. Entries are deleted within their book. | The UI imports/exports one book or entry at a time. There is no full WorldBook-library backup. |
| Contacts | `localStorage` key `veil.contacts.v1`; `lib/contact-storage.ts` and Contacts screens. Contact remarks and Contact-specific backgrounds are separate from Character profiles. | Removing a Contact only removes that Contact. Current Character deletion does not cascade into this document; R3 will require a post-merge check. | The storage adapter has `exportPortable` and merge-style `restorePortable` methods, but no current UI calls them. They are not a user-facing or app-wide backup. |
| Chats and chat settings | IndexedDB `veil-chat-v2`, object stores `sessions`, `messages`, `chatSettings`, `assets`, and `worldBookStates`; `lib/chat/storage.ts`. Sessions/messages are the durable conversation history. `worldBookStates` is persisted activation state associated with a session. | Clear Conversation History removes that session's messages and WorldBook activation state while retaining its conversation shell. Delete Conversation removes the session and its history. Unreferenced chat images are deleted immediately when a reference is removed where possible; orphan images from interrupted saves are collected during a later image save after a one-hour grace period. A deleted Character's chat records are currently retained; see [Chat Core v1](docs/chat-core-v1.md). | There is no Chat/session/message/image backup or export. Bubble-timing methods can serialize only the three timing values and are not wired to a Settings UI. |
| Text API configurations and credentials | IndexedDB `veil-api-config-v1`, object store `configs`; `lib/api-config-storage.ts` and Settings → Text API. API keys stay in this browser's IndexedDB and are not included in the resource packages described above. | Deleting a config clears its Binding references; failed cleanup can restore the config when safe. | No API config or credential import/export/backup is implemented. IndexedDB is browser storage, not an encrypted vault. |

### Backup, restore, and browser cleanup

The transferable files above are resource-level packages, not snapshots of all VEIL data. Contacts and bubble-timing serialization exist only as storage APIs and are not exposed in the current UI. There is no full-site backup/restore, cloud backup, or cross-device sync. The browser Storage API usage/quota and persistence status shown by `lib/storage-health.ts` report browser storage health; requesting persistent storage is not a backup.

Browser **Clear site data** removes the site's localStorage and IndexedDB data together. VEIL has no general old-key or deleted-record sweeper. The implemented residual cleanup is limited to the Appearance and Chat image rules described above, plus explicit scoped deletion and association cleanup in the relevant resource flows. Do not interpret a resource export, a successful storage-health check, or provider state as a complete backup.

**R3 follow-up:** Claude is implementing Character deletion and associated-data cleanup in parallel. This mapping describes `main` at `5e0b03c` (2026-10-08), before R3 lands. Recheck the Character, Contact, Chat, and Binding rows against the final R3 diff after it merges. The frozen PR #36 only changes Chat first-frame loading files; this documentation task does not alter that PR.

## Appearance

`lib/app-registry.ts` registers the available routes. `lib/theme-types.ts` defines and validates the independent `ThemeProfile` and `ThemeSnapshot` (profile, positioned Apps, Widgets, page count and Dock order). Character/user configuration does not form part of a theme.

`components/theme-provider.tsx` connects the UI to the asynchronous `ThemeStorage` interface in `lib/theme-storage.ts`. The current adapter persists a single document in browser localStorage. Replacing this adapter can introduce user-isolated storage without changing the Appearance controls. Failed writes report an error and retain the previous theme.

Appearance supports colors, uploaded or URL wallpaper/icons, wallpaper fit/opacity/blur/scale/position, Dock color/image/radius and layout, typography, and documented CSS variable overrides. Overrides affect decoration only and take precedence over the ordinary controls; they cannot alter Phone Shell dimensions.

`lib/theme-presets.ts` saves up to ten named snapshots with their image data and layouts. Applying a preset restores the full snapshot. Deleting a preset leaves the current theme intact. Restore Default resets the current theme and both layouts while retaining presets.

`lib/theme-package.ts` exports/imports versioned JSON decoration packages containing only validated theme fields, image sources, and registered App layouts. Uploaded images are embedded, while image URLs remain external references. Packages contain no character/user data or other app state; old-project packages are not supported.

Uploads support PNG/JPEG/WebP/GIF (first frame), at most 10 MB before resizing to a maximum edge of 1200px. Encoded images must fit within 600,000 characters; import packages are capped at 3 MB. Browser storage quotas still apply, especially when saving several image-heavy presets. Export a theme before clearing browser data.

## Vercel

Import this repository, select the Next.js framework preset, and use the repository root. Keep the default install and build commands. Use Node.js 24.x. No environment variables are needed.

## iPhone Home Screen presentation

`app/manifest.ts` serves `/manifest.webmanifest` with VEIL naming, standalone display and the UI's light background/theme color. Root metadata includes Apple standalone-capable tags and `viewport-fit=cover`. No existing install icon asset is available; no new artwork or service worker is added.

On mobile standalone launch, the simulated status bar and visible phone bezel are suppressed in portrait and landscape. Existing content safe-area padding protects native status/Home Indicator areas without doubling insets. Desktop shell dimensions and normal mobile browsing remain unchanged. `StandaloneMode` handles standard display-mode detection and the iOS `navigator.standalone` fallback without changing stored themes.

After deployment, replace the old Home Screen shortcut using Safari's Share → Add to Home Screen so iOS picks up the new metadata. Verify launch on a physical iPhone; browser automation simulates standalone modes and inset values.

## Home Desktop v1

The desktop uses four columns and six rows per page. Positions are 1-based `page / row / col`. Two pages are available by default; swipe horizontally or use the page dots. Dock stays outside the page scroller and reads Appearance's existing layout and decoration (at most four registered Apps).

Hold the desktop (mouse or touch) to enter edit mode, or focus it and press Shift+F10. Use **Done** or Escape to leave. Select an App or Widget, then choose a free grid cell. Switch pages while selected to move across pages. Widgets can resize to `2x2` or `4x2` (columns × rows); occupied or out-of-bounds moves are rejected. Add page supports up to eight pages. Short screens scroll the grid vertically while the Dock stays fixed.

The edit-mode minus button removes only its Widget instance from the current desktop. Registry entries, presets, decoration, App/Dock layouts and profile/Universe data are retained. Empty Widget layouts persist without restoring defaults.

`lib/desktop-layout.ts` owns occupancy, collision repair, movement and legacy App-order migration independently of the Theme Engine. The theme snapshot composes this desktop data for atomic persistence, presets and import/export. All existing decoration is retained when loading older snapshots.

`lib/widget-registry.ts` owns supported sizes and normalized config; `components/widgets/widget-renderer.tsx` maps registered types to views. Adding a Widget requires its type, registry definition and view, without changing the Home grid. Clock reads local device time/date and updates every second. It remains registered, but fresh/restored default layouts only include Here & There; stored layouts keep their existing Widgets. Here & There reads the singleton User and selected Character from the Foundation provider; an unset timezone explicitly falls back to the device timezone. Without Characters it offers a link to create/select one.

Each participant's location is either unset or a manually chosen label with optional latitude/longitude. `lib/participant-config.ts` defines the future coordinates-based `WeatherProvider` and weather state. v1 always displays **Weather not connected** and makes no weather or location requests. Names, locations and timezones are never stored in theme packages.

`npm test` exercises collision/bounds handling, full-layout normalization, legacy migration, preset/package round trips and IANA timezone/DST behavior using Node's built-in test runner. Test compilation goes to `/tmp/veil-desktop-tests`.

## Character & Universe Foundation v1

One User ↔ one fixed Universe → many Characters. `/profile` shows the unique User with a separate edit screen; `/characters` creates, selects, views, edits and deletes Characters with permanent UUIDs. Birthday and Age remain independent. Character Appearance, Backstory, Personality and Speaking Style are distinct fields. `/universe` edits the singleton's name/world setting and owns Character relationships, directional context and shared history. Drag glass nodes to arrange the canvas, or use focused-node arrow keys; click nodes for profiles and connection labels for relation editing. Drag empty canvas space to pan without browser scrollbars; Fit view recenters the graph.

`lib/foundation-types.ts` validates the whitelisted document; `lib/foundation.ts` owns immutable operations and cascade deletion. `lib/foundation-storage.ts` exposes asynchronous load/transaction operations with a serialized browser adapter at `veil.foundation.v1`. Profile data is separate from themes, presets and decoration exports. Failed writes retain stored data. Clearing browser storage removes this local prototype's profiles; no cloud backup is provided. UI consumes `components/foundation-provider.tsx`; replacing the storage adapter does not require changing forms. User-facing foundation copy lives in `lib/foundation-copy.ts`, without an i18n runtime.

`lib/bindings.ts` defines optional configuration references and resolves Global → Character → Character × registered App. Missing fields inherit; scalar `null` and list `[]` clear inherited bindings, and lists replace instead of merge. `lib/binding-storage.ts` persists bindings in its own `veil.bindings.v1` localStorage document. Character deletion currently updates Foundation-owned records; related records in other storage domains are being handled by R3.

Foundation tests cover independent ages/birthdays, stable IDs, singleton normalization, directional relationships, deletion cleanup, node positions, resolver precedence, storage round trips and failed writes.

## UI polish

User and Character profiles share avatar-led headers, compact basic information and narrative cards. Empty narrative sections stay hidden. Editing reuses the same data operations and adds a shared 1:1 avatar cropper: upload, drag, zoom, save crop, then save the profile. Crops are embedded 512px WebP images; GIF uploads use a still frame. URL avatars remain a secondary option. Birthday and Age still have independent values. Profile/world/relationship forms disable browser autocomplete; the native date picker and intentional timezone/gender suggestions remain available.

Universe information has distinct view/edit states. Relationship context labels use selected Character names. Node moves save quietly, and only errors surface. Canvas pan/fit is transient; node positions keep the existing storage format. Shared English copy lives in `lib/foundation-copy.ts` and `lib/ui-copy.ts`; no i18n runtime or services are added.
