import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { WidgetBuilder } from "../widget-builder";

export default async function NewWidgetPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "ADMIN" && session.user.role !== "DEVELOPER") redirect("/dashboard");

  return (
    <div>
      <PageHeader title="Create Widget" description="Build a new custom widget" />
      <WidgetBuilder />
    </div>
  );
}
