import { normalizeDocument, type ThemeDocument } from "./theme-types";
import { encodeStoredImage } from "./image-processing";
import { FOUNDATION_STORAGE_KEY } from "./foundation-storage";
import { migrateLegacyWidgetCharacters } from "./legacy-widget-character";

// Replace this adapter when user-isolated cloud storage becomes available.
export interface ThemeStorage {
  load(): Promise<ThemeDocument>;
  save(document: ThemeDocument): Promise<void>;
  readRaw(): Promise<string | null>;
  replaceIfCurrent(expected: string | null, document: ThemeDocument): Promise<string>;
  rollbackIfCurrent(expected: string, previous: string | null): Promise<boolean>;
}

const KEY = "companion-phone.appearance.v1";
export const browserThemeStorage: ThemeStorage = {
  async load() {
    const raw = window.localStorage.getItem(KEY);
    let theme: ThemeDocument;
    try {
      theme = normalizeDocument(raw ? JSON.parse(raw) : null);
    } catch {
      throw new Error(
        "Saved appearance is invalid. Restore Default to replace it.",
      );
    }
    if (!theme.current.widgets.some((widget) => widget.type === "here-there" && !widget.config.characterId))
      return theme;
    let foundation: unknown;
    try {
      // This migration pairs two legacy localStorage documents. Reading the
      // Core authority here could mix generations during the first upgrade.
      const stored = window.localStorage.getItem(FOUNDATION_STORAGE_KEY);
      foundation = stored ? JSON.parse(stored) : undefined;
    } catch {
      return theme;
    }
    const migrated = migrateLegacyWidgetCharacters(theme, foundation);
    if (migrated !== theme) {
      if (window.localStorage.getItem(KEY) !== raw) return browserThemeStorage.load();
      await browserThemeStorage.save(migrated);
    }
    return migrated;
  },
  async readRaw() {
    return window.localStorage.getItem(KEY);
  },
  async save(document) {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(document));
    } catch {
      throw new Error(
        "Could not save appearance. Browser storage may be full or unavailable. Remove a preset or use smaller images.",
      );
    }
  },
  async replaceIfCurrent(expected, document) {
    if (window.localStorage.getItem(KEY) !== expected)
      throw new Error("Appearance data changed while restore was being prepared.");
    const raw = JSON.stringify(normalizeDocument(document));
    window.localStorage.setItem(KEY, raw);
    return raw;
  },
  async rollbackIfCurrent(expected, previous) {
    if (window.localStorage.getItem(KEY) !== expected) return false;
    if (previous === null) window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, previous);
    return true;
  },
};

export async function readImage(file: File): Promise<string> {
  const extension = file.name.split(".").at(-1)?.toLowerCase();
  const supportedType =
    file.type.startsWith("image/") ||
    ["png", "jpg", "jpeg", "webp", "gif", "heic", "heif"].includes(
      extension ?? "",
    );
  if (!supportedType)
    throw new Error("Choose an image file, such as JPEG, PNG, WebP or HEIC.");
  if (file.size > 20 * 1024 * 1024)
    throw new Error("Choose an image smaller than 20 MB.");
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () =>
        reject(
          new Error(
            "This photo could not be decoded. If it is HEIC, export it as JPEG and try again.",
          ),
        );
      image.src = url;
    });
    // Some iOS versions reject decode() after successfully firing load. The
    // loaded image is drawable, so decode is an optimization rather than the
    // sole success path.
    if (typeof image.decode === "function")
      await image.decode().catch(() => {});
    if (!image.naturalWidth || !image.naturalHeight)
      throw new Error("This photo has no readable image dimensions.");
    const ratio = Math.min(
      1,
      1200 / Math.max(image.naturalWidth, image.naturalHeight),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image processing is unavailable.");
    try {
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
    } catch {
      throw new Error(
        "This photo could not be processed. Try a smaller JPEG or PNG image.",
      );
    }
    return encodeStoredImage(
      canvas,
      file.type === "image/png" ? "image/png" : "image/jpeg",
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}
