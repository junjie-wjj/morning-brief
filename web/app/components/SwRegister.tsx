"use client";

import { useEffect } from "react";

// 注册最小 Service Worker（仅为满足 PWA 可安装条件；SW 本身不缓存任何内容）
export default function SwRegister() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const t = setTimeout(() => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* 注册失败不影响站点正常使用 */
      });
    }, 1500);
    return () => clearTimeout(t);
  }, []);
  return null;
}
