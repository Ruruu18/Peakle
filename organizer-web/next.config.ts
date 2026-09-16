import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  // Court artwork is shared with the Expo app in ../shared.
  turbopack: { root: path.resolve(__dirname, "..") },
};

export default nextConfig;
