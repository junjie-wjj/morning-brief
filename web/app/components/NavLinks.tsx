"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/", label: "首页" },
  { href: "/later", label: "稍后读" },
  { href: "/archive", label: "历史" },
  { href: "/settings", label: "设置" },
];

export default function NavLinks() {
  const pathname = usePathname();

  // 登录页不显示主导航，避免点了又被拦回登录页
  if (pathname === "/login") return null;

  return (
    <nav className="flex items-center gap-0.5 overflow-x-auto sm:gap-1" aria-label="主导航">
      {ITEMS.map((item) => {
        const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`shrink-0 rounded-full px-2.5 py-1.5 text-[13px] font-medium transition-colors sm:px-3.5 sm:text-sm ${
              active
                ? "bg-ink text-white shadow-sm"
                : "text-muted hover:bg-paper-deep hover:text-ink"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
