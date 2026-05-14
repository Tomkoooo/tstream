import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  output: "standalone",
  allowedDevOrigins: ['32cf-178-48-68-9.ngrok-free.app']
};

export default nextConfig;
