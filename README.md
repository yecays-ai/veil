# VEIL

> A phone across worlds.

[简体中文](README.zh-CN.md)

VEIL is a little companion phone that lives in your browser. Create Characters, build their world, talk with them, give them memories, and make the phone look like yours.

It is local-first, mobile-first, and character-neutral. VEIL provides the phone and the system; the people, stories, prompts, and worlds are yours.

## ✨ What is inside?

| | |
| --- | --- |
| 💬 **Messages** | Private and group chats, streaming replies, quotes, search, message actions, retries, custom backgrounds, and per-chat styling |
| 🧠 **Memory** | Per-Character memories, Journal, State, History, rolling summaries, manual editing, undo, and optional automatic upkeep |
| 🌌 **Characters & Universe** | Character profiles, relationships, shared history, Presence, daily situations, and a draggable relationship map |
| 🪪 **Profile & Contacts** | Your profile, Character contacts, remarks, contact backgrounds, Last Seen, and quick chat entry |
| 🎨 **Appearance** | Wallpapers, colors, fonts, icons, Dock styling, layouts, Widgets, and reusable theme presets |
| 🏠 **Home Screen** | A multi-page app grid, editable Dock, resizable Widgets, and a phone-like experience on desktop and mobile |
| 🧩 **Creative tools** | Presets, Text APIs, Bindings, WorldBooks, Regex rules, and tools for shaping chat context |
| 💾 **Backup & Restore** | A whole-app ZIP backup, package checks, restore preview, rollback, and recovery after an interrupted restore |

## 💬 Conversations that remember

Messages are more than a plain chat box. VEIL keeps conversation history on the device and supports private chats, group chats, quotes, search, multi-select actions, continuing or regenerating replies, bubble timing, backgrounds, and custom CSS.

When VEIL builds a reply, it can bring together the current conversation, Character and Universe information, relationship context, Presence and State, active WorldBooks, and relevant Memory. Bindings decide which API, Preset, WorldBooks, and Regex rules each Character or app should use.

Sending a message and asking a Character to reply are separate actions. If a model request fails or is cancelled, the user's saved message stays safe.

## 🧠 Memory with a place of its own

Each Character has an independent Memory space with four views:

- **Memories** for long-term facts and experiences;
- **Journal** for user-written, keyword-triggered notes;
- **State** for what is happening with the Character now;
- **History** for older or replaced memories.

Users can add, edit, remove, search, filter, and undo Memory changes. Optional Memory Maintenance can create and refresh memories after enough new conversation has accumulated. It runs only while VEIL is open, uses its own configurable model choice, and cannot overwrite protected manual memories.

A reply can also show which Memory and Journal entries were actually available to it.

## 🌌 A world, not just a contact list

VEIL has one User, many Characters, and one shared Universe.

- Character profiles keep appearance, backstory, personality, speaking style, life settings, State, and Presence separate.
- The Universe stores world information, directional relationships, relationship kinds, shared history, and graph positions.
- Presence uses timezones and routines to show situations, status, and Last Seen.
- Characters can update parts of their own situation through supported chat actions.
- Deleting a Character uses a coordinated cleanup flow for contacts, chats, group membership, bindings, widgets, Presence, and Memory.

## 🎨 Make the phone yours

Appearance controls the phone without mixing decoration into Character data. You can change colors, fonts, wallpaper, icons, Dock styling, opacity, blur, positioning, and layout. Named presets keep full snapshots of the current look.

The Home Screen supports multiple pages, drag-free grid editing, collision checks, an editable Dock, and resizable Widgets. **Here & There** can show User and Character time, location, weather, and optional generated remarks.

The **Moments** app is currently an empty shell. It is not a working social feed yet.

## 🔒 Your data stays in your browser

VEIL has no account system, cloud sync, or server-side copy of your local app data. Profiles, conversations, Memory, settings, and images belong to the browser storage for this site.

VEIL can make network requests only when a feature needs them:

- your configured OpenAI-compatible provider for chat and optional generated features;
- Open-Meteo for weather or place lookup when a saved location is used;
- external image URLs that you choose to display.

There is no VEIL telemetry service in this repository.

### Backups matter

Clearing site data removes VEIL's local data. Use **Settings → Backup & Restore** to download a checked ZIP backup.

Backups include the supported app data and local images, but never API keys. Import replaces the current device data instead of merging it. VEIL previews and validates the file first, keeps a safety copy during replacement, and can resume or roll back an interrupted restore.

Backup files are not encrypted and may contain private conversations, profiles, Memory, locations, and images. Keep them somewhere safe.

## 📱 iPhone Home Screen

