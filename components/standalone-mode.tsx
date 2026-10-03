"use client";

import { useEffect } from "react";

// Presentation only. Older iOS versions expose navigator.standalone instead of
// the display-mode query; retain that fallback without changing stored themes.
export function StandaloneMode() {
  useEffect(() => {
    const mode = window.matchMedia("(display-mode: standalone)");
    const mobile = window.matchMedia("(hover: none) and (pointer: coarse)");
    const update = () => {
      const apple = (navigator as Navigator & { standalone?: boolean })
        .standalone;
      if (mobile.matches && (mode.matches || apple === true)) {
        document.documentElement.dataset.mobileStandalone = "true";
      } else {
        delete document.documentElement.dataset.mobileStandalone;
      }
    };
    update();
    mode.addEventListener("change", update);
    mobile.addEventListener("change", update);
    return () => {
      mode.removeEventListener("change", update);
      mobile.removeEventListener("change", update);
      delete document.documentElement.dataset.mobileStandalone;
    };
  }, []);
  return null;
}
