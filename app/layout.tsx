import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { PhoneShell } from "../components/phone-shell";
import { ThemeProvider } from "../components/theme-provider";
import { FoundationProvider } from "../components/foundation-provider";
import { StandaloneMode } from "../components/standalone-mode";
import { RestoreGate } from "../components/restore-gate";
import { ProductBootstrap } from "../components/product-bootstrap";
import { MemoryMaintenanceGate } from "../components/memory-maintenance-gate";
import { ChatDiagnosticsGate } from "../components/diagnostics/chat-diagnostics";
import "./globals.css";
import "./appearance.css";
import "./desktop.css";
import "./foundation.css";
import "./mobile-foundation.css";
import "./page-shell.css";

export const metadata: Metadata = {
  title: "VEIL",
  description: "A character-neutral companion phone app.",
  applicationName: "VEIL",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "VEIL",
    statusBarStyle: "black-translucent",
  },
  other: { "apple-mobile-web-app-capable": "yes" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#fafafa",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <Script id="veil-theme-bootstrap" strategy="beforeInteractive">{`
          try {
            const saved = JSON.parse(localStorage.getItem("companion-phone.appearance.v1") || "null");
            const p = saved && saved.current && saved.current.profile;
            const c = p && p.colors;
            const color = (v, fallback) => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v : fallback;
            const values = {
              "--theme-background": color(c && c.background, "#fafafa"),
              "--theme-surface": color(c && c.surface, "#ffffff"),
              "--theme-text": color(c && c.text, "#171717"),
              "--theme-accent": color(c && c.accent, "#2563eb"),
              "--theme-dock-background": color(p && p.dock && p.dock.background, "#e9e9ec"),
              "--theme-font-size": p && p.text && typeof p.text.size === "number" && p.text.size >= 12 && p.text.size <= 24 ? p.text.size + "px" : "16px",
              "--theme-icon-radius": "16px",
            };
            values["--theme-font-family"] = p && p.text && p.text.font === "serif" ? "Georgia,serif" : p && p.text && p.text.font === "monospace" ? "monospace" : "Arial,Helvetica,sans-serif";
            values["--theme-font-weight"] = p && p.text && typeof p.text.weight === "number" && p.text.weight >= 400 && p.text.weight <= 700 ? p.text.weight : 400;
            const allowed = ["--theme-background","--theme-surface","--theme-text","--theme-accent","--theme-dock-background","--theme-font-size","--theme-icon-radius"];
            for (const [key, value] of Object.entries(p && p.cssOverrides || {})) {
              if (!allowed.includes(key) || typeof value !== "string") continue;
              if (["--theme-background","--theme-surface","--theme-text","--theme-accent","--theme-dock-background"].includes(key) && /^#[0-9a-f]{6}$/i.test(value)) values[key] = value;
              else if ((key === "--theme-font-size" || key === "--theme-icon-radius") && /^(\d+(\.\d+)?px)$/.test(value)) {
                const size = parseFloat(value);
                if (key === "--theme-font-size" ? size >= 12 && size <= 24 : size >= 0 && size <= 32) values[key] = value;
              }
            }
            const style = document.createElement("style");
            style.id = "veil-theme-bootstrap";
            style.textContent = ".theme-surface{" + Object.entries(values).map(([key,value]) => key + ":" + value + " !important").join(";") + "}";
            document.head.appendChild(style);
          } catch {}
        `}</Script>
        <StandaloneMode />
        <RestoreGate>
          <ProductBootstrap />
          <MemoryMaintenanceGate />
          <main className="app-root">
            <PhoneShell>
              <ThemeProvider>
                <FoundationProvider><ChatDiagnosticsGate>{children}</ChatDiagnosticsGate></FoundationProvider>
              </ThemeProvider>
            </PhoneShell>
          </main>
        </RestoreGate>
      </body>
    </html>
  );
}
