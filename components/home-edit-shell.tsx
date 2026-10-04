"use client";

import { useId, useState } from "react";

export function HomeEditShell({ onDone, disabled }: {
  onDone: () => void;
  disabled: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuId = useId();
  return (
    <div className="home-edit-shell">
      <div className="home-edit-actions">
        <button type="button" disabled={disabled} aria-expanded={menuOpen}
          aria-controls={menuId} onClick={() => setMenuOpen((open) => !open)}>
          Edit
        </button>
        <button type="button" disabled={disabled} onClick={() => {
          setMenuOpen(false);
          onDone();
        }}>Done</button>
      </div>
      {menuOpen && (
        <div className="home-edit-menu" id={menuId}>
          <button type="button">Add Widget</button>
          <button type="button">Add App</button>
          <button type="button">Edit Pages</button>
        </div>
      )}
    </div>
  );
}
