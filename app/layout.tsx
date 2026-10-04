import type { Metadata, Viewport } from "next";
import { PhoneShell } from "../components/phone-shell";
import { ThemeProvider } from "../components/theme-provider";
import { FoundationProvider } from "../components/foundation-provider";
import { StandaloneMode } from "../components/standalone-mode";
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
        <StandaloneMode />
        <main className="app-root">
          <PhoneShell>
            <ThemeProvider>
              <FoundationProvider>{children}</FoundationProvider>
            </ThemeProvider>
          </PhoneShell>
        </main>
      </body>
    </html>
  );
}
