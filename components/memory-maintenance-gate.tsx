"use client";

import { useEffect } from "react";
import { MAINTENANCE_CONFIG_EVENT, MAINTENANCE_CONSENT_KEY, maintenanceEnabled } from "../lib/memory/maintenance-config";

/** A page owner, independent of chat routes. Activation is gated twice and defaults off. */
export function MemoryMaintenanceGate() {
  useEffect(() => {
    let revision = 0, dispose = () => {};
    const restart = () => {
      const current = ++revision; dispose(); dispose = () => {};
      if (!maintenanceEnabled()) return;
      void import("../lib/memory/maintenance-browser").then(({ startBrowserMaintenance }) => {
        if (revision === current && maintenanceEnabled()) dispose = startBrowserMaintenance();
      }).catch(() => { /* No model or storage fallback on initialization failure. */ });
    };
    restart();
    const storage = (event: StorageEvent) => { if (event.key === MAINTENANCE_CONSENT_KEY) restart(); };
    window.addEventListener(MAINTENANCE_CONFIG_EVENT, restart); window.addEventListener("storage", storage);
    window.addEventListener("pageshow", restart);
    return () => {
      revision++; dispose(); window.removeEventListener(MAINTENANCE_CONFIG_EVENT, restart);
      window.removeEventListener("storage", storage); window.removeEventListener("pageshow", restart);
    };
  }, []);
  return null;
}
