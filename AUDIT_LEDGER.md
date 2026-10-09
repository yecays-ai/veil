# Front-End Audit Ledger

This ledger preserves the original identifiers from the 《前端》 architecture audit.

## Theme lifecycle

| Audit ID | Finding | Status | Evidence |
| --- | --- | --- | --- |
| F1 | Theme initialization and first publication: the saved Theme document was published before its current image URLs were prepared, while server and initial client output used the default Theme. | 已修待验 | This PR adds a bounded current-resource preparation boundary and a pre-hydration, validated CSS bootstrap. Automated checks cover delayed image publication; actual iPhone first-frame comparison remains pending. |
| F2 | Unused preset images blocked publication of the current Theme because image URL synchronization visited current and preset references together. | 已修待验 | This PR prepares only the current snapshot for display. Preset references remain protected by the existing storage garbage-collection reference set. |
