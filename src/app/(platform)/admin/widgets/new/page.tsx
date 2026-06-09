import { requireAuth } from "@/lib/permissions";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { WidgetBuilder } from "../widget-builder";

export default async function NewWidgetPage() {
  const user = await requireAuth();
  if (user.role !== "ADMIN" && user.role !== "DEVELOPER") redirect("/dashboard");

  return (
    <div>
      <PageHeader title="Create Widget" description="Build a new custom widget" />
      <WidgetBuilder />
    </div>
  );
}
