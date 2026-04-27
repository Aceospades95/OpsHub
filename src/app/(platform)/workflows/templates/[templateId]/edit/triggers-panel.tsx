"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Power, PowerOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import {
  createWorkflowTrigger,
  updateWorkflowTrigger,
  deleteWorkflowTrigger,
} from "@/actions/workflow-triggers";
import type { WorkflowTriggerType } from "@prisma/client";

interface TriggerRow {
  id: string;
  triggerType: WorkflowTriggerType;
  config: string; // JSON
  isActive: boolean;
}

interface ProjectOption {
  id: string;
  name: string;
}

interface Props {
  templateId: string;
  /** Drives which trigger types are appropriate. ENTITY_CREATE for User
   *  workflows requires subjectEntityType=EMPLOYEE; same for Candidate. */
  subjectEntityType: "EMPLOYEE" | "CANDIDATE" | "CUSTOM";
  triggers: TriggerRow[];
  /** Active projects available to scope a PROJECT_ASSIGNMENT trigger. */
  projects: ProjectOption[];
  canEdit: boolean;
}

const TRIGGER_LABEL: Record<WorkflowTriggerType, string> = {
  ENTITY_CREATE: "On entity create",
  SCHEDULED_DATE: "On schedule (date field)",
  STAGE_CHANGE: "On stage change",
  PROJECT_ASSIGNMENT: "On project assignment",
};

