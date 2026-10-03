import type { Metadata, Viewport } from "next";
import { PhoneShell } from "../components/phone-shell";
import { ThemeProvider } from "../components/theme-provider";
import "./globals.css";
import "./appearance.css";
import "./desktop.css";

export const metadata: Metadata = {
  title: "VEIL",
  description: "A character-neutral companion phone app.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <main className="app-root">
          <PhoneShell>
            <ThemeProvider>{children}</ThemeProvider>
          </PhoneShell>
        </main>
      </body>
    </html>
  );
}
