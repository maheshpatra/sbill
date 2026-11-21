import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@billflow/upi", "@billflow/gst"],
};

export default nextConfig;
