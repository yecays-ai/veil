import { normalizeDocument, type ThemeDocument } from "./theme-types";
import { encodeStoredImage } from "./image-processing";
import { browserAppearanceImageStorage, withThemeImageSource, type AppearanceImageStorage } from "./appearance-image-storage";
import { themeImageAssetIds } from "./theme-types";

export interface ThemeStorage {
  load(): Promise<ThemeDocument>;
  save(document: ThemeDocument): Promise<void>;
  transact(update: (document: ThemeDocument) => ThemeDocument): Promise<ThemeDocument>;
}

const KEY = "companion-phone.appearance.v1";
export function createThemeStorage(
  getStorage: () => Pick<Storage, "getItem" | "setItem">,
  images: AppearanceImageStorage,
): ThemeStorage {
  const read = (): ThemeDocument => {
    const raw = getStorage().getItem(KEY);
    try { return normalizeDocument(raw ? JSON.parse(raw) : null, false); }
    catch { throw new Error("Saved appearance is invalid. Existing data has not been changed."); }
  };
  const transact = async (update: (document: ThemeDocument) => ThemeDocument) => {
    const document = await images.publish((available) => {
      const next = normalizeDocument(update(read()), false);
      if ([...themeImageAssetIds(next)].some((id) => !available.has(id)))
        throw new Error("An Appearance image asset is missing. Choose the image again before saving.");
      try { getStorage().setItem(KEY, JSON.stringify(next)); }
      catch { throw new Error("Could not save Appearance. Browser storage may be unavailable."); }
      return next;
    });
    try { await images.collect(() => themeImageAssetIds(read())); }
    catch { /* A successful publication must not fail because optional cleanup failed. */ }
    return document;
  };
  return {
    load: async () => read(),
    save: async (value) => { await transact(() => value); },
    transact,
  };
}

export const browserThemeStorage = createThemeStorage(() => window.localStorage, browserAppearanceImageStorage);

export async function persistAppearanceImage(
  source: string | null,
  apply: (source: string | null) => Promise<void>,
  images: AppearanceImageStorage = browserAppearanceImageStorage,
): Promise<void> {
  await withThemeImageSource(source, apply, images);
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
