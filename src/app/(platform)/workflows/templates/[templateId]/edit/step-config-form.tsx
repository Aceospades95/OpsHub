"use client";

import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import type { WorkflowStepType } from "@prisma/client";

interface EmailTemplateOption {
  id: string;
  name: string;
  subject: string;
}

interface Props {
  stepType: WorkflowStepType;
  config: unknown;
  onChange: (next: unknown) => void;
  emailTemplates: EmailTemplateOption[];
}

/**
 * Recipient roles with no runtime mapping — resolveRoleEmail /
 * resolveRoleUserId (lib/workflows/context.ts) resolve them to a
 * fallback or null, so steps saved with one mis-route or fail at run
 * time. They're no longer offered in the pickers; existing saved
 * values surface via withUnmappedOption below so the editor re-points
 * them instead of the select silently snapping to the first option.
 */
const UNMAPPED_ROLES = new Set(["hr", "it", "owner"]);

function withUnmappedOption(
  options: { label: string; value: string }[],
  current: unknown
): { label: string; value: string }[] {
  if (typeof current === "string" && UNMAPPED_ROLES.has(current)) {
    return [
      ...options,
      { label: `${current} (unmapped role — pick a new recipient)`, value: current },
    ];
  }
  return options;
}

/**
 * Per-step-type config form. Renders the right inputs based on the
 * step type so each kind of step gets a tailored editor — e.g. an email
 * step shows recipient + template pickers; a wait step shows only a
 * day count.
 *
 * Each branch reads/writes the same `config` object, but with the keys
 * matching that step type's config interface in step-types.ts.
 */
