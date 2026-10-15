/**
 * Turns pasted community sticker lists into `{ name, url }` rows. Pure: it reads nothing and saves nothing.
 *
 * Handled: `名称：URL` (Chinese or English colon), `名称 URL`, several rows on one line, blank lines, list
 * markers, names containing "/", and a URL that a word processor wrapped onto the next line(s). Anything it cannot
 * turn into a row is returned in `skipped`, never dropped silently.
 */
export const STICKER_NAME_MAX = 40;
export const STICKER_URL_MAX = 2000;

export type StickerRow = { name: string; url: string };
export type StickerSkip = { text: string; reason: "no-url" | "bad-url" | "duplicate" };
export type StickerParse = { rows: StickerRow[]; skipped: StickerSkip[] };
export type StickerLoadResult = { loadable: StickerRow[]; failed: StickerRow[] };

const HAS_URL = /https?:\/\//i;
const IMAGE_END = /\.(?:png|jpe?g|gif|webp|avif|bmp|svg)(?:[?#]\S*)?$/i;
// Characters that end a link when they trail it in prose, never part of one.
const TRAILING = /[，。；;、,)）】》"'”’]+$/u;

export const cleanStickerName = (value: string) => Array.from(value.replace(/[\p{Cc}\p{Cf}]/gu, " ")
  .replace(/^\s*(?:\d+\s*[.、)）]|[-*•·])\s*/u, "").replace(/[:：\s]+$/u, "").replace(/\s+/g, " ").trim())
  .slice(0, STICKER_NAME_MAX).join("").trim();

/** Only http(s), and short enough to store. Returns the normalized URL or null. */
export function normalizeStickerUrl(raw: string): string | null {
  const text = raw.trim().replace(TRAILING, "");
  if (!text || text.length > STICKER_URL_MAX) return null;
  try {
    const url = new URL(text);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch { return null; }
}

function fileName(url: string, index: number): string {
  try {
    const last = decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).pop() ?? "");
    return cleanStickerName(last.replace(/\.[^.]+$/, "")) || `表情${index + 1}`;
  } catch { return `表情${index + 1}`; }
}

/** One line may hold several rows: each link takes the text between the previous link and itself as its name. */
function splitLine(line: string): { label: string; link: string }[] {
  const starts = [...line.matchAll(/https?:\/\//gi)].map((match) => match.index!);
  return starts.map((start, i) => {
    const previousEnd = i === 0 ? 0 : starts[i - 1];
    const before = i === 0 ? line.slice(0, start) : line.slice(previousEnd, start).replace(/^\S+\s*/u, "");
    const end = starts[i + 1] ?? line.length;
    return { label: before, link: i + 1 < starts.length ? line.slice(start, end).trim().split(/\s+/)[0] : line.slice(start, end).trim() };
  });
}

export function parseStickerText(text: string): StickerParse {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").map((line) => line.trim());
  const rows: StickerRow[] = [], skipped: StickerSkip[] = [], seen = new Set<string>();
  const add = (label: string, link: string, original: string) => {
    const url = normalizeStickerUrl(link);
    if (!url) { skipped.push({ text: original.slice(0, 120), reason: "bad-url" }); return; }
    if (seen.has(url)) { skipped.push({ text: original.slice(0, 120), reason: "duplicate" }); return; }
    seen.add(url);
    rows.push({ name: cleanStickerName(label) || fileName(url, rows.length), url });
  };
  for (let index = 0; index < lines.length; index++) {
    let line = lines[index];
    if (!line) continue;
    if (!HAS_URL.test(line)) { skipped.push({ text: line.slice(0, 120), reason: "no-url" }); continue; }
    // A link that does not yet end like an image was probably wrapped: pull up to two following plain lines onto it.
    const parts = splitLine(line);
    const lastLink = parts.at(-1)?.link ?? "";
    if (!IMAGE_END.test(lastLink.replace(TRAILING, ""))) {
      let joined = line, used = 0;
      for (let next = index + 1; next < lines.length && used < 2; next++) {
        const candidate = lines[next];
        if (!candidate || HAS_URL.test(candidate) || /[:：]/u.test(candidate)) break;
        joined += candidate; used++;
        const rejoined = splitLine(joined).at(-1)?.link ?? "";
        if (IMAGE_END.test(rejoined.replace(TRAILING, ""))) { line = joined; index += used; break; }
      }
    }
    for (const { label, link } of splitLine(line)) add(label, link, line);
  }
  return { rows, skipped };
}

/** URL syntax and actual image loading are separate checks; imports use both. */
export async function validateStickerRows(rows: readonly StickerRow[], timeoutMs = 8_000,
  createImage: () => HTMLImageElement = () => new Image()): Promise<StickerLoadResult> {
  const results = await Promise.all(rows.map((row) => new Promise<{ row: StickerRow; ok: boolean }>((resolve) => {
    const image = createImage();
    let settled = false;
    const finish = (ok: boolean) => { if (settled) return; settled = true; clearTimeout(timer); image.onload = null; image.onerror = null; resolve({ row, ok }); };
    const timer = setTimeout(() => finish(false), timeoutMs);
    image.referrerPolicy = "no-referrer";
    image.onload = () => finish(image.naturalWidth > 0 && image.naturalHeight > 0);
    image.onerror = () => finish(false);
    image.src = row.url;
  })));
  return { loadable: results.filter((result) => result.ok).map((result) => result.row),
    failed: results.filter((result) => !result.ok).map((result) => result.row) };
}
