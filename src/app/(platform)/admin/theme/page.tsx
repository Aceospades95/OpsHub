import { requireAuth } from "@/lib/permissions";
import { getThemeSettings, getCustomPresets } from "@/actions/theme";
import { getBranding } from "@/lib/branding";
import { DEFAULT_THEME } from "@/lib/theme-defaults";
import { PageHeader } from "@/components/layout/page-header";
import { ThemeEditor } from "./theme-editor";
import { BrandingSection } from "./branding-section";

export default async function AdminThemePage() {
  const user = await requireAuth();
  if (user.role !== "ADMIN") {
    const { AccessDenied } = await import("@/components/shared/access-denied");
    return <AccessDenied module="settings" moduleLabel="Theme Settings" />;
  }

  const [savedSettings, branding, customPresets] = await Promise.all([
    getThemeSettings(),
    getBranding(),
    getCustomPresets(),
  ]);
  const currentTheme = { ...DEFAULT_THEME, ...savedSettings };

  return (
    <div>
      <PageHeader
        title="Theme Settings"
        description="Customize branding, colors, and the look and feel of OpsHub"
      />
      <BrandingSection branding={branding} />
      <ThemeEditor currentTheme={currentTheme} customPresets={customPresets} />
    </div>
  );
}
