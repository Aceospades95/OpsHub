"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Plus,
  ArrowUp,
  ArrowDown,
  Trash2,
  Save,
  X,
  Settings as SettingsIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useConfirm } from "@/components/shared/use-confirm";
import { Dialog } from "@/components/ui/dialog";
import {
  STEP_TYPE_DEFINITIONS,
  type StepTypeDefinition,
} from "@/lib/workflows/step-types";
import { describeTiming } from "@/lib/workflows/timing";
import {
  addWorkflowStep,
  updateWorkflowStep,
  deleteWorkflowStep,
  reorderWorkflowSteps,
  updateWorkflowTemplateMeta,
  deleteWorkflowTemplate,
} from "@/actions/workflow-templates";
import type {
  WorkflowStepType,
  WorkflowTimingType,
  WorkflowType,
  WorkflowSubjectType,
} from "@prisma/client";

import { StepConfigForm } from "./step-config-form";

interface TemplateMeta {
  id: string;
  name: string;
  description: string | null;
  type: WorkflowType;
  subjectEntityType: WorkflowSubjectType;
  isActive: boolean;
  isSeed: boolean;
}

interface StepRow {
  id: string;
  position: number;
  name: string;
  stepType: WorkflowStepType;
  config: string; // JSON string
  timingType: WorkflowTimingType;
  timingValue: number;
  afterStepId: string | null;
  isRequired: boolean;
}

interface UserOption {
  id: string;
  name: string;
}

interface EmailTemplateOption {
  id: string;
  name: string;
  subject: string;
}

interface Props {
  template: TemplateMeta;
  steps: StepRow[];
  emailTemplates: EmailTemplateOption[];
  users: UserOption[];
  canDelete: boolean;
}

