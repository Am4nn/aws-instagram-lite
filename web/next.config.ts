import type { NextConfig } from "next";

// Step 9: server-rendered on Lambda (built by OpenNext: `npx open-next build`, see open-next.config.ts).
// In production CloudFront serves /_next/static/* and /media/* from S3 itself; the server only renders pages.
const mediaDev = process.env.MEDIA_DEV_ORIGIN; // next dev only (web/.env.development.local)

const config: NextConfig = {
  images: { unoptimized: true }, // the upload pipeline already makes thumbnails
  poweredByHeader: false,
  // next dev has no CloudFront in front: fetch /media/* from Floci's S3 instead.
  ...(mediaDev ? { rewrites: async () => [{ source: "/media/:path*", destination: `${mediaDev}/media/:path*` }] } : {}),
};

export default config;
