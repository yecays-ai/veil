// Shared by normal write admission and the exclusive restore executor; importing either must not create a cycle.
export const RESTORE_JOURNAL_KEY = "veil.restore-journal.v1";
