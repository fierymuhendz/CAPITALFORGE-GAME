import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@capitalforge/shared", "@capitalforge/economy"],
};

export default nextConfig;
