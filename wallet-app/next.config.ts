import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  allowedDevOrigins: [
    "localhost",
    "127.0.0.1",
    "192.168.1.8",
    "46.225.3.119",
    "172.16.230.116",
  ],
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
