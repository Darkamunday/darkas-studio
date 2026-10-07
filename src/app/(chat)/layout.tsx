import { requireUser } from "@/lib/auth";
import { AppHeader } from "@/components/app-header";

// Chat fills the screen under the header (no page padding or footer), so it gets its own layout.
// On phones the nav links live in the chat drawer instead of a second header row.
export default async function ChatLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  return (
    <div className="flex h-dvh flex-col">
      <AppHeader user={user} compact />
      <main className="flex min-h-0 flex-1">{children}</main>
    </div>
  );
}