export function StepConfigForm({ stepType, config, onChange, emailTemplates }: Props) {
  // Pull keys off the typed-ish config blob with safe defaults so an
  // empty config never crashes the form on first render.
  const c = (config as Record<string, unknown>) ?? {};

  function patch(patch: Record<string, unknown>) {
    onChange({ ...c, ...patch });
  }

  switch (stepType) {
    case "SEND_EMAIL":
      return (
        <div className="space-y-3">
          <Select
            label="Send to"
            value={(c.toRecipient as string) ?? "subject"}
            onChange={(e) => patch({ toRecipient: e.target.value })}
            options={withUnmappedOption(
              [
                { label: "The subject (employee/candidate)", value: "subject" },
                { label: "Their manager", value: "manager" },
                { label: "Custom email", value: "custom" },
              ],
              c.toRecipient
            )}
          />
          {(c.toRecipient as string) === "custom" && (
            <Input
              label="Custom email"
              type="email"
              value={(c.customEmail as string) ?? ""}
              onChange={(e) => patch({ customEmail: e.target.value })}
            />
          )}
          <Select
            label="Email template"
            value={(c.emailTemplateId as string) ?? ""}
            onChange={(e) => patch({ emailTemplateId: e.target.value })}
            placeholder={
              emailTemplates.length === 0
                ? "Create an email template first"
                : "Select a template"
            }
            options={emailTemplates.map((t) => ({
              label: t.name,
              value: t.id,
            }))}
          />
          <Input
            label="Subject override (optional)"
            value={(c.subjectOverride as string) ?? ""}
            onChange={(e) => patch({ subjectOverride: e.target.value })}
          />
          <Textarea
            label="Body override (optional)"
            value={(c.bodyOverride as string) ?? ""}
            onChange={(e) => patch({ bodyOverride: e.target.value })}
            rows={3}
          />
        </div>
      );

    case "ASSIGN_TASK_TO_SUBJECT":
      return (
        <div className="space-y-3">
          <Input
            label="Task title"
            value={(c.title as string) ?? ""}
            onChange={(e) => patch({ title: e.target.value })}
          />
          <Textarea
            label="Description"
            value={(c.description as string) ?? ""}
            onChange={(e) => patch({ description: e.target.value })}
            rows={3}
          />
          <Input
            label="Due offset (days from start)"
            type="number"
            value={(c.dueOffsetDays as number) ?? 0}
            onChange={(e) =>
              patch({ dueOffsetDays: parseInt(e.target.value, 10) || 0 })
            }
          />
        </div>
      );

    case "ASSIGN_TASK_TO_USER":
      return (
        <div className="space-y-3">
          <Select
            label="Assignee"
            value={(c.assignee as string) ?? "manager"}
            onChange={(e) => patch({ assignee: e.target.value })}
            options={withUnmappedOption(
              [
                { label: "Specific user", value: "specific_user" },
                { label: "Subject's manager", value: "manager" },
              ],
              c.assignee
            )}
          />
          {(c.assignee as string) === "specific_user" && (
            <Input
              label="User id"
              value={(c.assigneeUserId as string) ?? ""}
              onChange={(e) => patch({ assigneeUserId: e.target.value })}
              placeholder="cuid of the target user"
            />
          )}
          <Input
            label="Task title"
            value={(c.title as string) ?? ""}
            onChange={(e) => patch({ title: e.target.value })}
          />
          <Textarea
            label="Description"
            value={(c.description as string) ?? ""}
            onChange={(e) => patch({ description: e.target.value })}
            rows={3}
          />
          <Input
            label="Due offset (days from start)"
            type="number"
            value={(c.dueOffsetDays as number) ?? 0}
            onChange={(e) =>
              patch({ dueOffsetDays: parseInt(e.target.value, 10) || 0 })
            }
          />
        </div>
      );

    case "REQUEST_DOCUMENT":
      return (
        <div className="space-y-3">
          <Input
            label="Document name"
            value={(c.documentName as string) ?? ""}
            onChange={(e) => patch({ documentName: e.target.value })}
            placeholder="e.g. W-4, I-9, Direct deposit form"
          />
          <Textarea
            label="Instructions"
            value={(c.description as string) ?? ""}
            onChange={(e) => patch({ description: e.target.value })}
            rows={3}
          />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={(c.required as boolean) ?? true}
              onChange={(e) => patch({ required: e.target.checked })}
            />
            Required to complete the workflow
          </label>
        </div>
      );

    case "REQUEST_SIGNATURE":
      return (
        <div className="space-y-3">
          <Textarea
            label="Document text (what the subject signs)"
            value={(c.documentText as string) ?? ""}
            onChange={(e) => patch({ documentText: e.target.value })}
            rows={6}
            placeholder="Paste the full agreement text the subject must read and sign"
          />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={(c.required as boolean) ?? true}
              onChange={(e) => patch({ required: e.target.checked })}
            />
            Required to complete the workflow
          </label>
        </div>
      );

    case "REQUEST_FORM":
      return <FormBuilder config={c} patch={patch} />;

    case "WAIT":
      return (
        <Input
          label="Wait days"
          type="number"
          value={(c.delayDays as number) ?? 1}
          onChange={(e) => patch({ delayDays: parseInt(e.target.value, 10) || 0 })}
        />
      );

    case "CONDITIONAL_BRANCH":
      return (
        <div className="space-y-3">
          <Input
            label="Condition (e.g. subject.role === 'engineer')"
            value={(c.condition as string) ?? ""}
            onChange={(e) => patch({ condition: e.target.value })}
          />
          <p className="text-xs text-muted-foreground">
            Phase 4 will support simple <code>subject.field === &quot;value&quot;</code>{" "}
            comparisons. Anything more should be split into separate steps.
          </p>
        </div>
      );

    case "APPROVAL":
      return (
        <div className="space-y-3">
          <Select
            label="Approver"
            value={(c.approver as string) ?? "manager"}
            onChange={(e) => patch({ approver: e.target.value })}
            options={withUnmappedOption(
              [
                { label: "Specific user", value: "specific_user" },
                { label: "Manager", value: "manager" },
              ],
              c.approver
            )}
          />
          {(c.approver as string) === "specific_user" && (
            <Input
              label="Approver user id"
              value={(c.approverUserId as string) ?? ""}
              onChange={(e) => patch({ approverUserId: e.target.value })}
            />
          )}
          <Textarea
            label="Approval prompt"
            value={(c.prompt as string) ?? ""}
            onChange={(e) => patch({ prompt: e.target.value })}
            rows={3}
            placeholder="What the approver is being asked to decide"
          />
        </div>
      );

    case "PROVISION_ACCESS":
    case "DEPROVISION_ACCESS":
      return (
        <div className="space-y-3">
          <Input
            label="System"
            value={(c.system as string) ?? ""}
            onChange={(e) => patch({ system: e.target.value })}
            placeholder="Google Workspace, Slack, GitHub, 1Password…"
          />
          <Textarea
            label="Notes for IT"
            value={(c.notes as string) ?? ""}
            onChange={(e) => patch({ notes: e.target.value })}
            rows={3}
          />
        </div>
      );

    case "SCHEDULE_MEETING":
      return (
        <div className="space-y-3">
          <Input
            label="Meeting title"
            value={(c.meetingTitle as string) ?? ""}
            onChange={(e) => patch({ meetingTitle: e.target.value })}
          />
          <AttendeeMultiSelect
            value={(c.attendees as string[]) ?? ["subject", "manager"]}
            onChange={(next) => patch({ attendees: next })}
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Duration (minutes)"
              type="number"
              value={(c.durationMinutes as number) ?? 30}
              onChange={(e) =>
                patch({ durationMinutes: parseInt(e.target.value, 10) || 30 })
              }
            />
            <Input
              label="Offset (days from start)"
              type="number"
              value={(c.offsetDays as number) ?? 0}
              onChange={(e) =>
                patch({ offsetDays: parseInt(e.target.value, 10) || 0 })
              }
            />
          </div>
        </div>
      );

    case "SEND_REMINDER":
      return (
        <div className="space-y-3">
          <Select
            label="Send to"
            value={(c.to as string) ?? "subject"}
            onChange={(e) => patch({ to: e.target.value })}
            options={withUnmappedOption(
              [
                { label: "Subject", value: "subject" },
                { label: "Manager", value: "manager" },
              ],
              c.to
            )}
          />
          <Select
            label="Email template"
            value={(c.emailTemplateId as string) ?? ""}
            onChange={(e) => patch({ emailTemplateId: e.target.value })}
            placeholder="Select a template"
            options={emailTemplates.map((t) => ({
              label: t.name,
              value: t.id,
            }))}
          />
        </div>
      );

    default:
      return (
        <p className="text-sm text-muted-foreground">
          No editor for this step type yet.
        </p>
      );
  }
}

