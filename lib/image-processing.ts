const STORED_IMAGE_BYTES = 440_000;

const toBlob = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));

function scaledCanvas(source: HTMLCanvasElement, scale: number, opaque: boolean) {
  if (scale === 1 && !opaque) return source;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Image processing is unavailable.");
  if (opaque) {
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

async function dataUrl(blob: Blob): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("This browser could not read the processed image."));
    reader.onerror = () =>
      reject(new Error("This browser could not read the processed image."));
    reader.readAsDataURL(blob);
  });
}

/** Encodes within localStorage's image limit, including Safari without WebP canvas encoding. */
export async function encodeStoredImage(
  source: HTMLCanvasElement,
  fallback: "image/jpeg" | "image/png",
): Promise<string> {
  for (const scale of [1, 0.85, 0.7, 0.55, 0.42]) {
    const transparent = scaledCanvas(source, scale, false);
    for (const quality of [0.82, 0.66, 0.5, 0.36]) {
      const blob = await toBlob(transparent, "image/webp", quality);
      if (blob?.type === "image/webp" && blob.size <= STORED_IMAGE_BYTES)
        return dataUrl(blob);
    }
    if (fallback === "image/png") {
      const png = await toBlob(transparent, "image/png");
      if (png?.size && png.size <= STORED_IMAGE_BYTES) return dataUrl(png);
    }
    const opaque = scaledCanvas(source, scale, true);
    for (const quality of [0.78, 0.6, 0.44, 0.3]) {
      const jpeg = await toBlob(opaque, "image/jpeg", quality);
      if (jpeg?.size && jpeg.size <= STORED_IMAGE_BYTES) return dataUrl(jpeg);
    }
  }
  throw new Error("This browser could not make the image small enough to store.");
}
