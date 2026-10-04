# Data Backup V1

Data & Backup can export a JSON V1 file containing Foundation profiles and characters, appearance settings and presets, plus chat sessions and messages. It does not import, replace, or otherwise alter browser data.

Text API configurations, provider URLs, model selections, and API keys are not read or exported. Chat is read in one readonly IndexedDB transaction limited to the `sessions` and `messages` stores.

The exporter reads Foundation and Theme before and after the chat snapshot. If either changes, it retries once; a second change asks the user to try again. Output is validated, ordered deterministically, and capped at 32 MiB of UTF-8 JSON.
