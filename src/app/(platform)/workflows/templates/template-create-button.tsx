"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createWorkflowTemplate } from "@/actions/workflow-templates";

export function WorkflowTemplateCreateButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<"ONBOARDING" | "OFFBOARDING" | "CUSTOM">("CUSTOM");
  const [subjectEntityType, setSubjectEntityType] = useState<"EMPLOYEE" | "CUSTOM">("EMPLOYEE");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleCreate() {
    setError(null);
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    startTransition(async () => {
      const res = await createWorkflowTemplate({
        name: name.trim(),
        description: description.trim() || null,
        type,
        subjectEntityType,
      });
      if ("error" in res) {
        setError(res.error ?? "Could not create template");
        return;
      }
      setOpen(false);
      router.push(`/workflows/templates/${res.id}/edit`);
    });
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4 mr-2" />
        New template
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="New workflow template">
        <div className="space-y-4">
          <Input
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Sales hire onboarding"
          />
          <Textarea
            label="Description (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
          />
          <div className="grid grid-cols-2 gap-3">
            <Select
              label="Type"
              value={type}
              onChange={(e) => setType(e.target.value as typeof type)}
              options={[
                { label: "Custom", value: "CUSTOM" },
                { label: "Onboarding", value: "ONBOARDING" },
                { label: "Offboarding", value: "OFFBOARDING" },
              ]}
            />
            <Select
              label="Subject"
              value={subjectEntityType}
              onChange={(e) =>
                setSubjectEntityType(e.target.value as typeof subjectEntityType)
              }
              options={[
                { label: "Employee", value: "EMPLOYEE" },
                { label: "Custom", value: "CUSTOM" },
              ]}
            />
          </div>
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
