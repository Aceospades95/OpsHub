import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getVisibleModules } from "@/lib/permissions";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";

export default async function PlatformLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const [visibleModules, customPages] = await Promise.all([
    getVisibleModules(session.user.id, session.user.role),
    db.sandboxPage.findMany({
      where: { published: true },
      select: { id: true, title: true, slug: true },
      orderBy: { title: "asc" },
    }),
  ]);

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        visibleModules={visibleModules}
        userRole={session.user.role}
        customPages={customPages}
      />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header
          userName={session.user.name}
          userEmail={session.user.email}
          userRole={session.user.role}
        />
        <main className="flex-1 overflow-y-auto bg-muted p-4 sm:p-6 lg:p-8">
          <div className="mx-auto max-w-7xl">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
