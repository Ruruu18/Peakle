import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Peakle Organizer",
    short_name: "Peakle Org",
    description: "The operations workspace for Peakle organizers.",
    id: "/overview",
    start_url: "/overview",
    scope: "/",
    display: "standalone",
    background_color: "#F3F5EF",
    theme_color: "#0E2321",
    orientation: "any",
    categories: ["sports", "business", "productivity"],
    icons: [
      { src: "/icon.png", sizes: "1024x1024", type: "image/png", purpose: "any" },
      { src: "/icon.png", sizes: "1024x1024", type: "image/png", purpose: "maskable" },
    ],
  };
}
