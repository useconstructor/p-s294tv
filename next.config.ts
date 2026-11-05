import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Keep request-time route caching in memory so production artifacts stay immutable.
    isrFlushToDisk: false,
  },
};

export default nextConfig;
