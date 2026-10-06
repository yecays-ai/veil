import { normalizeDocument, type ThemeDocument } from "./theme-types";
import { encodeStoredImage } from "./image-processing";
import { browserAppearanceImageStorage, storeThemeImageSource, type AppearanceImageStorage } from "./appearance-image-storage";
import { themeImageAssetIds } from "./theme-types";

// Replace this adapter when user-isolated cloud storage becomes available.
export interface ThemeStorage {
  load(): Promise<ThemeDocument>;
  save(document: ThemeDocument): Promise<void>;
}

const KEY = "companion-phone.appearance.v1";
export function createThemeStorage(
  getStorage: () => Pick<Storage, "getItem" | "setItem">,
  images: AppearanceImageStorage,
): ThemeStorage {
  return {
    async load() {
      const storage = getStorage();
      const raw = storage.getItem(KEY);
      let document: ThemeDocument;
      try { document = normalizeDocument(raw ? JSON.parse(raw) : null, false); }
      catch { throw new Error("Saved appearance is invalid. Restore Default to replace it."); }
      // Appearance image payloads are deliberately not migrated from the old inline format.
      // This rewrites only Appearance; other storage documents remain untouched.
      const canonical = JSON.stringify(document);
      if (raw !== null && raw !== canonical) {
        try { storage.setItem(KEY, canonical); }
        catch { throw new Error("Could not update Appearance storage. Browser storage may be unavailable."); }
      }
      try { await images.collect(themeImageAssetIds(document)); } catch { /* Keep valid Appearance data if cleanup is unavailable. */ }
      return document;
    },
    async save(value) {
      const document = normalizeDocument(value, false);
      const ids = themeImageAssetIds(document);
      await images.assertPresent(ids);
      const storage = getStorage();
      const previousRaw = storage.getItem(KEY);
      let previousIds: Set<string> | null = null;
      try {
        previousIds = previousRaw === null ? new Set() : themeImageAssetIds(normalizeDocument(JSON.parse(previousRaw), false));
      } catch { /* Preserve unknown references if the previous document cannot be read. */ }
      try { storage.setItem(KEY, JSON.stringify(document)); }
      catch {
        if (previousIds) try { await images.collect(previousIds); } catch { /* A failed save must not mask its original error. */ }
        throw new Error("Could not save Appearance. Browser storage may be unavailable.");
      }
      try { await images.collect(ids); } catch { /* A valid save must not fail because orphan cleanup failed. */ }
    },
  };
}

export const browserThemeStorage = createThemeStorage(() => window.localStorage, browserAppearanceImageStorage);

export async function persistAppearanceImage(
  source: string | null,
  apply: (source: string | null) => Promise<void>,
  images: AppearanceImageStorage = browserAppearanceImageStorage,
): Promise<void> {
  const reference = await storeThemeImageSource(source, images);
  await apply(reference);
}

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
