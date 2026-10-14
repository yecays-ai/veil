# VEIL

> A phone across worlds.

[简体中文](README.zh-CN.md)

VEIL is a local-first, mobile-first companion phone built with Next.js and TypeScript. It brings Characters, conversations, relationships, presence, long-term memory, and a customizable Home Screen into one private browser application.

VEIL is deliberately character-neutral: the application provides the world and interaction model, while names, identities, stories, providers, prompts, and rules belong to the user.

## Highlights

- **Companion phone UI** — a paged Home Screen, Dock, Apps, Widgets, themes, wallpapers, icons, typography, and an iPhone Home Screen presentation.
- **Characters and Universe** — one User, many Characters, and one shared Universe with directional relationships, history, graph positioning, profiles, and Character State.
- **Messages** — private and group conversations, streaming replies, retry/continue/regenerate flows, quotes, search, multi-select actions, custom chat backgrounds, bubble pacing, and per-chat CSS.
- **Presence** — timezone-aware routines, situations, status, Last Seen, Character-authored state changes, and relationship-aware context.
- **Long-term Memory** — per-Character memories, Journal entries, State, history, source-aware retrieval, rolling summaries, user editing and undo, and optional capacity-triggered maintenance.
- **Context tools** — configurable Presets, Text APIs, Bindings, WorldBooks, Regex processing, and development-only context inspection.
- **Local data safety** — browser-owned persistence, coordinated writes, scoped deletion cleanup, whole-app backup and restore, validation, rollback, and interrupted-restore recovery.

The **Moments** app currently provides an empty shell; it is not yet a publishing or social feed system.

## Product model

VEIL follows a few architectural rules:

1. **Local first.** User data lives in this browser for this site origin. Ordinary app use does not require a VEIL account or application server.
2. **Explicit model access.** AI work uses OpenAI-compatible providers configured by the user. Requests have visible owners, bounded context, cancellation, and stale-result protection.
3. **Separated data domains.** Foundation, chats, memory, appearance, credentials, contacts, presence, and authoring resources have independent storage authorities and cleanup rules.
4. **User-authored data wins.** Manual Memory edits are protected from automatic maintenance. Destructive flows are explicit and recoverable where practical.
5. **Small, observable boundaries.** UI snapshots and in-memory caches are views, not backup authorities. Persistence, request, and background-work ownership stays in dedicated modules.

## Feature map

| Area | What it provides |
| --- | --- |
| Home | Multi-page app grid, Dock, edit mode, collision-safe placement, resizable Widgets, and up to eight pages |
| Appearance | Colors, fonts, wallpaper, app icons, Dock styling, layout, named presets, imports/exports, and bounded CSS variable overrides |
| Profile | The singleton User profile, avatar, personal details, location, timezone, and presentation settings |
| Characters | Character creation and profiles, narrative fields, avatar cropping, life settings, Presence, State, Memory access, and coordinated deletion |
| Universe | Shared world information, directional Character relationships, relation kinds and context, draggable graph nodes, pan, and fit-to-view |
| Contacts | Contact relationships, remarks, profile backgrounds, Presence, direct-message entry, and group selection |
| Messages | Private/group sessions, persisted history, model replies, message actions, conversation settings, backgrounds, WorldBooks, Regex, and Memory context |
| Memory | Per-Character Memories, Journal, State and History tabs; local retrieval; rolling summaries; optional automatic maintenance |
| Settings | Text API, Presets, Bindings, WorldBooks, Regex, Backup & Restore, runtime controls, and Memory Maintenance |
| Here & There | User/Character clocks, locations, optional weather, and optional model-generated remarks |

## Architecture

```text
Next.js App Router pages
        │
React feature components and providers
        │
Domain services (chat, memory, presence, foundation, theme, backup)
        │
Storage adapters and write coordination
        │
localStorage + IndexedDB owned by the browser
```

### Application shell

`app/layout.tsx` assembles the persistent shell:

- `RestoreGate` blocks normal startup when an interrupted restore must be resumed or rolled back.
- `ProductBootstrap` installs and refreshes canonical Preset, Regex, and Binding defaults.
- `MemoryMaintenanceGate` owns optional automatic Memory work while VEIL is open.
- `PhoneShell`, `ThemeProvider`, and `FoundationProvider` publish the visual shell and durable profile data.
- Diagnostic gates remain opt-in and do not become persistence authorities.

Routes are registered in `lib/app-registry.ts`. The Home Screen consumes that registry instead of maintaining a second app list.

### Core domains

- **Foundation** — `lib/foundation-types.ts`, `lib/foundation.ts`, and `lib/foundation-storage.ts` own the User, Characters, Universe, relationships, node positions, and runtime state.
- **Chat** — `lib/chat/` owns session lifecycle, storage, prompt construction, provider requests, message actions, reply splitting, backgrounds, context inspection, and request diagnostics.
- **Memory** — `lib/memory/` owns per-Character memory records, sources, lineage, Journal entries, State overlays, rolling summaries, maintenance scheduling, and cleanup intents.
- **Presence** — `lib/presence/` owns routine calculation, stored situations, notes, actions, live publication, and display projection.
- **Appearance** — theme modules own decoration and layout; image bytes are stored separately from theme metadata.
- **Authoring resources** — Presets, WorldBooks, Regex, Text API configurations, and Bindings stay independent and are composed when a request is built.
- **Backup** — `lib/backup/` owns package validation, ZIP encoding, coordinated snapshots, restore preview, replacement, safety copies, rollback, and recovery journals.

