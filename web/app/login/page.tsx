"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { IconSun } from "../components/Icons";

function LoginForm() {
  const params = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const rawNext = params.get("next") ?? "/";
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") && !rawNext.startsWith("/login")
    ? rawNext
    : "/";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        setError("密码不正确");
        return;
      }
      // 用整页跳转而不是 router.replace：确保浏览器带上刚写入的 cookie，
      // 避免 proxy 在客户端路由请求里看到旧状态又跳回登录页。
      window.location.assign(next);
    } catch {
      setError("网络错误，请重试");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto mt-10 max-w-md">
      <div className="rounded-3xl border border-line bg-white p-6 shadow-soft sm:p-8">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-amber-400 to-orange-600 text-white shadow-sm">
            <IconSun className="h-6 w-6" />
          </span>
          <div>
            <h1 className="font-serif text-xl font-semibold tracking-tight text-ink">信息早餐</h1>
            <p className="text-xs text-muted">输入访问密码继续</p>
          </div>
        </div>

        <form onSubmit={submit} className="mt-6 space-y-3">
          <label className="block text-sm font-medium text-ink-soft" htmlFor="password">
            访问密码
          </label>
          <input
            id="password"
            type="password"
            autoFocus
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="请输入密码"
            className="w-full rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-ink outline-none transition-colors placeholder:text-stone-300 focus:border-amber-400"
          />
          {error ? (
            <p className="text-sm text-rose-600" role="alert">{error}</p>
          ) : null}
          <button
            type="submit"
            disabled={busy || !password}
            className="w-full rounded-xl bg-ink px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-stone-700 disabled:opacity-60"
          >
            {busy ? "验证中…" : "进入"}
          </button>
        </form>

        <p className="mt-4 text-[11px] leading-5 text-muted">
          这是个人简报应用，仅限本人访问。密码由站点环境变量 <code className="rounded bg-paper-deep px-1">APP_PASSWORD</code> 配置。
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
