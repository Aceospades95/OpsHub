import Link from "next/link";

import { db } from "@/lib/db";
import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { FileText, Mail, PlayCircle, Workflow } from "lucide-react";

// Landing page for the workflows section. Acts as a hub linking out to
// templates, email templates, and (Phase 4) running instances. We keep
// this lightweight so adding a future surface (analytics, integrations)
// is just one new card.
export default async function WorkflowsLandingPage() {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "workflows");
  if (!perms.canView) {
    return (
      <AccessDenied
        module="workflows"
        moduleLabel="Workflows"
        moduleDescription="Automated onboarding, offboarding, and hiring sequences"
      />
    );
  }

  const [templateCount, emailTemplateCount, instanceCount] = await Promise.all([
    db.workflowTemplate.count({ where: { isActive: true } }),
    db.workflowEmailTemplate.count(),
    db.workflowInstance.count({
      where: { status: { in: ["PENDING", "IN_PROGRESS", "PAUSED"] } },
    }),
  ]);

  const tiles: { href: string; icon: typeof FileText; label: string; description: string; count: number }[] = [
    {
      href: "/workflows/templates",
      icon: FileText,
      label: "Templates",
      description: "Design the steps once, run them many times",
      count: templateCount,
    },
    {
      href: "/workflows/email-templates",
      icon: Mail,
      label: "Email templates",
      description: "Reusable email bodies with variable substitution",
      count: emailTemplateCount,
    },
    {
      href: "/workflows/instances",
      icon: PlayCircle,
      label: "Running",
      description: "In-flight onboarding, offboarding, and hiring instances",
      count: instanceCount,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Workflows"
        description="Automated sequences for onboarding, offboarding, and candidate hiring"
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {tiles.map((t) => (
          <Link key={t.href} href={t.href}>
            <Card className="hover:shadow-md transition-shadow h-full">
              <CardContent className="p-5">
                <div className="flex items-start justify-between mb-3">
                  <t.icon className="h-5 w-5 text-muted-foreground" />
                  <span className="text-2xl font-bold tabular-nums text-foreground">
                    {t.count}
                  </span>
                </div>
                <p className="font-semibold text-foreground">{t.label}</p>
                <p className="text-xs text-muted-foreground mt-1">{t.description}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <div className="mt-8 rounded border border-dashed border-border bg-muted/30 p-6 text-sm text-muted-foreground">
        <div className="flex items-start gap-3">
          <Workflow className="h-5 w-5 mt-0.5" />
          <div>
            <p className="font-medium text-foreground">
              Workflow execution is coming in Phase 4.
            </p>
            <p className="mt-1">
              Templates you build now will automatically pick up the
              background worker once it ships — no migration needed. The
              three default templates (onboarding, offboarding, candidate
              hiring) are pre-seeded so you can preview the structure today.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
