"use client";
import { useRef, useState } from "react";
import { FOUNDATION_COPY as C } from "../lib/foundation-copy";
import { readImage } from "../lib/theme-storage";
import { UI_COPY as U } from "../lib/ui-copy";
import { ImageCropDialog } from "./image-crop-dialog";
import { Avatar } from "./profile-view";

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
        accept="image/*,.heic,.heif"
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
        <ImageCropDialog
          source={source}
          title={U.cropTitle}
          alt={C.common.avatarAlt}
          onSave={(next) => {
            onChange(next);
            setSource(null);
          }}
          onUseOriginal={() => {
            onChange(source);
            setSource(null);
          }}
          onCancel={() => setSource(null)}
        />
      )}
    </div>
  );
}
