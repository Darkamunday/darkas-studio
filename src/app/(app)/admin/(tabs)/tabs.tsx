"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n } from "@/lib/i18n/client";

export function AdminTabs() {
  const pathname = usePathname();
  const { m } = useI18n();
  const tabs = [
    { href: "/admin", label: m.admin.tabOverview },
    { href: "/admin/people", label: m.admin.tabPeople },
    { href: "/admin/chat", label: m.admin.tabChat },
    { href: "/admin/songs", label: m.admin.tabSongs },
  ];

  return (
    // Scrolls sideways on narrow phones rather than wrapping.
    <nav aria-label={m.nav.admin} className="-mx-4 overflow-x-auto px-4">
      <div className="flex w-max gap-1 rounded-2xl border border-line bg-surface p-1 shadow-card">
        {tabs.map((t) => {
          const active = t.href === "/admin" ? pathname === "/admin" : pathname.startsWith(t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={active ? "page" : undefined}
              className={`whitespace-nowrap rounded-xl px-4 py-2 text-sm font-medium transition ${
                active ? "bg-brand text-white shadow-glow" : "text-muted hover:bg-surface-2 hover:text-fg"
              }`}
            >
              {t.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
