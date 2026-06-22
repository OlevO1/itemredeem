import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async rewrites() {
    const backendUrl = process.env.BACKEND_URL || "http://localhost:3067";

    return [
      {
        source: "/redeemapi/:path*",
        destination: `${backendUrl.replace(/\/$/, "")}/:path*`,
      },
    ];
  },
};

export default nextConfig;
