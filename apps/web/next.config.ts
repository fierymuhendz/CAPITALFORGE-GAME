import type { NextConfig } from "next";

/** Sunucu adresi yalnızca Next sunucu tarafında kullanılır (istemciye girmez). */
const gameServerUrl = process.env.GAME_SERVER_HTTP_URL ?? "http://localhost:2567";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@capitalforge/shared", "@capitalforge/economy"],
  async rewrites() {
    // Yerel geliştirme: /api/* → oyun sunucusu (önek kırpılır). Üretimde Caddy bu yolu doğrudan sunucuya yollar.
    return [{ source: "/api/:path*", destination: `${gameServerUrl}/:path*` }];
  },
};

export default nextConfig;
