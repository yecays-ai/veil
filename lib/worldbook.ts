export type WorldBookEntry = {
  id: string;
  name: string;
  content: string;
  enabled: boolean;
  keywords: string[];
  matchMode: "literal" | "regex";
  caseSensitive: boolean;
  constant: boolean;
  scanDepth: number;
  priority: number;
  position: "before" | "after";
  sticky: number;
  cooldown: number;
  delay: number;
};
export type WorldBook = {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  entries: WorldBookEntry[];
};
export type WorldBookDocument = { version: 1; books: WorldBook[] };

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const onlyKeys = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).every((key) => keys.includes(key));
const integer = (value: unknown, fallback: number, minimum = 0) =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= minimum ? value : fallback;
const keywordList = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    if (!value.every((item) => typeof item === "string")) throw new Error("WorldBook keywords must be text.");
    return value.map((item: string) => item.trim()).filter(Boolean);
  }
  if (typeof value === "string") return value.split(",").map((item) => item.trim()).filter(Boolean);
  if (value === undefined) return [];
  throw new Error("WorldBook keywords must be text.");
};
export const emptyWorldBookDocument = (): WorldBookDocument => ({ version: 1, books: [] });

export function normalizeWorldBookEntry(value: unknown, id: string = crypto.randomUUID()): WorldBookEntry {
  if (!record(value) || typeof value.content !== "string")
    throw new Error("WorldBook Entry is missing valid content.");
  const keys = value.keywords ?? value.key;
  return {
    id,
    name: typeof value.name === "string" ? value.name : typeof value.comment === "string" ? value.comment : "New Entry",
    content: value.content,
    enabled: typeof value.enabled === "boolean" ? value.enabled : value.disable !== true,
    keywords: keywordList(keys),
    matchMode: value.matchMode === "regex" || value.use_regex === true ? "regex" : "literal",
    caseSensitive: value.caseSensitive === true || value.case_sensitive === true,
    constant: value.constant === true,
    scanDepth: integer(value.scanDepth ?? value.depth, 20, 1),
    priority: integer(value.priority ?? value.insertion_order, 0, -1_000_000),
    position: value.position === "after" || value.position === 1 ? "after" : "before",
    sticky: integer(value.sticky, 0),
    cooldown: integer(value.cooldown, 0),
    delay: integer(value.delay, 0),
  };
}

export function normalizeWorldBook(value: unknown, id: string = crypto.randomUUID()): WorldBook {
  if (!record(value) || (value.entries !== undefined && !record(value.entries) && !Array.isArray(value.entries)))
    throw new Error("WorldBook has an unsupported structure.");
  const entries = Array.isArray(value.entries) ? value.entries : Object.values(value.entries ?? {});
  return {
    id,
    name: typeof value.name === "string" && value.name.trim() ? value.name.trim() : "Imported WorldBook",
    description: typeof value.description === "string" ? value.description : "",
    enabled: typeof value.enabled === "boolean" ? value.enabled : value.disable !== true,
    entries: entries.map((entry) => normalizeWorldBookEntry(entry)),
  };
}

export function validateWorldBookDocument(value: unknown): WorldBookDocument {
  if (!record(value) || !onlyKeys(value, ["version", "books"]) ||
    value.version !== 1 || !Array.isArray(value.books))
    throw new Error("Saved WorldBook data has an unsupported format.");
  const bookIds = new Set<string>();
  const books = value.books.map((item) => {
    if (!record(item) || !onlyKeys(item, ["id", "name", "description", "enabled", "entries"]) ||
      typeof item.id !== "string" || !item.id || bookIds.has(item.id) ||
        typeof item.name !== "string" || !item.name.trim() || typeof item.description !== "string" ||
        typeof item.enabled !== "boolean" || !Array.isArray(item.entries))
      throw new Error("Saved WorldBook contains invalid books or duplicate IDs.");
    bookIds.add(item.id);
    const entryIds = new Set<string>();
    const entries = item.entries.map((entry) => {
      if (!record(entry) || !onlyKeys(entry, ["id", "name", "content", "enabled", "keywords", "matchMode", "caseSensitive", "constant", "scanDepth", "priority", "position", "sticky", "cooldown", "delay"]) ||
        typeof entry.id !== "string" || !entry.id || entryIds.has(entry.id) ||
          typeof entry.name !== "string" || typeof entry.content !== "string" ||
          typeof entry.enabled !== "boolean" || !Array.isArray(entry.keywords) ||
          !entry.keywords.every((keyword) => typeof keyword === "string") ||
          !["literal", "regex"].includes(String(entry.matchMode)) ||
          typeof entry.caseSensitive !== "boolean" || typeof entry.constant !== "boolean" ||
          !["before", "after"].includes(String(entry.position)) ||
          !Number.isSafeInteger(entry.scanDepth) || Number(entry.scanDepth) < 1 ||
          !Number.isSafeInteger(entry.priority) ||
          ["sticky", "cooldown", "delay"].some((key) => !Number.isSafeInteger(entry[key]) || Number(entry[key]) < 0))
        throw new Error("Saved WorldBook contains invalid entries or duplicate IDs.");
      entryIds.add(entry.id);
      return entry as WorldBookEntry;
    });
    return { ...item, entries } as WorldBook;
  });
  return { version: 1, books: structuredClone(books) };
}

function parseJson(json: string): unknown {
  try { return JSON.parse(json); }
  catch { throw new Error("WorldBook JSON could not be read."); }
}
export function importWorldBook(document: WorldBookDocument, json: string): WorldBookDocument {
  const raw = parseJson(json);
  // Tavern exports often wrap the book in `data` or export an entries map directly.
  const source = record(raw) && record(raw.data) && raw.entries === undefined ? raw.data : raw;
  if (!record(source) || source.entries === undefined)
    throw new Error("WorldBook JSON has an unsupported structure.");
  return validateWorldBookDocument({ ...document, books: [...document.books, normalizeWorldBook(source)] });
}
export function importWorldBookEntry(document: WorldBookDocument, bookId: string, json: string, replaceId?: string): WorldBookDocument {
  const raw = parseJson(json);
  const source = record(raw) && record(raw.entry) ? raw.entry : raw;
  const entry = normalizeWorldBookEntry(source, replaceId);
  if (!document.books.some((book) => book.id === bookId)) throw new Error("WorldBook not found.");
  if (replaceId && !document.books.some((book) => book.id === bookId && book.entries.some((item) => item.id === replaceId)))
    throw new Error("WorldBook Entry not found.");
  return validateWorldBookDocument({ ...document, books: document.books.map((book) => book.id !== bookId ? book : {
    ...book, entries: replaceId ? book.entries.map((item) => item.id === replaceId ? entry : item) : [...book.entries, entry],
  }) });
}
export const exportWorldBook = (book: WorldBook) => JSON.stringify(book, null, 2);
export const exportWorldBookEntry = (entry: WorldBookEntry) => JSON.stringify(entry, null, 2);
