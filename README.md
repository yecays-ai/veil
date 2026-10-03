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

The Home Screen links to `/messages` and `/appearance`. Both pages link back to `/`.

Character and user defaults live separately in `config/character.ts` and `config/user.ts`. The only placeholder names are `Character` and `User`; generic routes and UI remain independent of identity configuration.

No AI requests, credentials, authentication, database, or external services are required.

## Appearance

`lib/app-registry.ts` registers only Messages and Appearance. `lib/theme-types.ts` defines and validates the independent `ThemeProfile` and `ThemeSnapshot` (profile, positioned Apps, Widgets, page count and Dock order). Character/user configuration does not form part of a theme.

`components/theme-provider.tsx` connects the UI to the asynchronous `ThemeStorage` interface in `lib/theme-storage.ts`. The current adapter persists a single document in browser localStorage. Replacing this adapter can introduce user-isolated storage without changing the Appearance controls. Failed writes report an error and retain the previous theme.

Appearance supports colors, uploaded or URL wallpaper/icons, wallpaper fit/opacity/blur/scale/position, Dock color/image/radius and layout, status bar visibility/color/island, typography, and documented CSS variable overrides. Overrides affect decoration only and take precedence over the ordinary controls; they cannot alter Phone Shell dimensions.

`lib/theme-presets.ts` saves up to ten named snapshots with their image data and layouts. Applying a preset restores the full snapshot. Deleting a preset leaves the current theme intact. Restore Default resets the current theme and both layouts while retaining presets.

`lib/theme-package.ts` exports/imports versioned JSON decoration packages containing only validated theme fields, image sources, and registered App layouts. Uploaded images are embedded, while image URLs remain external references. Packages contain no character/user data or other app state; old-project packages are not supported.

Uploads support PNG/JPEG/WebP/GIF (first frame), at most 10 MB before resizing to a maximum edge of 1200px. Encoded images must fit within 600,000 characters; import packages are capped at 3 MB. Browser storage quotas still apply, especially when saving several image-heavy presets. Export a theme before clearing browser data.

## Vercel

Import this repository, select the Next.js framework preset, and use the repository root. Keep the default install and build commands. Use Node.js 24.x. No environment variables are needed.

## Home Desktop v1

The desktop uses four columns and six rows per page. Positions are 1-based `page / row / col`. Two pages are available by default; swipe horizontally or use the page dots. Dock stays outside the page scroller and reads Appearance's existing layout and decoration (at most four registered Apps).

Use **Edit** to select an App or Widget, then choose a free grid cell. Switch pages while selected to move across pages. Widgets can resize to `2x2` or `4x2` (columns × rows); occupied or out-of-bounds moves are rejected. Add page supports up to eight pages. Short screens scroll the grid vertically while the Dock stays fixed.

`lib/desktop-layout.ts` owns occupancy, collision repair, movement and legacy App-order migration independently of the Theme Engine. The theme snapshot composes this desktop data for atomic persistence, presets and import/export. All existing decoration is retained when loading older snapshots.

`lib/widget-registry.ts` owns supported sizes and normalized config; `components/widgets/widget-renderer.tsx` maps registered types to views. Adding a Widget requires its type, registry definition and view, without changing the Home grid. Clock reads local device time/date and updates every second. Here & There reads `config/user.ts` and `config/character.ts`; an unset timezone explicitly falls back to the device timezone, while an invalid IANA timezone is labeled as invalid.

Each participant's location is either unset or a manually chosen label with optional latitude/longitude. `lib/participant-config.ts` defines the future coordinates-based `WeatherProvider` and weather state. v1 always displays **Weather not connected** and makes no weather or location requests. Names, locations and timezones are never stored in theme packages.

`npm test` exercises collision/bounds handling, full-layout normalization, legacy migration, preset/package round trips and IANA timezone/DST behavior using Node's built-in test runner. Test compilation goes to `/tmp/veil-desktop-tests`.
