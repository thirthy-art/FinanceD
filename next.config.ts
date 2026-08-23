import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdf-parse", "pdfjs-dist", "tesseract.js", "pg"],
  experimental: {},
};

export default nextConfig;
