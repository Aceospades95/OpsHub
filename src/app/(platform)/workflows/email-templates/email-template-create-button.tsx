"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { createWorkflowEmailTemplate } from "@/actions/workflow-email-templates";

export function EmailTemplateCreateButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleCreate() {
    setError(null);
    if (!name.trim() || !subject.trim()) {
      setError("Name and subject are required");
      return;
    }
    startTransition(async () => {
      const res = await createWorkflowEmailTemplate({
        name: name.trim(),
        subject: subject.trim(),
        // Seed with a tiny placeholder so the editor opens to something
        // sensible. The user customizes it on the next page.
        bodyHtml: "<p>Hi {{subject.firstName}},</p>\n<p></p>\n<p>— {{company.name}}</p>",
        bodyText: null,
      });
      if ("error" in res) {
        setError(res.error ?? "Could not create template");
        return;
      }
      setOpen(false);
      router.push(`/workflows/email-templates/${res.id}/edit`);
    });
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4 mr-2" />
        New email template
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="New email template">
        <div className="space-y-4">
          <Input
            label="Internal name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Welcome email — first day"
          />
          <Input
            label="Subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Welcome to {{company.name}}, {{subject.firstName}}"
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={pending}>
              {pending ? "Creating…" : "Create &amp; edit"}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
