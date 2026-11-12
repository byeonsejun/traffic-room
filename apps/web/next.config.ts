import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@traffic-room/shared", "@traffic-room/db", "@traffic-room/its"],
  serverExternalPackages: ["@electric-sql/pglite"],
};

export default nextConfig;
