"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Workflow } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { createWorkflowInstance } from "@/actions/workflow-instances";

interface TemplateOption {
  id: string;
  name: string;
  type: "ONBOARDING" | "OFFBOARDING" | "CANDIDATE" | "CUSTOM";
}

interface Props {
  candidateId: string;
  templates: TemplateOption[];
}

export function StartCandidateWorkflowButton({ candidateId, templates }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [templateId, setTemplateId] = useState("");
  const [startDate, setStartDate] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleStart() {
    setError(null);
    if (!templateId) {
      setError("Pick a template");
      return;
    }
    startTransition(async () => {
      const res = await createWorkflowInstance({
        templateId,
        subjectType: "CANDIDATE",
        subjectId: candidateId,
        startDate: startDate || null,
        autoStart: true,
      });
      if ("error" in res) {
        setError(res.error ?? "Could not start workflow");
        return;
      }
      router.push(`/workflows/instances/${res.instanceId}`);
    });
  }

  if (templates.length === 0) return null;

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Workflow className="h-4 w-4 mr-2" />
        Start workflow
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Start hiring workflow">
        <div className="space-y-4">
          <Select
            label="Template"
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
            placeholder="Pick a hiring template"
            options={templates.map((t) => ({
              label: `${t.name} (${t.type.toLowerCase()})`,
              value: t.id,
            }))}
          />
          <Input
            label="Start date"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={handleStart} disabled={pending}>
              {pending ? "Starting…" : "Start"}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
