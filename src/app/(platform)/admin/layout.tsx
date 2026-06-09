import { requireAuth } from "@/lib/permissions";
import { AccessDenied } from "@/components/shared/access-denied";
import { SettingsNav } from "./settings-nav";

/**
 * Central gate for the whole /admin segment. requireAuth() re-reads the
 * role from the DB (the JWT copy can be stale), so role demotions take
 * effect immediately. DEVELOPER is allowed through because the widget
 * builder pages are ADMIN | DEVELOPER; pages that are ADMIN-only keep
 * their own stricter check.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireAuth();
  if (user.role !== "ADMIN" && user.role !== "DEVELOPER") {
    return (
      <AccessDenied
        module="settings"
        moduleLabel="Settings"
        moduleDescription="Admin, theme, imports, reports, and system configuration"
      />
    );
  }

  return (
    <>
      <SettingsNav />
      {children}
    </>
  );
}
