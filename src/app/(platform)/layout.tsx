import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import type { Role } from "@prisma/client";
import { getSidebarConfig } from "@/actions/sidebar";
import { getBellUnreadCount, getUserNotifications } from "@/lib/notifications";
import { getBranding } from "@/lib/branding";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { CommandPalette } from "@/components/layout/command-palette";
import { RSCPrefetchHealing } from "@/components/layout/rsc-prefetch-healing";

export default async function PlatformLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  // JWT caches the role from sign-in; refresh from DB so server-side
  // changes (auto-promotion, admin edits) are visible immediately.
  const freshUser = await db.user.findUnique({
    where: { id: session.user.id },
    select: { role: true },
  });
  if (freshUser) session.user.role = freshUser.role as Role;

  const [sidebarConfig, customPages, unreadCount, recentNotifications, branding] = await Promise.all([
    getSidebarConfig(),
    db.sandboxPage.findMany({
      where: { published: true },
      select: { id: true, title: true, slug: true },
      orderBy: { title: "asc" },
    }),
    getBellUnreadCount(session.user.id, freshUser?.role ?? session.user.role),
    getUserNotifications(session.user.id, { limit: 10 }),
    getBranding(),
  ]);

  // Serialize notification dates for the client component boundary
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
          <div className="mx-auto max-w-[1600px]">
            {children}
          </div>
        </main>
      </div>
      {/* Cmd-K palette — mounted once at the platform layout. The
       *  header's search trigger and the global ⌘K / Ctrl-K shortcut
       *  both surface this. */}
      <CommandPalette />
      {/* Wraps window.fetch to retry 503s on RSC payload requests
       *  once with jitter. Addresses the upstream load-shedding
       *  symptom that surfaces as the "Server Components render"
       *  toast. See the component for details. */}
      <RSCPrefetchHealing />
    </div>
  );
}
