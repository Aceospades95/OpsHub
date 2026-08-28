import { requireAuth } from "@/lib/permissions";
import { redirect } from "next/navigation";

import { db } from "@/lib/db";
import { MODULES } from "@/lib/modules";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { ModuleVisibilityList } from "./module-visibility-list";

export const metadata = { title: "Modules · OpsHub" };

/** Sidebar lifelines — mirrored in the action's NEVER_HIDDEN set. */
const NEVER_HIDDEN = new Set(["my", "dashboard", "settings"]);

export default async function AdminModulesPage() {
  const user = await requireAuth();
  if (user.role !== "ADMIN") redirect("/dashboard");

  const rows = await db.moduleSetting.findMany();
  const hiddenByKey = new Map(rows.map((r) => [r.module, r.hiddenInSidebar]));

  const modules = MODULES.filter((m) => !NEVER_HIDDEN.has(m.key)).map((m) => ({
    key: m.key,
    label: m.label,
    description: m.description,
    section: m.section,
    hidden: hiddenByKey.get(m.key) ?? false,
  }));

  return (
    <div>
      <PageHeader
        title="Modules"
        description="Choose which modules appear in the sidebar. Hiding is org-wide and reversible — pages stay reachable by URL, and permissions still control the data."
      />
      <Card>
        <CardContent className="pt-6">
          <p className="text-xs text-muted-foreground mb-4">
            Empty modules train people to ignore the sidebar. Hide the ones
            you aren&apos;t using yet and bring them back when they have data.
          </p>
          <ModuleVisibilityList modules={modules} />
        </CardContent>
      </Card>
    </div>
  );
}
