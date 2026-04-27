import { notFound } from "next/navigation";

import { db } from "@/lib/db";
import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import { AccessDenied } from "@/components/shared/access-denied";

import { TemplateEditor } from "./template-editor";

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

  const [template, emailTemplates] = await Promise.all([
    db.workflowTemplate.findUnique({
      where: { id: templateId },
      include: {
        steps: { orderBy: { position: "asc" } },
      },
    }),
    db.workflowEmailTemplate.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, subject: true },
    }),
  ]);

  if (!template) notFound();

  return (
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
  );
}
