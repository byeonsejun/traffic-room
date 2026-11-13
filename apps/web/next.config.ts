import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@traffic-room/shared", "@traffic-room/db", "@traffic-room/its", "@traffic-room/highways"],
  // dev 픽스처 전용 highways.json(1.5MB)을 운영 함수 번들에 싣지 않는다.
  outputFileTracingExcludes: { "/api/traffic": ["**/highways.*.json", "./public/highways.json"] },
  serverExternalPackages: ["@electric-sql/pglite"],
};

export default nextConfig;
