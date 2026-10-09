# Front-End Audit Ledger

This ledger preserves the original identifiers from the 《前端》 architecture audit.

## Theme lifecycle

| Audit ID | Finding | Status | Evidence |
| --- | --- | --- | --- |
| F1 | Theme initialization and first publication: the saved Theme document was published before its current image URLs were prepared, while server and initial client output used the default Theme. | 已修待验 | This PR adds a bounded current-resource preparation boundary and a pre-hydration, validated CSS bootstrap. Automated checks cover delayed image publication; actual iPhone first-frame comparison remains pending. |
| F2 | Unused preset images blocked publication of the current Theme because image URL synchronization visited current and preset references together. | 已修待验 | This PR prepares only the current snapshot for display. Preset references remain protected by the existing storage garbage-collection reference set. |

## Chat rendering lifecycle

| Audit ID | Finding | Status | Evidence |
| --- | --- | --- | --- |
| F5 | Chat and Messages still load on each mount; the shell and content are naturally published in separate stages. | 已修待验 | This PR coordinates the selected session, current wallpaper, character identity, and initial messages at the first-frame boundary. Automated regression coverage passes; iPhone visual acceptance remains pending. |
| F3 | Chat treats “background not yet known” as “use the global/default background.” | 待调查 | Recorded as a separate finding from the original 《前端》 audit; outside this PR's F5 scope. |
