import type { MetadataRoute } from "next";

// PWA 清单：让站点可以「添加到主屏幕」，以独立窗口（无浏览器地址栏）打开。
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "信息早餐 · AI Daily Brief",
    short_name: "信息早餐",
    description: "每天早上 7 点自动生成的个人 AI 资讯早餐",
    start_url: "/",
    display: "standalone",
    background_color: "#FFFAF0",
    theme_color: "#F59E0B",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
