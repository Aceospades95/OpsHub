import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getThemeSettings } from "@/actions/theme";
import { DEFAULT_THEME } from "@/lib/theme-defaults";
import { PageHeader } from "@/components/layout/page-header";
import { ThemeEditor } from "./theme-editor";
import Link from "next/link";

export default async function AdminThemePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "ADMIN") redirect("/dashboard");

  const savedSettings = await getThemeSettings();
  const currentTheme = { ...DEFAULT_THEME, ...savedSettings };

  return (
    <div>
      <PageHeader
        title="Theme Settings"
        description="Customize the look and feel of OpsHub"
        actions={
          <Link
            href="/team"
            className="inline-flex items-center justify-center rounded font-medium transition-colors h-10 px-4 py-2 border border-border bg-background hover:bg-muted text-foreground text-sm"
          >
            Back to Team
          </Link>
        }
      />
      <ThemeEditor currentTheme={currentTheme} />
    </div>
  );
}
