import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getThemeSettings } from "@/actions/theme";
import { getBranding } from "@/lib/branding";
import { DEFAULT_THEME } from "@/lib/theme-defaults";
import { PageHeader } from "@/components/layout/page-header";
import { ThemeEditor } from "./theme-editor";
import { BrandingSection } from "./branding-section";
import Link from "next/link";

export default async function AdminThemePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "ADMIN") redirect("/dashboard");

  const [savedSettings, branding] = await Promise.all([
    getThemeSettings(),
    getBranding(),
  ]);
  const currentTheme = { ...DEFAULT_THEME, ...savedSettings };

  return (
    <div>
      <PageHeader
        title="Theme Settings"
        description="Customize branding, colors, and the look and feel of OpsHub"
        actions={
          <Link
            href="/team"
            className="inline-flex items-center justify-center rounded font-medium transition-colors h-10 px-4 py-2 border border-border bg-background hover:bg-muted text-foreground text-sm"
          >
            Back to Team
          </Link>
        }
      />
      <BrandingSection branding={branding} />
      <ThemeEditor currentTheme={currentTheme} />
    </div>
  );
}
