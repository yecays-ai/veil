# VEIL

A phone across worlds.

Minimal, character-neutral Next.js App Router and TypeScript app. Mobile-first phone viewport with a Home Screen, an empty Messages route, and Appearance settings.

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

The Home Screen reads the App Registry and links to Messages, Appearance, User Profile, Characters, and Universe.

Character and user defaults live separately in `config/character.ts` and `config/user.ts`. The only placeholder names are `Character` and `User`; generic routes and UI remain independent of identity configuration.

No AI requests, credentials, authentication, database, or external services are required.

## Appearance

`lib/app-registry.ts` registers the available routes. `lib/theme-types.ts` defines and validates the independent `ThemeProfile` and `ThemeSnapshot` (profile, positioned Apps, Widgets, page count and Dock order). Character/user configuration does not form part of a theme.

`components/theme-provider.tsx` connects the UI to the asynchronous `ThemeStorage` interface in `lib/theme-storage.ts`. The current adapter persists a single document in browser localStorage. Replacing this adapter can introduce user-isolated storage without changing the Appearance controls. Failed writes report an error and retain the previous theme.

Appearance supports colors, uploaded or URL wallpaper/icons, wallpaper fit/opacity/blur/scale/position, Dock color/image/radius and layout, status bar visibility/color/island, typography, and documented CSS variable overrides. Overrides affect decoration only and take precedence over the ordinary controls; they cannot alter Phone Shell dimensions.

`lib/theme-presets.ts` saves up to ten named snapshots with their image data and layouts. Applying a preset restores the full snapshot. Deleting a preset leaves the current theme intact. Restore Default resets the current theme and both layouts while retaining presets.

`lib/theme-package.ts` exports/imports versioned JSON decoration packages containing only validated theme fields, image sources, and registered App layouts. Uploaded images are embedded, while image URLs remain external references. Packages contain no character/user data or other app state; old-project packages are not supported.

Uploads support PNG/JPEG/WebP/GIF (first frame), at most 10 MB before resizing to a maximum edge of 1200px. Encoded images must fit within 600,000 characters; import packages are capped at 3 MB. Browser storage quotas still apply, especially when saving several image-heavy presets. Export a theme before clearing browser data.

## Vercel

Import this repository, select the Next.js framework preset, and use the repository root. Keep the default install and build commands. Use Node.js 24.x. No environment variables are needed.

## Home Desktop v1

The desktop uses four columns and six rows per page. Positions are 1-based `page / row / col`. Two pages are available by default; swipe horizontally or use the page dots. Dock stays outside the page scroller and reads Appearance's existing layout and decoration (at most four registered Apps).

Hold the desktop (mouse or touch) to enter edit mode, or focus it and press Shift+F10. Use **Done** or Escape to leave. Select an App or Widget, then choose a free grid cell. Switch pages while selected to move across pages. Widgets can resize to `2x2` or `4x2` (columns × rows); occupied or out-of-bounds moves are rejected. Add page supports up to eight pages. Short screens scroll the grid vertically while the Dock stays fixed.

`lib/desktop-layout.ts` owns occupancy, collision repair, movement and legacy App-order migration independently of the Theme Engine. The theme snapshot composes this desktop data for atomic persistence, presets and import/export. All existing decoration is retained when loading older snapshots.

`lib/widget-registry.ts` owns supported sizes and normalized config; `components/widgets/widget-renderer.tsx` maps registered types to views. Adding a Widget requires its type, registry definition and view, without changing the Home grid. Clock reads local device time/date and updates every second. It remains registered, but fresh/restored default layouts only include Here & There; stored layouts keep their existing Widgets. Here & There reads the singleton User and selected Character from the Foundation provider; an unset timezone explicitly falls back to the device timezone. Without Characters it offers a link to create/select one.

Each participant's location is either unset or a manually chosen label with optional latitude/longitude. `lib/participant-config.ts` defines the future coordinates-based `WeatherProvider` and weather state. v1 always displays **Weather not connected** and makes no weather or location requests. Names, locations and timezones are never stored in theme packages.

`npm test` exercises collision/bounds handling, full-layout normalization, legacy migration, preset/package round trips and IANA timezone/DST behavior using Node's built-in test runner. Test compilation goes to `/tmp/veil-desktop-tests`.

## Character & Universe Foundation v1

One User ↔ one fixed Universe → many Characters. `/profile` shows the unique User with a separate edit screen; `/characters` creates, selects, views, edits and deletes Characters with permanent UUIDs. Birthday and Age remain independent. Character Appearance, Backstory, Personality and Speaking Style are distinct fields. `/universe` edits the singleton's name/world setting and owns Character relationships, directional context and shared history. Drag glass nodes to arrange the canvas, or use focused-node arrow keys; click nodes for profiles and connection labels for relation editing. Drag empty canvas space to pan without browser scrollbars; Fit view recenters the graph.

`lib/foundation-types.ts` validates the whitelisted document; `lib/foundation.ts` owns immutable operations and cascade deletion. `lib/foundation-storage.ts` exposes asynchronous load/transaction operations with a serialized browser adapter at `veil.foundation.v1`. Profile data is separate from themes, presets and decoration exports. Failed writes retain stored data. Clearing browser storage removes this local prototype's profiles; no cloud backup is provided. UI consumes `components/foundation-provider.tsx`; replacing the storage adapter does not require changing forms. User-facing foundation copy lives in `lib/foundation-copy.ts`, without an i18n runtime.

`lib/bindings.ts` defines optional configuration references and resolves Global → Character → Character × registered App. Missing fields inherit; scalar `null` and list `[]` clear inherited bindings, and lists replace instead of merge. `lib/binding-storage.ts` persists bindings atomically in the same Foundation document. There are no binding editors or service calls. Deleting a Character removes its relations, node position and binding overrides, then selects a remaining Character or none.

Foundation tests cover independent ages/birthdays, stable IDs, singleton normalization, directional relationships, deletion cleanup, node positions, resolver precedence, storage round trips and failed writes.

## UI polish

User and Character profiles share avatar-led headers, compact basic information and narrative cards. Empty narrative sections stay hidden. Editing reuses the same data operations and adds a shared 1:1 avatar cropper: upload, drag, zoom, save crop, then save the profile. Crops are embedded 512px WebP images; GIF uploads use a still frame. URL avatars remain a secondary option. Birthday and Age still have independent values. Profile/world/relationship forms disable browser autocomplete; the native date picker and intentional timezone/gender suggestions remain available.

Universe information has distinct view/edit states. Relationship context labels use selected Character names. Node moves save quietly, and only errors surface. Canvas pan/fit is transient; node positions keep the existing storage format. Shared English copy lives in `lib/foundation-copy.ts` and `lib/ui-copy.ts`; no i18n runtime or services are added.
