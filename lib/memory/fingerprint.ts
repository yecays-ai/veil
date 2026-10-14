/** Normalized-text fingerprint: NFKC, case-folded, with whitespace, punctuation and symbols removed. */
export function memoryFingerprint(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/[\p{White_Space}\p{P}\p{S}]+/gu, "");
}
