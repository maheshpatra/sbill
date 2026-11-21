import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@billflow/upi", "@billflow/gst", "@billflow/api-client", "@billflow/types"],
  devIndicators: false,
};

export default nextConfig;
