import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import type { Role } from "@prisma/client";
import { getVisibleModules, canAccessSandbox, getGrantedCustomPageIds } from "@/lib/permissions";
import { getSidebarConfig } from "@/actions/sidebar";
import { getBellUnreadCount, getUserNotifications } from "@/lib/notifications";
import { getBranding } from "@/lib/branding";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { CommandPalette } from "@/components/layout/command-palette";
import { RSCPrefetchHealing } from "@/components/layout/rsc-prefetch-healing";
import { Toaster } from "sonner";

/**
 * The full authenticated chrome — sidebar, top bar, command palette,
 * RSC prefetch healing — wrapping arbitrary children.
 *
 * Originally lived inline in `(platform)/layout.tsx`. Round-9 QA
 * flagged that the global 404 page (for routes outside the
 * (platform) segment, e.g. typo'd /admin/email) rendered as a bare
 * black page without theme, sidebar, or any way back. Extracting
 * the chrome into a server component lets `src/app/not-found.tsx`
 * re-use the exact same shell instead of duplicating the data
 * fetches.
 *
 * Behavior is identical to the previous inline implementation:
 *   - Redirects to /login when no session.
 *   - Refreshes the role from the DB (JWT can be stale).
 *   - Fetches sidebar config, custom sandbox pages, branding,
 *     unread count, recent notifications, all in parallel.
 *
 * Pure server component — keep it that way so dynamic-only
 * `auth()` and `db` calls work without "use client" gymnastics.
 */
export async function PlatformShell({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const freshUser = await db.user.findUnique({
    where: { id: session.user.id },
    select: { role: true },
  });
  if (freshUser) session.user.role = freshUser.role as Role;

  const role = (freshUser?.role ?? session.user.role) as Role;

  const [sidebarConfig, customPages, unreadCount, recentNotifications, branding, visibleModules] = await Promise.all([
    getSidebarConfig(),
    // Sandbox custom pages: ADMIN / DEVELOPER get every published page;
    // other roles only get the published pages they hold an explicit
    // `custom-page-{id}` grant for (team permissions grid), so the
    // sidebar shows those without shipping the full list to everyone.
    canAccessSandbox(role)
      ? db.sandboxPage.findMany({
          where: { published: true },
          select: { id: true, title: true, slug: true },
          orderBy: { title: "asc" },
        })
      : getGrantedCustomPageIds(session.user.id).then((ids) =>
          ids.size === 0
            ? []
            : db.sandboxPage.findMany({
                where: { id: { in: Array.from(ids) }, published: true },
                select: { id: true, title: true, slug: true },
                orderBy: { title: "asc" },
              })
        ),
    getBellUnreadCount(session.user.id, freshUser?.role ?? session.user.role),
    getUserNotifications(session.user.id, { limit: 10 }),
    getBranding(),
    // Permission-aware module list — the sidebar only renders permissioned
    // modules whose key is in here.
    getVisibleModules(session.user.id, role),
  ]);

  const serializedNotifications = recentNotifications.map((n) => ({
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    href: n.href,
    readAt: n.readAt?.toISOString() || null,
    createdAt: n.createdAt.toISOString(),
  }));

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        userRole={session.user.role}
        visibleModules={visibleModules}
        customPages={customPages}
        sidebarConfig={sidebarConfig}
        companyName={branding.companyName}
        companyLogoUrl={branding.companyLogoUrl}
      />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header
          userId={session.user.id}
          userName={session.user.name}
          userEmail={session.user.email}
          userRole={session.user.role}
          unreadNotifications={unreadCount}
          recentNotifications={serializedNotifications}
        />
        <main className="flex-1 overflow-auto page-bg p-4 sm:p-6 lg:p-8">
          <div className="mx-auto max-w-[1600px]">{children}</div>
        </main>
      </div>
      <CommandPalette />
      <RSCPrefetchHealing />
      {/* Round-9 QA: round-8 archive "undo" rendered as a 10px
       *  muted-color span inside the row — functionally there but
       *  practically invisible. Mount sonner's Toaster once at the
       *  shell so any client component can call toast() and get a
       *  card-sized, themed, dismissible affordance. */}
      <Toaster position="bottom-right" richColors closeButton duration={6000} />
    </div>
  );
}
