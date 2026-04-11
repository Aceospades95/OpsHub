import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getVisibleModules } from "@/lib/permissions";
import { getSidebarConfig } from "@/actions/sidebar";
import { getUnreadCount, getUserNotifications } from "@/lib/notifications";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";

export default async function PlatformLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const [visibleModules, sidebarConfig, customPages, unreadCount, recentNotifications] = await Promise.all([
    getVisibleModules(session.user.id, session.user.role),
    getSidebarConfig(),
    db.sandboxPage.findMany({
      where: { published: true },
      select: { id: true, title: true, slug: true },
      orderBy: { title: "asc" },
    }),
    getUnreadCount(session.user.id),
    getUserNotifications(session.user.id, { limit: 10 }),
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
        visibleModules={visibleModules}
        userRole={session.user.role}
        customPages={customPages}
        sidebarConfig={sidebarConfig}
      />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header
          userName={session.user.name}
          userEmail={session.user.email}
          userRole={session.user.role}
          unreadNotifications={unreadCount}
          recentNotifications={serializedNotifications}
        />
        <main className="flex-1 overflow-y-auto page-bg p-4 sm:p-6 lg:p-8">
          <div className="mx-auto max-w-7xl">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
