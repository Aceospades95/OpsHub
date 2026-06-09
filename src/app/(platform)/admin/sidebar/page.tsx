import { requireAuth } from "@/lib/permissions";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getSidebarConfig } from "@/actions/sidebar";
import { PageHeader } from "@/components/layout/page-header";
import { SidebarEditor } from "./sidebar-editor";
import Link from "next/link";

export const metadata = { title: "Sidebar Layout · OpsHub" };

export default async function AdminSidebarPage() {
  const user = await requireAuth();
  if (user.role !== "ADMIN") redirect("/dashboard");

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


      />
      <SidebarEditor initialConfig={config} customPages={customPages} />
    </div>
  );
}
