/* 信息早餐 Service Worker（最小可用版）
 * 只为满足 PWA 可安装条件注册存在；内容全部直连网络、不做缓存——
 * 这个站是登录态的动态内容，缓存 HTML 会带来旧数据和鉴权错乱，弊大于利。 */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {
  /* passthrough：不拦截，浏览器默认行为 */
});
