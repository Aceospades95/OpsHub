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
  employeeId: string;
  templates: TemplateOption[];
}

/**
 * "Start workflow" button on the employee profile page header. Opens
 * a small dialog to pick a workflow template + start/target date and
 * spawns an instance attached to this employee. Auto-redirects to
 * the new instance detail page.
 */
export function StartWorkflowButton({ employeeId, templates }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [templateId, setTemplateId] = useState("");
  const [startDate, setStartDate] = useState<string>("");
  const [targetDate, setTargetDate] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Filter to EMPLOYEE-scoped templates only — candidate/custom shouldn't
  // appear on a team profile.
  const eligible = templates;

  const selected = eligible.find((t) => t.id === templateId);
  // Offboarding workflows need a target date — surface it conditionally.
  const targetRequired = selected?.type === "OFFBOARDING";

  function handleStart() {
    setError(null);
    if (!templateId) {
      setError("Pick a template");
      return;
    }
    if (targetRequired && !targetDate) {
      setError("Offboarding workflows need a target / termination date");
      return;
    }
    startTransition(async () => {
      const res = await createWorkflowInstance({
        templateId,
        subjectType: "EMPLOYEE",
        subjectId: employeeId,
        startDate: startDate || null,
        targetDate: targetDate || null,
        autoStart: true,
      });
      if ("error" in res) {
        setError(res.error ?? "Could not start workflow");
        return;
      }
      router.push(`/workflows/instances/${res.instanceId}`);
    });
  }

  if (eligible.length === 0) return null;

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Workflow className="h-4 w-4 mr-2" />
        Start workflow
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Start workflow">
        <div className="space-y-4">
          <Select
            label="Template"
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
            placeholder="Pick a workflow template"
            options={eligible.map((t) => ({
              label: `${t.name} (${t.type.toLowerCase()})`,
              value: t.id,
            }))}
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Start date"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
            <Input
              label={
                targetRequired ? "Target date (required)" : "Target date (optional)"
              }
              type="date"
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
            />
          </div>
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
