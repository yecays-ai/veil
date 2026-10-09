"use client";
/* eslint-disable @next/next/no-img-element -- Canvas needs the original locally embedded image. */
import { useEffect, useRef, useState } from "react";
import {
  rectangularCropGeometry,
  type CropPoint,
} from "../lib/avatar-crop";
import { encodeStoredImage } from "../lib/image-processing";

export type CropShape = "square" | "portrait" | "wide";

const SHAPES: Record<
  CropShape,
  { viewport: { width: number; height: number }; output: { width: number; height: number } }
> = {
  square: { viewport: { width: 240, height: 240 }, output: { width: 512, height: 512 } },
  portrait: { viewport: { width: 180, height: 280 }, output: { width: 720, height: 1120 } },
  wide: { viewport: { width: 240, height: 96 }, output: { width: 900, height: 360 } },
};

type ImageCropDialogProps = {
  source: string;
  shape?: CropShape;
  title?: string;
  alt?: string;
  onSave: (value: string) => void | Promise<void>;
  onUseOriginal?: () => void | Promise<void>;
  onCancel: () => void;
};

// Everything below the dialog (load state, natural size, zoom, position, drag, the <img> and its
// load/error events) belongs to one source. Keying by source drops all of it when the source changes.
export function ImageCropDialog(props: ImageCropDialogProps) {
  return <CropDialogBody key={props.source} {...props} />;
}

function CropDialogBody({
  source,
  shape = "square",
  title = "Adjust image",
  alt = "Image crop preview",
  onSave,
  onUseOriginal,
  onCancel,
}: ImageCropDialogProps) {
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
      await onSave(
        await encodeStoredImage(
          canvas,
          shape === "portrait" ? "image/jpeg" : "image/png",
        ),
      );
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
          onError={() => {
            setLoaded(false);
            setError("This image could not be loaded.");
          }}
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
