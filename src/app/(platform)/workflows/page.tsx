import Link from "next/link";

import { db } from "@/lib/db";
import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { BarChart3, FileText, Mail, PlayCircle, Workflow } from "lucide-react";

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

  const [templateCount, archivedTemplateCount, emailTemplateCount, instanceCount] = await Promise.all([
    db.workflowTemplate.count({ where: { isActive: true } }),
    db.workflowTemplate.count({ where: { isActive: false } }),
    db.workflowEmailTemplate.count(),
    db.workflowInstance.count({
      where: { status: { in: ["PENDING", "IN_PROGRESS", "PAUSED"] } },
    }),
  ]);

  // Surface the archived count alongside the active one. Without this,
  // an admin who archives every template sees a `0` on the Templates
  // tile and reasonably concludes nothing is configured — even though
  // the archived rows still exist (and could be unarchived). Hidden
  // state shouldn't be invisible state.
  const templateDescription =
    archivedTemplateCount > 0
      ? `Design the steps once, run them many times. ${archivedTemplateCount} archived.`
      : "Design the steps once, run them many times";

  const tiles: { href: string; icon: typeof FileText; label: string; description: string; count: number | null }[] = [
    {
      href: "/workflows/templates",
      icon: FileText,
      label: "Templates",
      description: templateDescription,
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
    {
      href: "/workflows/analytics",
      icon: BarChart3,
      label: "Analytics",
      description: "Completion times, stuck steps, per-template stats",
      count: null,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Workflows"
        description="Automated sequences for onboarding, offboarding, and candidate hiring"
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {tiles.map((t) => (
          <Link key={t.href} href={t.href}>
            <Card className="hover:shadow-md transition-shadow h-full">
              <CardContent className="p-5">
                <div className="flex items-start justify-between mb-3">
                  <t.icon className="h-5 w-5 text-muted-foreground" />
                  {t.count != null && (
                    <span className="text-2xl font-bold tabular-nums text-foreground">
                      {t.count}
                    </span>
                  )}
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
              Background worker is wired up.
            </p>
            <p className="mt-1">
              Scheduled steps advance every minute. Date-driven triggers
              (e.g. fire offboarding 7 days before a termination) run
              once a day. Admins receive a reminder digest summarizing
              stuck workflows and expiring quotes. Internal job keys
              and run history live in Settings → Scheduled Jobs.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
