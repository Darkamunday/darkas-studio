import { requireAdmin } from "@/lib/auth";
import { getI18n } from "@/lib/i18n/server";
import { AdminTabs } from "./tabs";

// The admin area's heading and tab bar. Detail pages (e.g. /admin/lyrics/…) sit outside this group.
export default async function AdminTabsLayout({ children }: LayoutProps<"/admin">) {
  await requireAdmin();
  const { m } = await getI18n();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-4xl font-semibold sm:text-5xl">{m.nav.admin}</h1>
        <p className="mt-3 text-muted">{m.admin.blurb}</p>
      </div>
      <AdminTabs />
      {children}
    </div>
  );
}
