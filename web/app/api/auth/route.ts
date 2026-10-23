import { NextRequest, NextResponse } from "next/server";

const COOKIE = "mb_auth";

async function sha256(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function isHttps(req: NextRequest) {
  return req.headers.get("x-forwarded-proto") === "https" || req.nextUrl.protocol === "https:";
}

// 登录：POST {"password": "..."}
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const password = process.env.APP_PASSWORD?.trim();

  // 没配置密码时不启用鉴权，直接放行
  if (!password) return NextResponse.json({ ok: true, auth: false });

  if (typeof body?.password !== "string" || body.password !== password) {
    return NextResponse.json({ error: "密码不正确" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true, auth: true });
  res.cookies.set(COOKIE, await sha256(password), {
    httpOnly: true,
    sameSite: "lax",
    secure: isHttps(req),
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}

// 退出登录：DELETE
export async function DELETE(req: NextRequest) {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: isHttps(req),
    path: "/",
    maxAge: 0,
  });
  return res;
}
