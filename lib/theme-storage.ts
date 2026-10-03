import { normalizeDocument, type ThemeDocument } from "./theme-types";

// Replace this adapter when user-isolated cloud storage becomes available.
export interface ThemeStorage {
  load(): Promise<ThemeDocument>;
  save(document: ThemeDocument): Promise<void>;
}

const KEY = "companion-phone.appearance.v1";
export const browserThemeStorage: ThemeStorage = {
  async load() {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return normalizeDocument(null);
    try {
      return normalizeDocument(JSON.parse(raw));
    } catch {
      throw new Error(
        "Saved appearance is invalid. Restore Default to replace it.",
      );
    }
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
};

export async function readImage(file: File): Promise<string> {
  if (
    !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type)
  )
    throw new Error("Choose a PNG, JPEG, WebP or GIF image.");
  if (file.size > 10 * 1024 * 1024)
    throw new Error("Choose an image smaller than 10 MB.");
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const ratio = Math.min(1, 1200 / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * ratio));
    canvas.height = Math.max(1, Math.round(image.height * ratio));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image processing is unavailable.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const source = canvas.toDataURL("image/webp", 0.8);
    if (source.length > 600_000)
      throw new Error("Image is too large to store. Choose a smaller image.");
    return source;
  } finally {
    URL.revokeObjectURL(url);
  }
}
