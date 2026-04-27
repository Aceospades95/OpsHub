"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Power, PowerOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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

interface Props {
  templateId: string;
  /** Drives which trigger types are appropriate. ENTITY_CREATE for User
   *  workflows requires subjectEntityType=EMPLOYEE; the same for Candidate. */
  subjectEntityType: "EMPLOYEE" | "CANDIDATE" | "CUSTOM";
  triggers: TriggerRow[];
  canEdit: boolean;
}

const TRIGGER_LABEL: Record<WorkflowTriggerType, string> = {
  ENTITY_CREATE: "On entity create",
  SCHEDULED_DATE: "On schedule (date field)",
  STAGE_CHANGE: "On stage change",
};

export function TriggersPanel({
  templateId,
  subjectEntityType,
  triggers,
  canEdit,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

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

  function handleAddEntityCreate() {
    if (subjectEntityType === "CUSTOM") {
      setError(
        "Switch the template's subject to Employee or Candidate before adding an auto-trigger."
      );
      return;
    }
    run(() =>
      createWorkflowTrigger({
        workflowTemplateId: templateId,
        triggerType: "ENTITY_CREATE",
        config: { entityType },
        isActive: true,
      })
    );
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

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Triggers</CardTitle>
          {canEdit && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleAddEntityCreate}
              disabled={pending}
            >
              <Plus className="h-3 w-3 mr-1" />
              Auto-start on new {entityType}
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
            {triggers.map((t) => {
              let cfgPretty = "";
              try {
                cfgPretty = JSON.stringify(JSON.parse(t.config));
              } catch {
                cfgPretty = t.config;
              }
              return (
                <div
                  key={t.id}
                  className="flex items-center justify-between rounded border border-border bg-muted/30 p-3 gap-3 flex-wrap"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {TRIGGER_LABEL[t.triggerType]}
                    </p>
                    <p className="font-mono text-[10px] text-muted-foreground break-all">
                      {cfgPretty}
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
              );
            })}
          </div>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}

        <p className="text-[11px] text-muted-foreground border-t border-border pt-2">
          Phase 4 ships <code>ENTITY_CREATE</code> triggers; scheduled-date and
          stage-change triggers are wired up in later phases.
        </p>
      </CardContent>
    </Card>
  );
}
