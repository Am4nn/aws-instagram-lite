import type { NextConfig } from "next";

// Static export: `next build` writes plain files to out/, hosted on S3 (+ CloudFront).
const config: NextConfig = {
  output: "export",
  images: { unoptimized: true },
};

export default config;
