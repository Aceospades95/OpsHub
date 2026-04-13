import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import {
  Shield,
  Blocks,
  Puzzle,
  Palette,
  PanelLeft,
  Mail,
  Bell,
  Repeat,
  FileSpreadsheet,
  BarChart3,
} from "lucide-react";

const SETTINGS_SECTIONS = [
  {
    title: "General",
    items: [
      { label: "Users & Permissions", href: "/admin/users", icon: Shield, description: "Manage user accounts, roles, and module permissions" },
      { label: "Custom Pages", href: "/sandbox", icon: Blocks, description: "Build and manage custom pages" },
      { label: "Widget Builder", href: "/admin/widgets", icon: Puzzle, description: "Create and publish custom dashboard widgets" },
    ],
  },
  {
    title: "Appearance",
    items: [
      { label: "Theme", href: "/admin/theme", icon: Palette, description: "Branding, color palette, and theme configuration" },
      { label: "Sidebar", href: "/admin/sidebar", icon: PanelLeft, description: "Sidebar layout and section ordering" },
    ],
  },
  {
    title: "Data",
    items: [
      { label: "Data Import", href: "/admin/import", icon: FileSpreadsheet, description: "Bulk-create records from CSV uploads" },
      { label: "Reports", href: "/admin/reports", icon: BarChart3, description: "Saved reports, CSV downloads, and email digests" },
    ],
  },
  {
    title: "System",
    items: [
      { label: "Email Log", href: "/admin/emails", icon: Mail, description: "Outbound email audit log and test sender" },
      { label: "Notifications", href: "/admin/notifications", icon: Bell, description: "In-app notification audit and test sender" },
      { label: "Scheduled Jobs", href: "/admin/jobs", icon: Repeat, description: "Recurring background jobs and run history" },
    ],
  },
];

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "ADMIN") redirect("/dashboard");

  return (
    <div>
      <PageHeader
        title="Settings"
        description="System configuration, appearance, data tools, and administration."
      />

      <div className="space-y-6">
        {SETTINGS_SECTIONS.map((section) => (
          <div key={section.title}>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              {section.title}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {section.items.map((item) => {
                const Icon = item.icon;
                return (
                  <Link key={item.href} href={item.href}>
                    <Card className="hover:border-primary hover:bg-muted/40 transition-colors h-full">
                      <CardContent className="p-4 flex items-start gap-3">
                        <div className="rounded-lg bg-primary/10 p-2 shrink-0">
                          <Icon className="h-5 w-5 text-primary" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold">{item.label}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {item.description}
                          </p>
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
