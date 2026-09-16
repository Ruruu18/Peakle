import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { Providers } from "@/components/providers";
import { organizerSiteDescription } from "@/lib/launch-offer";
import "./globals.css";

const ppMori = localFont({
  src: [
    { path: "./fonts/pp-mori/ppmori-regular.otf", weight: "400", style: "normal" },
    { path: "./fonts/pp-mori/ppmori-semibold.otf", weight: "600", style: "normal" },
    { path: "./fonts/pp-mori/ppmori-extralight.otf", weight: "200", style: "normal" },
    { path: "./fonts/pp-mori/ppmori-regularitalic.otf", weight: "400", style: "italic" },
    { path: "./fonts/pp-mori/ppmori-semibolditalic.otf", weight: "600", style: "italic" },
    { path: "./fonts/pp-mori/ppmori-extralightitalic.otf", weight: "200", style: "italic" },
  ],
  variable: "--font-pp-mori",
  display: "swap",
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://organizer.peakle.app";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: "Peakle Organizer — Run your whole pickleball venue", template: "%s · Peakle Organizer" },
  description: organizerSiteDescription,
  applicationName: "Peakle Organizer",
  keywords: ["pickleball venue software", "pickleball booking system", "open play management", "court booking software", "pickleball club management", "sports venue software Philippines"],
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Peakle Organizer" },
  openGraph: {
    type: "website",
    siteName: "Peakle Organizer",
    title: "Peakle Organizer — Run your whole pickleball venue",
    description: organizerSiteDescription,
    url: siteUrl,
    images: [{ url: "/ball_green.png", width: 512, height: 512, alt: "Peakle Organizer" }],
  },
  twitter: {
    card: "summary",
    title: "Peakle Organizer — Run your whole pickleball venue",
    description: organizerSiteDescription,
    images: ["/ball_green.png"],
  },
  robots: { index: true, follow: true },
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
    <html lang="en" suppressHydrationWarning className={ppMori.variable}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