export function TriggersPanel({
  templateId,
  subjectEntityType,
  triggers,
  projects,
  canEdit,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const entityType =
    subjectEntityType === "EMPLOYEE"
      ? "User"
      : subjectEntityType === "CANDIDATE"
        ? "Candidate"
        : "Custom";

  function run<T>(fn: () => Promise<T>) {
    setError(null);
    startTransition(async () => {
      const res = (await fn()) as { error?: string } | { success: true };
      if ("error" in res && res.error) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  function handleToggle(t: TriggerRow) {
    let cfg: Record<string, unknown> = {};
    try {
      cfg = JSON.parse(t.config) as Record<string, unknown>;
    } catch {
      cfg = {};
    }
    run(() =>
      updateWorkflowTrigger({
        id: t.id,
        workflowTemplateId: templateId,
        triggerType: t.triggerType,
        config: cfg,
        isActive: !t.isActive,
      })
    );
  }

  function handleDelete(id: string) {
    if (!confirm("Delete this trigger?")) return;
    run(() => deleteWorkflowTrigger(id));
  }

  function describeTrigger(t: TriggerRow): string {
    let cfg: Record<string, unknown> = {};
    try {
      cfg = JSON.parse(t.config);
    } catch {
      return t.config;
    }
    if (t.triggerType === "ENTITY_CREATE") {
      return `When a new ${cfg.entityType ?? "entity"} is created`;
    }
    if (t.triggerType === "SCHEDULED_DATE") {
      const offset = (cfg.offsetDays as number) ?? 0;
      const dir = offset < 0 ? "before" : offset > 0 ? "after" : "on";
      return `${Math.abs(offset)}d ${dir} ${cfg.dateField ?? "(date)"}`;
    }
    if (t.triggerType === "PROJECT_ASSIGNMENT") {
      const projectId = cfg.projectId as string | undefined;
      const project = projects.find((p) => p.id === projectId);
      return projectId
        ? `When a user is assigned to ${project?.name ?? projectId}`
        : "When a user is assigned to ANY project";
    }
    return JSON.stringify(cfg);
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Triggers</CardTitle>
            {canEdit && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPickerOpen(true)}
                disabled={pending}
              >
                <Plus className="h-3 w-3 mr-1" />
                Add trigger
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {triggers.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No automatic triggers. This template only runs when started
              manually.
            </p>
          ) : (
            <div className="space-y-2">
              {triggers.map((t) => (
                <div
                  key={t.id}
                  className="flex items-center justify-between rounded border border-border bg-muted/30 p-3 gap-3 flex-wrap"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {TRIGGER_LABEL[t.triggerType]}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {describeTrigger(t)}
                    </p>
                    <div className="flex gap-1 mt-1">
                      {t.isActive ? (
                        <Badge variant="success" className="text-[10px]">
                          Active
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px]">
                          Disabled
                        </Badge>
                      )}
                    </div>
                  </div>
                  {canEdit && (
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => handleToggle(t)}
                        disabled={pending}
                        className="p-1 text-muted-foreground hover:text-foreground"
                        aria-label={t.isActive ? "Disable" : "Enable"}
                      >
                        {t.isActive ? (
                          <PowerOff className="h-3 w-3" />
                        ) : (
                          <Power className="h-3 w-3" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(t.id)}
                        disabled={pending}
                        className="p-1 text-muted-foreground hover:text-destructive"
                        aria-label="Delete trigger"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>

      {pickerOpen && canEdit && (
        <AddTriggerDialog
          templateId={templateId}
          subjectEntityType={subjectEntityType}
          entityType={entityType}
          projects={projects}
          onClose={(changed) => {
            setPickerOpen(false);
            if (changed) router.refresh();
          }}
          onError={setError}
        />
      )}
    </>
  );
}

function AddTriggerDialog({
  templateId,
  subjectEntityType,
  entityType,
  projects,
  onClose,
  onError,
}: {
  templateId: string;
  subjectEntityType: "EMPLOYEE" | "CANDIDATE" | "CUSTOM";
  entityType: string;
  projects: ProjectOption[];
  onClose: (changed: boolean) => void;
  onError: (msg: string) => void;
}) {
  const [type, setType] = useState<WorkflowTriggerType>("ENTITY_CREATE");
  // PROJECT_ASSIGNMENT-specific config
  const [projectId, setProjectId] = useState("");
  // SCHEDULED_DATE-specific config
  const [dateField, setDateField] = useState("terminationDate");
  const [offsetDays, setOffsetDays] = useState(-7);
  const [pending, startTransition] = useTransition();

  const supportsProjectAssignment = subjectEntityType === "EMPLOYEE";
  const supportsScheduledDate = subjectEntityType === "EMPLOYEE";
  const supportsEntityCreate = subjectEntityType !== "CUSTOM";

  const options: { value: WorkflowTriggerType; label: string }[] = [];
  if (supportsEntityCreate) {
    options.push({
      value: "ENTITY_CREATE",
      label: `On new ${entityType} created`,
    });
  }
  if (supportsProjectAssignment) {
    options.push({
      value: "PROJECT_ASSIGNMENT",
      label: "On user assigned to a project",
    });
  }
  if (supportsScheduledDate) {
    options.push({
      value: "SCHEDULED_DATE",
      label: "On scheduled date (e.g. before terminationDate)",
    });
  }

  function handleAdd() {
    let config: Record<string, unknown> = {};
    if (type === "ENTITY_CREATE") {
      config = { entityType };
    } else if (type === "PROJECT_ASSIGNMENT") {
      config = projectId ? { projectId } : {};
    } else if (type === "SCHEDULED_DATE") {
      config = { dateField, offsetDays };
    }

    startTransition(async () => {
      const res = await createWorkflowTrigger({
        workflowTemplateId: templateId,
        triggerType: type,
        config,
        isActive: true,
      });
      if ("error" in res) {
        onError(res.error ?? "Could not create trigger");
        return;
      }
      onClose(true);
    });
  }

  return (
    <Dialog open onClose={() => onClose(false)} title="Add trigger">
      {options.length === 0 ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Set the template&apos;s subject to Employee or Candidate before
            adding an auto-trigger.
          </p>
          <div className="flex justify-end">
            <Button variant="outline" onClick={() => onClose(false)}>
              Close
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <Select
            label="Trigger type"
            value={type}
            onChange={(e) => setType(e.target.value as WorkflowTriggerType)}
            options={options.map((o) => ({ label: o.label, value: o.value }))}
          />

          {type === "PROJECT_ASSIGNMENT" && (
            <Select
              label="Project (optional)"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              placeholder="Any project"
              options={projects.map((p) => ({ label: p.name, value: p.id }))}
            />
          )}

          {type === "SCHEDULED_DATE" && (
            <div className="grid grid-cols-2 gap-3">
              <Select
                label="Date field"
                value={dateField}
                onChange={(e) => setDateField(e.target.value)}
                options={[
                  { label: "User.terminationDate", value: "terminationDate" },
                ]}
              />
              <Input
                label="Offset (days)"
                type="number"
                value={offsetDays}
                onChange={(e) =>
                  setOffsetDays(parseInt(e.target.value, 10) || 0)
                }
              />
            </div>
          )}

          <p className="text-[11px] text-muted-foreground">
            {type === "PROJECT_ASSIGNMENT" &&
              "Fires when a user is assigned to a project (via the staffing matrix or project members). Picks the assigned user as the subject."}
            {type === "ENTITY_CREATE" &&
              `Fires when a new ${entityType} is created.`}
            {type === "SCHEDULED_DATE" &&
              "Evaluated daily by the workflow-scheduled-triggers cron job. Negative offsets fire BEFORE the date, positive AFTER."}
          </p>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onClose(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={handleAdd} disabled={pending}>
              {pending ? "Adding…" : "Add trigger"}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
