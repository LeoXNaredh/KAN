import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@kan/core", "@kan/ai-abstraction"],
};

export default nextConfig;
