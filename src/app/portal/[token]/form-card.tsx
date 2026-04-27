"use client";

import { useState, useTransition } from "react";
import { ListChecks } from "lucide-react";

import { submitWorkflowPortalForm } from "@/actions/workflow-portal";
import type { PendingItem } from "./portal-client";

interface FormField {
  key: string;
  label: string;
  type: "text" | "textarea" | "number" | "date" | "select" | "checkbox";
  required: boolean;
  options?: { label: string; value: string }[];
  helpText?: string;
}

interface Props {
  token: string;
  item: PendingItem;
  onComplete: () => void;
  onCancel: () => void;
}

export function FormCard({ token, item, onComplete, onCancel }: Props) {
  const fields = ((item.config.fields as FormField[]) ?? []) as FormField[];
  const [responses, setResponses] = useState<Record<string, unknown>>(() => {
    const initial: Record<string, unknown> = {};
    for (const f of fields) {
      initial[f.key] = f.type === "checkbox" ? false : "";
    }
    return initial;
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function patch(key: string, value: unknown) {
    setResponses((prev) => ({ ...prev, [key]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await submitWorkflowPortalForm({
        token,
        instanceStepId: item.instanceStepId,
        responses,
      });
      if ("error" in res) {
        setError(res.error ?? "Could not submit");
        return;
      }
      onComplete();
    });
  }

  if (fields.length === 0) {
    return (
      <p className="text-sm text-neutral-500">
        This form has no fields configured. Ask the workflow owner to
        update the template.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {fields.map((f) => (
        <div key={f.key}>
          <label className="block text-xs font-medium text-neutral-700 mb-1">
            {f.label}
            {f.required && <span className="text-rose-600"> *</span>}
          </label>
          <FieldInput field={f} value={responses[f.key]} onChange={(v) => patch(f.key, v)} />
          {f.helpText && (
            <p className="text-[11px] text-neutral-500 mt-1">{f.helpText}</p>
          )}
        </div>
      ))}
      {error && <p className="text-sm text-rose-700">{error}</p>}
      <div className="flex justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="px-4 py-2 rounded-md border border-neutral-300 text-sm hover:bg-neutral-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={pending}
          className="px-4 py-2 rounded-md bg-neutral-900 text-white text-sm hover:bg-neutral-800 disabled:opacity-60 inline-flex items-center"
        >
          <ListChecks className="h-3 w-3 mr-1.5" />
          {pending ? "Submitting…" : "Submit"}
        </button>
      </div>
    </form>
  );
}

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: FormField;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const baseInput =
    "w-full rounded border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900";
  switch (field.type) {
    case "textarea":
      return (
        <textarea
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          className={baseInput}
        />
      );
    case "number":
      return (
        <input
          type="number"
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          className={baseInput}
        />
      );
    case "date":
      return (
        <input
          type="date"
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          className={baseInput}
        />
      );
    case "select":
      return (
        <select
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          className={baseInput}
        >
          <option value="">— select —</option>
          {(field.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    case "checkbox":
      return (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => onChange(e.target.checked)}
            className="h-4 w-4 rounded border-neutral-300"
          />
          {field.label}
        </label>
      );
    case "text":
    default:
      return (
        <input
          type="text"
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          className={baseInput}
        />
      );
  }
}
