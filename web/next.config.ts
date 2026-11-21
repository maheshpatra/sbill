import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: { unoptimized: true },
  transpilePackages: ["@billflow/host-resolution", "@billflow/storefront", "@billflow/upi", "@billflow/api-client"],
};

export default nextConfig;
