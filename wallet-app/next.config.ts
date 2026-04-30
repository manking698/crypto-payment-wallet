import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  allowedDevOrigins: [
    "localhost",
    "127.0.0.1",
    "192.168.1.8",
    "172.16.230.116",
  ],
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
