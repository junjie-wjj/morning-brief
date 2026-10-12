import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 关闭 Next 16 的实验性缓存组件：本项目每次请求都要读最新数据库状态，
  // 用经典 SSR（force-dynamic）最稳，部署平台兼容性也最好
  cacheComponents: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
