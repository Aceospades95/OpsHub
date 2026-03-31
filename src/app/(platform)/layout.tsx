import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
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

  const visibleModules = await getVisibleModules(session.user.id, session.user.role);

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar visibleModules={visibleModules} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header
          userName={session.user.name}
          userEmail={session.user.email}
          userRole={session.user.role}
        />
        <main className="flex-1 overflow-y-auto bg-muted p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
