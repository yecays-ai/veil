# Data Backup V2

Data & Backup exports a JSON V2 file containing Foundation profiles and characters, appearance settings and presets, Regex rules, WorldBooks, plus chat sessions and messages. V1 files remain importable. Since V1 had no Regex or WorldBook sections, restoring one intentionally preserves the currently stored Regex and WorldBook data; an empty installation retains its safe defaults.

Text API configurations, provider URLs, model selections, and API keys are not read or exported. Chat is read in one readonly IndexedDB transaction limited to the `sessions` and `messages` stores.

The exporter reads Foundation and Theme before and after the chat snapshot. If either changes, it retries once; a second change asks the user to try again. Output is validated, ordered deterministically, and capped at 32 MiB of UTF-8 JSON.

Restore accepts only valid V1 or V2 JSON files up to 32 MiB and shows a summary before writing. V2 validates its complete envelope and every nested Regex and WorldBook record before writing. Empty and confirmed overwrite restores share one guarded write/rollback pipeline. Without overwrite confirmation, stored documents and chats must be absent or already equal the backup (allowing safe retries). API configuration remains untouched. Reload VEIL after a successful restore so active providers reload their persisted state.

On a non-empty device, the same screen enters overwrite mode. It warns the user to close other VEIL tabs, displays the summary, and requires the exact confirmation `RESTORE` before it can replace profiles, appearance, presets, Regex rules, WorldBooks, sessions, and messages. Before replacement it snapshots those documents and the two chat stores; API configurations and keys are never read, replaced, or rolled back. Document writes use compare-and-set checks against their original raw values. Chat verifies its snapshot and clears/re-adds sessions and messages in one IndexedDB transaction. If a later write fails, the earlier stores are conditionally rolled back only when they still contain this restore's target value; any incomplete rollback is reported explicitly and the user should reload before retrying.
