import { NextRequest, NextResponse } from "next/server";

// 访问密码：只有设置了 APP_PASSWORD 才启用；未设置时保持原来的公开访问。
// 登录成功后写入一个 HttpOnly cookie，值是密码的 SHA-256（不存明文）。
const COOKIE = "mb_auth";

async function sha256(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export default async function proxy(req: NextRequest) {
  const password = process.env.APP_PASSWORD?.trim();
  if (!password) return NextResponse.next();

  const { pathname } = req.nextUrl;
  // 登录页和登录接口本身必须放行
  if (pathname === "/login" || pathname === "/api/auth") return NextResponse.next();

  const token = req.cookies.get(COOKIE)?.value;
  if (token && token === (await sha256(password))) return NextResponse.next();

  // API 请求返回 401，页面请求跳转到登录页
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  const target = req.nextUrl.clone();
  target.searchParams.delete("_rsc");
  const next = target.pathname + (target.search || "");
  if (next && next !== "/") url.searchParams.set("next", next);
  return NextResponse.redirect(url);
}

export const config = {
  // 静态资源不拦截；其余页面和 API 都走密码检查
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
