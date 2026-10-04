import { normalizeDocument, type ThemeDocument } from "./theme-types";

// Replace this adapter when user-isolated cloud storage becomes available.
export interface ThemeStorage {
  load(): Promise<ThemeDocument>;
  hasStoredDocument(): Promise<boolean>;
  save(document: ThemeDocument): Promise<void>;
  saveIfEmpty(document: ThemeDocument): Promise<void>;
  replace(document: ThemeDocument): Promise<void>;
  readRaw(): Promise<string | null>;
  replaceIfCurrent(expected: string | null, document: ThemeDocument): Promise<string>;
  rollbackIfCurrent(expected: string, previous: string | null): Promise<boolean>;
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
  async hasStoredDocument() {
    return window.localStorage.getItem(KEY) !== null;
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
  async saveIfEmpty(document) {
    // Re-read immediately before writing so a concurrent settings save wins.
    if (window.localStorage.getItem(KEY) !== null)
      throw new Error("Appearance data is no longer empty. Restore was not applied.");
    await this.save(normalizeDocument(document));
  },
  async replace(document) {
    await this.save(normalizeDocument(document));
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
    const encode = (type: string, quality?: number) =>
      new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, type, quality),
      );
    let output = await encode("image/webp", 0.8);
    if (!output || output.type !== "image/webp") {
      output = await encode(
        file.type === "image/png" ? "image/png" : "image/jpeg",
        0.82,
      );
    }
    if (!output?.size)
      throw new Error("This browser could not encode the image.");
    const source = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () =>
        typeof reader.result === "string"
          ? resolve(reader.result)
          : reject(
              new Error("This browser could not read the processed image."),
            );
      reader.onerror = () =>
        reject(new Error("This browser could not read the processed image."));
      reader.readAsDataURL(output);
    });
    if (source.length > 600_000)
      throw new Error(
        "The processed image is too large to store. Choose a smaller photo.",
      );
    return source;
  } finally {
    URL.revokeObjectURL(url);
  }
}
