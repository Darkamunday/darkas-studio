"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLinks({ isAdmin, className = "" }: { isAdmin: boolean; className?: string }) {
  const pathname = usePathname();
  const links = [
    { href: "/generate", label: "Create" },
    { href: "/catalogue", label: "Catalogue" },
    ...(isAdmin ? [{ href: "/admin", label: "Admin" }] : []),
  ];

  return (
    <nav className={`flex items-center gap-1 ${className}`}>
      {links.map((l) => {
        const active = pathname === l.href || pathname.startsWith(`${l.href}/`);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-xl px-3.5 py-1.5 text-sm font-medium transition ${
              active ? "bg-surface-3 text-fg" : "text-muted hover:bg-surface-2 hover:text-fg"
            }`}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
