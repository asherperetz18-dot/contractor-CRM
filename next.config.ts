import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Next.js defaults Server Actions to a 1MB request body, which
    // silently rejects lead file uploads above ~1MB (below our own
    // 1500KB/20MB size checks in lead-files.ts). Raise the ceiling to
    // cover the largest case (20MB, once Google Drive is connected).
    serverActions: {
      bodySizeLimit: "25mb",
    },
  },
};

export default nextConfig;
