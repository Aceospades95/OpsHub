import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getSidebarConfig } from "@/actions/sidebar";
import { PageHeader } from "@/components/layout/page-header";
import { SidebarEditor } from "./sidebar-editor";
import Link from "next/link";

export default async function AdminSidebarPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "ADMIN") redirect("/dashboard");

  const [config, customPages] = await Promise.all([
    getSidebarConfig(),
    db.sandboxPage.findMany({
      where: { published: true },
      select: { id: true, title: true },
      orderBy: { title: "asc" },
    }),
  ]);

  return (
    <div>
      <PageHeader
        title="Sidebar Layout"
        description="Organize navigation sections and modules"
        actions={
          <Link
            href="/admin/users"
            className="inline-flex items-center justify-center rounded font-medium transition-colors h-10 px-4 py-2 border border-border bg-background hover:bg-muted text-foreground text-sm"
          >
            Back to Users
          </Link>
        }
      />
      <SidebarEditor initialConfig={config} customPages={customPages} />
    </div>
  );
}
