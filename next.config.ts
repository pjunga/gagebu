import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  distDir: process.env.FIREBASE_BUILD ? ".next-firebase" : ".next",
};

export default nextConfig;
