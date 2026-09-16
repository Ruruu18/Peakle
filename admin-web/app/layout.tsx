import type { Metadata } from "next";
import localFont from "next/font/local";
import { Providers } from "@/components/providers";
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

export const metadata: Metadata = {
  title: { default: "Peakle Admin", template: "%s · Peakle Admin" },
  description: "Platform administration for Peakle.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={ppMori.variable}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
