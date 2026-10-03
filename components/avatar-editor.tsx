"use client";
/* eslint-disable @next/next/no-img-element -- Canvas needs the original locally embedded image. */
import { useEffect, useRef, useState } from "react";
import { Avatar } from "./profile-view";
import { readImage } from "../lib/theme-storage";
import { cropGeometry, type CropPoint } from "../lib/avatar-crop";
import { FOUNDATION_COPY as C } from "../lib/foundation-copy";
import { UI_COPY as U } from "../lib/ui-copy";

function CropEditor({
  source,
  save,
  cancel,
}: {
  source: string;
  save: (value: string) => void;
  cancel: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    image = useRef<HTMLImageElement>(null);
  const drag = useRef<{
    pointer: number;
    x: number;
    y: number;
    point: CropPoint;
  } | null>(null);
  const [dimensions, setDimensions] = useState({ width: 1, height: 1 });
  const [zoom, setZoom] = useState(1),
    [point, setPoint] = useState<CropPoint>({ x: 0, y: 0 }),
    [loaded, setLoaded] = useState(false),
    [error, setError] = useState("");
  const geometry = cropGeometry(
    dimensions.width,
    dimensions.height,
    240,
    zoom,
    point,
  );
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  function exportCrop() {
    try {
      if (!image.current || !loaded) return;
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 512;
      const context = canvas.getContext("2d");
      if (!context) throw new Error(U.cropError);
      const rect = geometry.source;
      context.drawImage(
        image.current,
        rect.x,
        rect.y,
        rect.size,
        rect.size,
        0,
        0,
        512,
        512,
      );
      save(canvas.toDataURL("image/webp", 0.9));
    } catch {
      setError(U.cropError);
    }
  }
  return (
    <dialog
      className="avatar-dialog"
      ref={dialog}
      aria-labelledby="crop-title"
      onCancel={(event) => {
        event.preventDefault();
        cancel();
      }}
    >
      <h2 id="crop-title">{U.cropTitle}</h2>
      <p className="subtle">{U.cropHint}</p>
      <div
        className="avatar-crop-area"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = {
            pointer: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            point: geometry.offset,
          };
        }}
        onPointerMove={(event) => {
          const d = drag.current;
          if (!d || d.pointer !== event.pointerId) return;
          setPoint(
            cropGeometry(dimensions.width, dimensions.height, 240, zoom, {
              x: d.point.x + event.clientX - d.x,
              y: d.point.y + event.clientY - d.y,
            }).offset,
          );
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
      >
        <img
          ref={image}
          src={source}
          alt={C.common.avatarAlt}
          draggable={false}
          onLoad={(event) => {
            setDimensions({
              width: event.currentTarget.naturalWidth,
              height: event.currentTarget.naturalHeight,
            });
            setLoaded(true);
          }}
          onError={() => setError(U.cropError)}
          style={{
            width: dimensions.width * geometry.scale,
            height: dimensions.height * geometry.scale,
            transform: `translate(-50%, -50%) translate(${geometry.offset.x}px, ${geometry.offset.y}px)`,
          }}
        />
      </div>
      <label className="crop-zoom">
        {U.zoom}
        <input
          type="range"
          min="1"
          max="3"
          step="0.01"
          value={zoom}
          onChange={(event) => {
            const next = Number(event.target.value);
            setPoint(
              cropGeometry(
                dimensions.width,
                dimensions.height,
                240,
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
          disabled={!loaded}
          onClick={exportCrop}
        >
          {U.saveCrop}
        </button>
        <button type="button" onClick={cancel}>
          {C.common.cancel}
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
    </dialog>
  );
}

export function AvatarEditor({
  value,
  name,
  onChange,
}: {
  value: string | null;
  name: string;
  onChange: (value: string | null) => void;
}) {
  const [source, setSource] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="avatar-editor">
      <Avatar avatar={value} name={name} large />
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={busy}
      >
        {busy ? C.common.loading : U.changeAvatar}
      </button>
      <input
        ref={input}
        className="visually-hidden"
        type="file"
        aria-label={C.common.uploadAvatar}
        accept="image/png,image/jpeg,image/webp,image/gif"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          setBusy(true);
          setError("");
          try {
            setSource(await readImage(file));
          } catch (error) {
            setError(error instanceof Error ? error.message : U.cropError);
          } finally {
            setBusy(false);
          }
        }}
      />
      <details>
        <summary>{U.imageUrl}</summary>
        <label>
          {C.fields.avatar}
          <input
            autoComplete="off"
            value={value ?? ""}
            onChange={(event) => onChange(event.target.value || null)}
            maxLength={600000}
          />
        </label>
      </details>
      {value && (
        <button
          type="button"
          className="text-button subtle"
          onClick={() => onChange(null)}
        >
          {C.common.clearAvatar}
        </button>
      )}
      <small className="subtle">{U.gifHint}</small>
      {error && <p role="alert">{error}</p>}
      {source && (
        <CropEditor
          source={source}
          save={(value) => {
            onChange(value);
            setSource(null);
          }}
          cancel={() => setSource(null)}
        />
      )}
    </div>
  );
}
