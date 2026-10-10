"use client";

import { useId, useState } from "react";
import { APP_REGISTRY, type AppId } from "../lib/app-registry";
import { AppIcon } from "./app-icon";

export function HomeEditShell({ onDone, onAddApp, availableApps, disabled }: {
  onDone: () => void;
  onAddApp: (appId: AppId) => Promise<string | null>;
  availableApps: readonly AppId[];
  disabled: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState("");
  const menuId = useId();
  const pickerId = useId();
  const candidates = APP_REGISTRY.filter((app) => availableApps.includes(app.id));
  return (
    <div className="home-edit-shell">
      <div className="home-edit-actions">
        <button type="button" disabled={disabled} aria-expanded={menuOpen}
          aria-controls={menuId} onClick={() => {
            setPickerOpen(false);
            setMenuOpen((open) => !open);
          }}>
          Edit
        </button>
        <button type="button" disabled={disabled} onClick={() => {
          setMenuOpen(false);
          setPickerOpen(false);
          onDone();
        }}>Done</button>
      </div>
      {menuOpen && (
        <div className="home-edit-menu" id={menuId}>
          {/* Not built yet: shown but disabled so it does not look like it does something. */}
          <button type="button" disabled>Add Widget</button>
          <button type="button" onClick={() => {
            setMenuOpen(false);
            setError("");
            setPickerOpen(true);
          }}>Add App</button>
          <button type="button" disabled>Edit Pages</button>
        </div>
      )}
      {pickerOpen && (
        <div className="home-add-app-picker" id={pickerId} role="dialog" aria-label="Add App">
          <div className="home-add-app-heading">
            <strong>Add App</strong>
            <button type="button" onClick={() => setPickerOpen(false)}>Close</button>
          </div>
          {candidates.length ? (
            <div className="home-add-app-list">
              {candidates.map((app) => (
                <AppIcon
                  key={app.id}
                  id={app.id}
                  editing
                  actionLabel={`Add ${app.label}`}
                  disabled={disabled}
                  onSelect={() => void onAddApp(app.id).then((message) => {
                    if (message) setError(message);
                    else setPickerOpen(false);
                  })}
                />
              ))}
            </div>
          ) : <p>All apps are on Home.</p>}
          {error && <p className="home-add-app-error" role="alert">{error}</p>}
        </div>
      )}
    </div>
  );
}
