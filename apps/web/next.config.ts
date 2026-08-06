import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@kan/core", "@kan/ai-abstraction", "@kan/plugin-contract"],
};

export default nextConfig;
