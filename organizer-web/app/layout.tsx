import type { Metadata, Viewport } from "next";
import { Providers } from "@/components/providers";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Peakle Organizer", template: "%s · Peakle Organizer" },
  description: "Run your venues, sessions, players, programs, and competitions from one court-ready workspace.",
  applicationName: "Peakle Organizer",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Peakle Organizer" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F3F5EF" },
    { media: "(prefers-color-scheme: dark)", color: "#0E2321" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
