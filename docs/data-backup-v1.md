# Data Backup V1

Data & Backup can export a JSON V1 file containing Foundation profiles and characters, appearance settings and presets, plus chat sessions and messages.

Text API configurations, provider URLs, model selections, and API keys are not read or exported. Chat is read in one readonly IndexedDB transaction limited to the `sessions` and `messages` stores.

The exporter reads Foundation and Theme before and after the chat snapshot. If either changes, it retries once; a second change asks the user to try again. Output is validated, ordered deterministically, and capped at 32 MiB of UTF-8 JSON.

Restore accepts only valid V1 JSON files up to 32 MiB. It shows a summary before writing and only restores into an empty installation: Foundation and Theme must have no raw stored document, and chat sessions/messages must be empty. A partially completed restore can safely be retried with the same backup because each target may already equal that backup. Existing data is never cleared or overwritten; API configuration remains untouched. Reload VEIL after a successful restore so active providers reload their persisted state.
