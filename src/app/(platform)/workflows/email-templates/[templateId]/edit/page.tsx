import { notFound } from "next/navigation";

import { db } from "@/lib/db";
import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import { AccessDenied } from "@/components/shared/access-denied";

import { EmailTemplateEditor } from "./email-template-editor";

interface Props {
  params: Promise<{ templateId: string }>;
}

export default async function WorkflowEmailTemplateEditPage({ params }: Props) {
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

  const template = await db.workflowEmailTemplate.findUnique({
    where: { id: templateId },
  });
  if (!template) notFound();

  return (
    <EmailTemplateEditor
      template={{
        id: template.id,
        name: template.name,
        subject: template.subject,
        bodyHtml: template.bodyHtml,
        bodyText: template.bodyText,
      }}
      canDelete={perms.canDelete}
    />
  );
}