### Request and context flow

For a Character reply, VEIL resolves the selected Text API and Preset through Global → Character → Character × App Bindings. It then assembles only the intended conversation, Character/Universe context, active WorldBook material, Presence/State information, and retrieved Memory within bounded budgets. Display and prompt Regex rules are applied at their defined boundaries.

Sending a message and requesting a reply remain separate operations. Model failures or cancellation must not discard persisted user messages. API keys never enter prompts, diagnostics, or backups.

## Data, backup, and privacy

VEIL has no cloud sync and no server-side copy of browser data. Clearing site data removes local VEIL data unless the user has exported a backup.

| Domain | Browser authority |
| --- | --- |
| Appearance metadata, Contacts, Bindings, Presets, Regex, WorldBooks, Presence | `localStorage` documents |
| User, Characters, Universe | IndexedDB `veil-core-v1` |
| Conversations, messages, chat settings and chat images | IndexedDB `veil-chat-v2` |
| Long-term Memory, Journal, lineage, operations and maintenance cursors | IndexedDB `veil-memory-v1` |
| Text API configurations and credentials | IndexedDB `veil-api-config-v1` |
| Appearance image bytes | IndexedDB `veil-appearance-images-v1` |

React state, providers, live-document snapshots, and caches are not additional backups.

### Full backup and restore

**Settings → Backup & Restore** exports a validated VEIL ZIP containing the supported persistent domains and local image bytes. API configuration metadata is included, but **API keys are always excluded** and must be entered again after restore.

Import is replace-only, not merge-based. VEIL validates and previews the package before writing. Replacement uses coordinated write gates, a safety copy, verification, rollback, and a recovery journal. If the page or browser closes during restore, normal application providers stay unmounted until the user resumes or rolls back the interrupted operation.

Backups are not encrypted. Their contents can include private profiles, conversations, Memory, locations, and images; store them accordingly. Real-device limits still depend on browser storage, available memory, and iOS file handling.

### Network boundaries

VEIL can contact:

- the user-configured OpenAI-compatible Text API for chat, Presence-related generation, Here & There remarks, and optional Memory maintenance;
- Open-Meteo weather and geocoding endpoints when a participant has a saved location and the Here & There widget requests weather;
- user-supplied external image URLs when the browser renders them.

No location request is made for a participant without a configured location. There is no VEIL telemetry service in the repository.

## Repository map

```text
app/                 Next.js routes, layouts, metadata, manifest and global CSS
components/          Feature UI, providers, dialogs, Widgets and Settings screens
config/              Product defaults
lib/                 Domain logic, storage adapters, request builders and backup code
docs/                Architecture notes, audit evidence and task handoffs
e2e/                 Local Playwright browser smoke tests
scripts/             Test runners and maintenance checks
tests/               Node, JSDOM and fake-IndexedDB regression tests
```

Start with these documents when changing a subsystem:

- [Repository agent guide](AGENTS.md)
- [Chat Core v1](docs/chat-core-v1.md)
- [Backup format v1](docs/backup-format-v1.md) and [Backup entry](docs/backup-entry.md)
- [Memory construction](docs/memory-m5a-construction.md) and [Memory integration](docs/memory-m6-p2-integration.md)
- [Lifecycle regression contracts](docs/regression-contracts.md)
- [Current audit ledger](docs/AUDIT_LEDGER.md)

Historical reports and task records describe their own revisions. The current source and audit ledger take precedence when they disagree with an older document.

## Development

### Requirements

- Node.js 24.x
- npm

```sh
npm ci
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

The Foundation, Home Screen, Appearance, and local editors work without external credentials. To generate text, create an OpenAI-compatible provider under **Settings → Text API**, then select it globally or through **Settings → Bindings**.

### Validation

Run the repository checks before delivery:

```sh
npm test
npm run typecheck
npm run lint
npm run build
```

Additional suites:

```sh
npm run test:mutations  # lifecycle mutation checks
npm run test:memory     # focused Memory retrieval runner
npm run test:browser    # local Playwright cross-tab smoke test
```

`npm test` compiles tests into `node_modules/.cache/veil-desktop-tests` and emits lifecycle regression contracts as JSON. `test:browser` builds and starts an isolated copy on port `3123` by default, uses a fresh Chromium context, calls no model, and never touches real user data. Install Chromium once with `npx playwright install chromium`, or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE`.

Automated browser checks are preliminary evidence for mobile behavior. iPhone Safari and Home Screen issues require physical-device acceptance.

## iPhone Home Screen

VEIL ships a web app manifest, Apple standalone metadata, `viewport-fit=cover`, safe-area handling, and an iOS `navigator.standalone` fallback. Standalone mode removes the simulated phone bezel and status bar while preserving native safe areas.

There is currently no service worker or bundled install icon. After deployment metadata changes, remove the old shortcut and use Safari **Share → Add to Home Screen** again so iOS refreshes it.

## Deployment

For Vercel, import the repository root, select the Next.js preset, keep the default install/build commands, and use Node.js 24.x. No environment variables are required for the base application. Text API credentials are configured locally in each browser and are not deployment secrets.

## Contributing

- Read `AGENTS.md` and the relevant domain documentation before editing.
- Preserve local user data and existing storage formats unless a task explicitly includes a migration.
- Keep background work bounded, cancellable, and owned.
- Add focused regression coverage for changed behavior and data-safety boundaries.
- Treat source reading, automated tests, browser checks, and physical-device acceptance as different evidence levels.
- Keep pull requests focused; repository owners control merging and release decisions.
