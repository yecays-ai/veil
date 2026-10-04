"use client";
/* eslint-disable @next/next/no-img-element -- Canvas needs the original locally embedded image. */
import { useEffect, useRef, useState } from "react";
import {
  rectangularCropGeometry,
  type CropPoint,
} from "../lib/avatar-crop";

export type CropShape = "square" | "portrait" | "wide";

const SHAPES: Record<
  CropShape,
  { viewport: { width: number; height: number }; output: { width: number; height: number } }
> = {
  square: { viewport: { width: 240, height: 240 }, output: { width: 512, height: 512 } },
  portrait: { viewport: { width: 180, height: 280 }, output: { width: 720, height: 1120 } },
  wide: { viewport: { width: 240, height: 96 }, output: { width: 900, height: 360 } },
};

async function canvasDataUrl(canvas: HTMLCanvasElement): Promise<string> {
  for (const quality of [0.84, 0.72, 0.6, 0.48, 0.36, 0.28]) {
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/webp", quality),
    );
    if (!blob) continue;
    if (blob.size > 440_000) continue;
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () =>
        typeof reader.result === "string"
          ? resolve(reader.result)
          : reject(new Error("This browser could not read the cropped image."));
      reader.onerror = () => reject(new Error("This browser could not read the cropped image."));
      reader.readAsDataURL(blob);
    });
  }
  throw new Error(
    "The cropped image is still too detailed to store. Try a tighter crop or a simpler image.",
  );
}

export function ImageCropDialog({
  source,
  shape = "square",
  title = "Adjust image",
  alt = "Image crop preview",
  onSave,
  onUseOriginal,
  onCancel,
}: {
  source: string;
  shape?: CropShape;
  title?: string;
  alt?: string;
  onSave: (value: string) => void | Promise<void>;
  onUseOriginal?: () => void | Promise<void>;
  onCancel: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    image = useRef<HTMLImageElement>(null),
    drag = useRef<{
      pointer: number;
      x: number;
      y: number;
      point: CropPoint;
    } | null>(null);
  const [dimensions, setDimensions] = useState({ width: 1, height: 1 });
  const [zoom, setZoom] = useState(1),
    [point, setPoint] = useState<CropPoint>({ x: 0, y: 0 }),
    [loaded, setLoaded] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const { viewport, output } = SHAPES[shape];
  const geometry = rectangularCropGeometry(
    dimensions.width,
    dimensions.height,
    viewport.width,
    viewport.height,
    zoom,
    point,
  );

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  async function run(action: () => void | Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Image could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  function exportCrop() {
    void run(async () => {
      if (!image.current || !loaded) return;
      const canvas = document.createElement("canvas");
      canvas.width = output.width;
      canvas.height = output.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Image processing is unavailable.");
      const rect = geometry.source;
      context.drawImage(
        image.current,
        rect.x,
        rect.y,
        rect.width,
        rect.height,
        0,
        0,
        output.width,
        output.height,
      );
      await onSave(await canvasDataUrl(canvas));
    });
  }

  return (
    <dialog
      className="avatar-dialog"
      ref={dialog}
      aria-labelledby="image-crop-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <h2 id="image-crop-title">{title}</h2>
      <p className="subtle">Drag to reposition, then zoom if needed.</p>
      <div
        className="avatar-crop-area"
        style={{ width: viewport.width, height: viewport.height }}
        onPointerDown={(event) => {
          if (event.button !== 0 || busy) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = {
            pointer: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            point: geometry.offset,
          };
        }}
        onPointerMove={(event) => {
          const current = drag.current;
          if (!current || current.pointer !== event.pointerId) return;
          setPoint(
            rectangularCropGeometry(
              dimensions.width,
              dimensions.height,
              viewport.width,
              viewport.height,
              zoom,
              {
                x: current.point.x + event.clientX - current.x,
                y: current.point.y + event.clientY - current.y,
              },
            ).offset,
          );
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
      >
        <img
          ref={image}
          src={source}
          alt={alt}
          draggable={false}
          onLoad={(event) => {
            setDimensions({
              width: event.currentTarget.naturalWidth,
              height: event.currentTarget.naturalHeight,
            });
            setLoaded(true);
          }}
          onError={() => setError("This image could not be loaded.")}
          style={{
            width: dimensions.width * geometry.scale,
            height: dimensions.height * geometry.scale,
            transform: `translate(-50%, -50%) translate(${geometry.offset.x}px, ${geometry.offset.y}px)`,
          }}
        />
      </div>
      <label className="crop-zoom">
        Zoom
        <input
          type="range"
          min="1"
          max="3"
          step="0.01"
          value={zoom}
          disabled={busy}
          onChange={(event) => {
            const next = Number(event.target.value);
            setPoint(
              rectangularCropGeometry(
                dimensions.width,
                dimensions.height,
                viewport.width,
                viewport.height,
                next,
                geometry.offset,
              ).offset,
            );
            setZoom(next);
          }}
        />
      </label>
      <div className="foundation-actions">
        <button
          className="primary-button"
          type="button"
          disabled={!loaded || busy}
          onClick={exportCrop}
        >
          {busy ? "Saving…" : "Save crop"}
        </button>
        {onUseOriginal && (
          <button
            type="button"
            disabled={!loaded || busy}
            onClick={() => void run(onUseOriginal)}
          >
            Use original
          </button>
        )}
        <button type="button" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
    </dialog>
  );
}