// ─── Form builder for REQUEST_FORM step ─────────────────────────────────

function FormBuilder({
  config,
  patch,
}: {
  config: Record<string, unknown>;
  patch: (p: Record<string, unknown>) => void;
}) {
  const fields = (config.fields as Array<Record<string, unknown>>) ?? [];

  function setFields(next: Array<Record<string, unknown>>) {
    patch({ fields: next });
  }

  function addField() {
    setFields([
      ...fields,
      { key: `field_${fields.length + 1}`, label: "", type: "text", required: false },
    ]);
  }

  function updateField(index: number, p: Record<string, unknown>) {
    setFields(fields.map((f, i) => (i === index ? { ...f, ...p } : f)));
  }

  function removeField(index: number) {
    setFields(fields.filter((_, i) => i !== index));
  }

  return (
    <div className="space-y-3">
      {fields.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No fields yet. Add the first field below.
        </p>
      )}
      {fields.map((f, i) => (
        <div
          key={i}
          className="rounded border border-border bg-muted/30 p-3 space-y-2"
        >
          <div className="grid grid-cols-2 gap-2">
            <Input
              label="Key"
              value={(f.key as string) ?? ""}
              onChange={(e) => updateField(i, { key: e.target.value })}
              placeholder="snake_case"
              className="text-xs"
            />
            <Input
              label="Label"
              value={(f.label as string) ?? ""}
              onChange={(e) => updateField(i, { label: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Select
              label="Type"
              value={(f.type as string) ?? "text"}
              onChange={(e) => updateField(i, { type: e.target.value })}
              options={[
                { label: "Text", value: "text" },
                { label: "Long text", value: "textarea" },
                { label: "Number", value: "number" },
                { label: "Date", value: "date" },
                { label: "Select", value: "select" },
                { label: "Checkbox", value: "checkbox" },
              ]}
            />
            <label className="flex items-center gap-2 text-sm pt-7">
              <input
                type="checkbox"
                checked={(f.required as boolean) ?? false}
                onChange={(e) => updateField(i, { required: e.target.checked })}
              />
              Required
            </label>
          </div>
          <button
            type="button"
            onClick={() => removeField(i)}
            className="text-xs text-destructive hover:underline"
          >
            <Trash2 className="h-3 w-3 inline mr-1" />
            Remove field
          </button>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={addField} type="button">
        <Plus className="h-3 w-3 mr-1" />
        Add field
      </Button>
    </div>
  );
}

function AttendeeMultiSelect({
  value,
  onChange,
}: {
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const ATTENDEES: { value: string; label: string }[] = [
    { value: "subject", label: "Subject" },
    { value: "manager", label: "Manager" },
  ];

  // Previously-saved attendees using the removed hr/it/owner roles stay
  // visible as removable chips instead of silently disappearing.
  const unmapped = value.filter((v) => UNMAPPED_ROLES.has(v));

  function toggle(v: string) {
    if (value.includes(v)) onChange(value.filter((x) => x !== v));
    else onChange([...value, v]);
  }

  return (
    <div>
      <p className="block text-sm font-medium text-foreground mb-1">Attendees</p>
      <div className="flex flex-wrap gap-2">
        {ATTENDEES.map((a) => {
          const active = value.includes(a.value);
          return (
            <button
              key={a.value}
              type="button"
              onClick={() => toggle(a.value)}
              className={`px-3 py-1.5 text-xs rounded-full ${
                active
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-border"
              }`}
            >
              {a.label}
            </button>
          );
        })}
        {unmapped.map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => toggle(v)}
            title="This role has no recipient mapping — click to remove it"
            className="px-3 py-1.5 text-xs rounded-full bg-destructive/10 text-destructive hover:bg-destructive/20"
          >
            {v} (unmapped role — click to remove)
          </button>
        ))}
      </div>
    </div>
  );
}