export function TemplateEditor({
  template,
  steps: initialSteps,
  emailTemplates,
  users,
  canDelete,
}: Props) {
  const router = useRouter();
  const [steps, setSteps] = useState<StepRow[]>(initialSteps);
  const [editingStep, setEditingStep] = useState<StepRow | null>(null);
  const [showStepPicker, setShowStepPicker] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const { confirm, ConfirmDialog } = useConfirm();

  // Sync server-fetched steps into local state when the prop changes
  // (e.g. after a refresh()). Without this, useState's initial-value-only
  // semantics keep the local copy stale, so the step picker would
  // appear to "do nothing" until a hard reload.
  useEffect(() => {
    setSteps(initialSteps);
  }, [initialSteps]);

  function refresh() {
    router.refresh();
  }

  function handleAddStep(def: StepTypeDefinition) {
    setShowStepPicker(false);
    setError(null);
    startTransition(async () => {
      const res = await addWorkflowStep({
        workflowTemplateId: template.id,
        name: def.label,
        stepType: def.type,
        config: def.defaultConfig,
        timingType: "ON_ENTRY",
        timingValue: 0,
        afterStepId: null,
        isRequired: true,
      });
      if ("error" in res) {
        setError(res.error ?? "Could not add step");
        return;
      }
      // Append optimistically so the timeline updates immediately —
      // router.refresh() reconciles in the background.
      setSteps((prev) => [
        ...prev,
        {
          id: res.id,
          position: prev.length,
          name: def.label,
          stepType: def.type,
          config: JSON.stringify(def.defaultConfig),
          timingType: "ON_ENTRY",
          timingValue: 0,
          afterStepId: null,
          isRequired: true,
        },
      ]);
      refresh();
    });
  }

  async function handleDeleteStep(stepId: string) {
    const ok = await confirm({
      title: "Delete this step?",
      confirmLabel: "Delete",
    });
    if (!ok) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteWorkflowStep(stepId);
      if ("error" in res) {
        setError(res.error ?? "Could not delete step");
        return;
      }
      setSteps((prev) => prev.filter((s) => s.id !== stepId));
      refresh();
    });
  }

  function handleMoveStep(index: number, dir: -1 | 1) {
    setError(null);
    setSteps((prev) => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      const ordered = next.map((s) => s.id);
      // Fire-and-forget the reorder. If it fails we restore via refresh.
      reorderWorkflowSteps(template.id, ordered).then((res) => {
        if ("error" in res) {
          setError(res.error ?? "Reorder failed");
          refresh();
        }
      });
      return next;
    });
  }

  return (
    <div>
      {/* Top bar */}
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <div className="min-w-0">
          {/* Round-6 QA: breadcrumb used to read "Templates › cmojf683"
           *  by slicing the template's cuid. Use the loaded name
           *  instead — truncated at ~30 chars with the full string
           *  preserved as the title attribute for hover. */}
          <p className="text-xs text-muted-foreground">
            <Link href="/workflows/templates" className="hover:underline">
              Templates
            </Link>{" "}
            ›{" "}
            <span title={template.name}>
              {template.name.length > 30
                ? `${template.name.slice(0, 30)}…`
                : template.name}
            </span>
          </p>
          <h1 className="text-2xl font-bold truncate">{template.name}</h1>
          <div className="flex flex-wrap gap-1 mt-1">
            <Badge variant="outline" className="text-[10px]">
              {template.type.toLowerCase()}
            </Badge>
            <Badge variant="outline" className="text-[10px]">
              subject: {template.subjectEntityType.toLowerCase()}
            </Badge>
            {template.isSeed && (
              <Badge variant="secondary" className="text-[10px]">
                System
              </Badge>
            )}
            {!template.isActive && (
              <Badge variant="outline" className="text-[10px]">
                Archived
              </Badge>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/workflows/templates">
            <Button variant="outline">
              <X className="h-4 w-4 mr-2" />
              Close
            </Button>
          </Link>
          <Button variant="outline" onClick={() => setShowSettings(true)}>
            <SettingsIcon className="h-4 w-4 mr-2" />
            Settings
          </Button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Vertical timeline */}
      <Card>
        <CardContent className="p-6">
          {steps.length === 0 ? (
            <div className="text-center py-12 space-y-3">
              <p className="text-sm text-muted-foreground">
                This template has no steps yet.
              </p>
              <Button onClick={() => setShowStepPicker(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Add the first step
              </Button>
            </div>
          ) : (
            <ol className="relative border-l border-border pl-6 space-y-4">
              {steps.map((step, i) => {
                const def = STEP_TYPE_DEFINITIONS.find(
                  (d) => d.type === step.stepType
                );
                return (
                  <li key={step.id} className="relative">
                    <span className="absolute -left-[26px] top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                      {i + 1}
                    </span>
                    <div
                      className="rounded border border-border bg-muted/30 p-4 hover:border-primary cursor-pointer"
                      onClick={() => setEditingStep(step)}
                    >
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div className="min-w-0">
                          <p className="text-xs uppercase tracking-wide text-muted-foreground">
                            {def?.label ?? step.stepType}
                          </p>
                          <p className="font-medium">{step.name}</p>
                          <div className="flex flex-wrap gap-1 mt-1">
                            <Badge variant="outline" className="text-[10px]">
                              {describeTiming(
                                step.timingType,
                                step.timingValue,
                                step.afterStepId != null
                              )}
                            </Badge>
                            {!step.isRequired && (
                              <Badge variant="outline" className="text-[10px]">
                                Optional
                              </Badge>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleMoveStep(i, -1);
                            }}
                            disabled={i === 0 || pending}
                            className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
                            aria-label="Move up"
                          >
                            <ArrowUp className="h-3 w-3" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleMoveStep(i, 1);
                            }}
                            disabled={i === steps.length - 1 || pending}
                            className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
                            aria-label="Move down"
                          >
                            <ArrowDown className="h-3 w-3" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteStep(step.id);
                            }}
                            disabled={pending}
                            className="p-1 text-muted-foreground hover:text-destructive"
                            aria-label="Delete step"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
              <li className="ml-[-26px] pl-6">
                <button
                  type="button"
                  onClick={() => setShowStepPicker(true)}
                  className="text-sm text-primary hover:underline"
                  disabled={pending}
                >
                  <Plus className="h-3 w-3 inline mr-1" />
                  Add step
                </button>
              </li>
            </ol>
          )}
        </CardContent>
      </Card>

      {showStepPicker && (
        <StepPickerDialog
          onPick={handleAddStep}
          onClose={() => setShowStepPicker(false)}
        />
      )}

      {editingStep && (
        <StepEditDialog
          templateId={template.id}
          step={editingStep}
          steps={steps}
          emailTemplates={emailTemplates}
          users={users}
          onClose={(changed) => {
            setEditingStep(null);
            if (changed) refresh();
          }}
        />
      )}

      {showSettings && (
        <TemplateSettingsDialog
          template={template}
          canDelete={canDelete}
          onClose={() => setShowSettings(false)}
        />
      )}
      <ConfirmDialog />
    </div>
  );
}

// ─── Step picker ────────────────────────────────────────────────────────

function StepPickerDialog({
  onPick,
  onClose,
}: {
  onPick: (def: StepTypeDefinition) => void;
  onClose: () => void;
}) {
  return (
    <Dialog open onClose={onClose} title="Add a step" className="max-w-2xl">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {STEP_TYPE_DEFINITIONS.map((def) => (
          <button
            key={def.type}
            type="button"
            onClick={() => onPick(def)}
            className="text-left rounded border border-border bg-muted/30 p-3 hover:border-primary transition-colors"
          >
            <p className="font-medium text-sm">{def.label}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {def.description}
            </p>
          </button>
        ))}
      </div>
    </Dialog>
  );
}

// ─── Step editor ────────────────────────────────────────────────────────

function StepEditDialog({
  templateId,
  step,
  steps,
  emailTemplates,
  users,
  onClose,
}: {
  templateId: string;
  step: StepRow;
  steps: StepRow[];
  emailTemplates: EmailTemplateOption[];
  users: UserOption[];
  onClose: (changed: boolean) => void;
}) {
  const [name, setName] = useState(step.name);
  const [timingType, setTimingType] = useState<WorkflowTimingType>(
    step.timingType
  );
  const [timingValue, setTimingValue] = useState(step.timingValue);
  const [afterStepId, setAfterStepId] = useState<string>(step.afterStepId ?? "");
  const [isRequired, setIsRequired] = useState(step.isRequired);
  const [config, setConfig] = useState<unknown>(() => {
    try {
      return JSON.parse(step.config);
    } catch {
      return {};
    }
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const otherSteps = steps.filter((s) => s.id !== step.id);

  function handleSave() {
    setError(null);
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    startTransition(async () => {
      const res = await updateWorkflowStep({
        id: step.id,
        workflowTemplateId: templateId,
        name: name.trim(),
        stepType: step.stepType,
        config,
        timingType,
        timingValue,
        afterStepId: afterStepId || null,
        isRequired,
      });
      if ("error" in res) {
        // Round-8 QA: surface the first field-specific error from
        // the strict validator so users see "Task title is
        // required" instead of just "Validation failed".
        const fieldErrors = (res as { fieldErrors?: Record<string, string[] | undefined> }).fieldErrors;
        if (fieldErrors) {
          const firstField = Object.keys(fieldErrors).find(
            (k) => (fieldErrors[k]?.length ?? 0) > 0
          );
          if (firstField) {
            setError(fieldErrors[firstField]![0]);
            return;
          }
        }
        setError(res.error ?? "Could not save step");
        return;
      }
      onClose(true);
    });
  }

  return (
    <Dialog open onClose={() => onClose(false)} title={`Edit: ${step.name}`} className="max-w-2xl">
      <div className="space-y-4">
        <Input
          label="Step name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />

        <div className="grid grid-cols-2 gap-3">
          <Select
            label="Timing"
            value={timingType}
            onChange={(e) => setTimingType(e.target.value as WorkflowTimingType)}
            options={[
              { label: "On entry", value: "ON_ENTRY" },
              { label: "Days after start", value: "DAYS_AFTER_START" },
              { label: "Days before target", value: "DAYS_BEFORE_TARGET" },
              { label: "After previous step", value: "AFTER_STEP" },
            ]}
          />
          {(timingType === "DAYS_AFTER_START" ||
            timingType === "DAYS_BEFORE_TARGET") && (
            <Input
              label="Days"
              type="number"
              value={timingValue}
              onChange={(e) => setTimingValue(parseInt(e.target.value, 10) || 0)}
            />
          )}
          {timingType === "AFTER_STEP" && (
            <Select
              label="After step"
              value={afterStepId}
              onChange={(e) => setAfterStepId(e.target.value)}
              placeholder="(none)"
              options={otherSteps.map((s) => ({ label: s.name, value: s.id }))}
            />
          )}
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={isRequired}
            onChange={(e) => setIsRequired(e.target.checked)}
          />
          Required for completion
        </label>

        <div className="border-t border-border pt-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
            Step config
          </p>
          <StepConfigForm
            stepType={step.stepType}
            config={config}
            onChange={setConfig}
            emailTemplates={emailTemplates}
            users={users}
          />
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            onClick={() => onClose(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={pending}>
            <Save className="h-4 w-4 mr-2" />
            {pending ? "Saving…" : "Save step"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

// ─── Template settings dialog ──────────────────────────────────────────

function TemplateSettingsDialog({
  template,
  canDelete,
  onClose,
}: {
  template: TemplateMeta;
  canDelete: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(template.name);
  const [description, setDescription] = useState(template.description ?? "");
  const [type, setType] = useState<WorkflowType>(template.type);
  const [subjectEntityType, setSubjectEntityType] = useState<WorkflowSubjectType>(
    template.subjectEntityType
  );
  const [isActive, setIsActive] = useState(template.isActive);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { confirm, ConfirmDialog } = useConfirm();

  function handleSave() {
    setError(null);
    startTransition(async () => {
      const res = await updateWorkflowTemplateMeta({
        id: template.id,
        name: name.trim(),
        description: description.trim() || null,
        type,
        subjectEntityType,
        isActive,
      });
      if ("error" in res) {
        setError(res.error ?? "Could not save");
        return;
      }
      onClose();
      router.refresh();
    });
  }

  async function handleDelete() {
    const ok = await confirm({
      title: "Delete this template?",
      message: "This can't be undone.",
      confirmLabel: "Delete",
    });
    if (!ok) return;
    startTransition(async () => {
      const res = await deleteWorkflowTemplate(template.id);
      if ("error" in res) {
        setError(res.error ?? "Could not delete");
        return;
      }
      router.push("/workflows/templates");
    });
  }

  return (
    <Dialog open onClose={onClose} title="Template settings">
      <div className="space-y-4">
        <Input
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Textarea
          label="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
        />
        <div className="grid grid-cols-2 gap-3">
          <Select
            label="Type"
            value={type}
            onChange={(e) => setType(e.target.value as WorkflowType)}
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
              setSubjectEntityType(e.target.value as WorkflowSubjectType)
            }
            options={[
              { label: "Employee", value: "EMPLOYEE" },
              { label: "Custom", value: "CUSTOM" },
            ]}
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
          />
          Active (available for new instances)
        </label>

        {template.isSeed && (
          <p className="text-xs text-muted-foreground">
            This is a system template. It can be edited and archived but
            not deleted.
          </p>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex justify-between gap-2">
          {canDelete && !template.isSeed ? (
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={pending}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </div>
      <ConfirmDialog />
    </Dialog>
  );
}
