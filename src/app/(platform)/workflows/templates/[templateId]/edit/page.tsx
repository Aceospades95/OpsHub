import { notFound } from "next/navigation";

import { db } from "@/lib/db";
import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import { AccessDenied } from "@/components/shared/access-denied";

import { TemplateEditor } from "./template-editor";
import { TriggersPanel } from "./triggers-panel";

interface Props {
  params: Promise<{ templateId: string }>;
}

export default async function WorkflowTemplateEditPage({ params }: Props) {
  const { templateId } = await params;
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "workflows");
  if (!perms.canEdit) {
    return (
      <AccessDenied
        module="workflows"
        moduleLabel="Workflows"
        moduleDescription="Automated onboarding, offboarding, and hiring sequences"
      />
    );
  }

  const [template, emailTemplates, projects] = await Promise.all([
    db.workflowTemplate.findUnique({
      where: { id: templateId },
      include: {
        steps: { orderBy: { position: "asc" } },
        triggers: { orderBy: { createdAt: "asc" } },
      },
    }),
    db.workflowEmailTemplate.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, subject: true },
    }),
    // Active projects available to scope a PROJECT_ASSIGNMENT trigger.
    // We fetch lazily here rather than inside TriggersPanel because the
    // panel is a client component and ought to receive projects as a
    // serializable prop.
    db.project.findMany({
      where: { status: { in: ["PLANNING", "ACTIVE"] }, deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  if (!template) notFound();

  return (
    <div>
      <TemplateEditor
        template={{
          id: template.id,
          name: template.name,
          description: template.description,
          type: template.type,
          subjectEntityType: template.subjectEntityType,
          isActive: template.isActive,
          isSeed: template.isSeed,
        }}
        steps={template.steps.map((s) => ({
          id: s.id,
          position: s.position,
          name: s.name,
          stepType: s.stepType,
          config: s.config,
          timingType: s.timingType,
          timingValue: s.timingValue,
          afterStepId: s.afterStepId,
          isRequired: s.isRequired,
        }))}
        emailTemplates={emailTemplates}
        canDelete={perms.canDelete}
      />
      <div className="mt-6">
        <TriggersPanel
          templateId={template.id}
          subjectEntityType={template.subjectEntityType}
          triggers={template.triggers.map((t) => ({
            id: t.id,
            triggerType: t.triggerType,
            config: t.config,
            isActive: t.isActive,
          }))}
          projects={projects}
          canEdit={perms.canEdit}
        />
      </div>
    </div>
  );
}
