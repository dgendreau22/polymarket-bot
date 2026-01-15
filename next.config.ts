import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Disable Next.js request logging in development
  // Set to true or remove this block to re-enable
  logging: {
    fetches: {
      fullUrl: false,
    },
  },
};

export default nextConfig;
