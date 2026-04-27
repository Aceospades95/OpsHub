import Link from "next/link";

import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { PlayCircle } from "lucide-react";

// Phase 4 will replace this stub with the running-instances dashboard
// (per-instance progress bars, current step, admin controls). For now
// we render a clear "coming soon" panel so the landing tile doesn't
// dead-end on a 404.
export default async function WorkflowInstancesPage() {
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

  return (
    <div>
      <PageHeader
        title="Running workflows"
        description="In-flight onboarding, offboarding, and hiring sequences"
        actions={
          <Link
            href="/workflows"
            className="text-sm text-muted-foreground hover:text-foreground hover:underline"
          >
            ← Back
          </Link>
        }
      />

      <Card>
        <CardContent className="p-12 text-center">
          <PlayCircle className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
          <p className="font-semibold text-foreground">
            Workflow execution lands in Phase 4.
          </p>
          <p className="text-sm text-muted-foreground mt-2 max-w-md mx-auto">
            The schema is in place and templates are editable today. The
            background worker that ticks scheduled steps forward + the
            self-service portal for subjects ship in the next phases.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