VEIL includes a web app manifest, Apple standalone metadata, safe-area support, and an iOS standalone fallback. Add it from Safari with **Share → Add to Home Screen** for the intended phone presentation.

There is no service worker or bundled install icon yet. If deployment metadata changes, remove the old shortcut and add it again. Mobile automation is useful, but real iPhone behavior still needs a physical-device check.

---

## 🛠️ For developers

### Stack

- Next.js 16 App Router
- React 19
- TypeScript 5
- Browser `localStorage` and IndexedDB
- Node's test runner, JSDOM, fake IndexedDB, and Playwright

VEIL does not need a backend or environment variables for its base features. Model credentials are configured locally in the browser.

### Quick start

Use Node.js 24.x and npm.

```sh
npm ci
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Foundation, Home, Appearance, Contacts, local editors, and existing data work without a model provider. To generate text, add an OpenAI-compatible configuration in **Settings → Text API**, then choose it globally or through **Settings → Bindings**.

### How the code is arranged

```text
Next.js routes
    ↓
React feature components and providers
    ↓
Chat / Memory / Presence / Foundation / Theme / Backup services
    ↓
Storage adapters and coordinated writes
    ↓
Browser localStorage + IndexedDB
```

| Path | Purpose |
| --- | --- |
| `app/` | Routes, layouts, metadata, manifest, and global styles |
| `components/` | Product UI, providers, dialogs, Widgets, and Settings screens |
| `lib/chat/` | Sessions, messages, model requests, prompts, context, and chat behavior |
| `lib/memory/` | Memory storage, retrieval, summaries, Journal, State, and maintenance |
| `lib/presence/` | Routines, situations, notes, actions, and live Presence |
| `lib/backup/` | Backup packages, snapshots, validation, restore, rollback, and recovery |
| `lib/` | Foundation, themes, Contacts, resources, bindings, and shared domain logic |
| `tests/` | Node, JSDOM, and fake-IndexedDB regression coverage |
| `e2e/` | Local Playwright browser smoke tests |
| `docs/` | Architecture notes, audit evidence, and task handoffs |

`app/layout.tsx` owns the persistent application shell. It blocks ordinary startup during interrupted restore recovery, starts product defaults and optional Memory Maintenance, and mounts the phone, theme, Foundation, and opt-in diagnostic providers.

The app list has one source of truth in `lib/app-registry.ts`. Data domains have separate storage authorities; React providers and caches are views, not backups.

### Storage at a glance

| Data | Authority |
| --- | --- |
| Appearance metadata, Contacts, Bindings, Presets, Regex, WorldBooks, Presence | `localStorage` documents |
| User, Characters, Universe | IndexedDB `veil-core-v1` |
| Chats, messages, settings, and chat images | IndexedDB `veil-chat-v2` |
| Memory, Journal, history, operations, and maintenance state | IndexedDB `veil-memory-v1` |
| Text API configurations and keys | IndexedDB `veil-api-config-v1` |
| Appearance image bytes | IndexedDB `veil-appearance-images-v1` |

Keep these domains separate. Storage changes need deliberate migration and cleanup behavior; a convenient React snapshot is never a second persistence authority.

### Checks

```sh
npm test
npm run typecheck
npm run lint
npm run build
```

Focused and browser checks:

```sh
npm run test:mutations
npm run test:memory
npm run test:browser
```

`npm test` also writes the current lifecycle regression contracts as JSON. `test:browser` starts an isolated build on port `3123`, uses a fresh Chromium context, calls no model, and does not touch real data. Install Chromium once with `npx playwright install chromium`, or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE`.

### Useful reading

- [Repository agent guide](AGENTS.md)
- [Chat Core v1](docs/chat-core-v1.md)
- [Backup format](docs/backup-format-v1.md) and [Backup entry](docs/backup-entry.md)
- [Memory construction](docs/memory-m5a-construction.md) and [Memory integration](docs/memory-m6-p2-integration.md)
- [Lifecycle regression contracts](docs/regression-contracts.md)
- [Current audit ledger](docs/AUDIT_LEDGER.md)

Historical reports describe the revision they were written for. When they disagree, current source and the current audit ledger win.

### Deploying to Vercel

Import the repository root, use the Next.js preset and Node.js 24.x, and keep the default install and build commands. The base app needs no environment variables. Text API keys remain local to each browser and are not deployment secrets.

### Before opening a PR

- Read `AGENTS.md` and the relevant domain notes.
- Preserve existing user data unless the task explicitly includes a migration.
- Give every request, subscription, and background task an owner, cleanup path, and bounded lifetime.
- Add focused regression coverage for changed behavior.
- Keep source reading, automated tests, browser checks, and physical-device acceptance as separate evidence levels.
- Keep the PR focused and leave merge/release decisions to the repository owner.
