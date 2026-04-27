"use client";

import { useEffect, useState } from "react";
import type { ScheduledTaskFrequency, ScheduledTaskType } from "@prisma/client";

import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export interface ReportOption {
  key: string;
  name: string;
  description: string;
}

export interface TaskFormState {
  name: string;
  description: string;
  taskType: ScheduledTaskType;
  frequency: ScheduledTaskFrequency;
  hourUtc: number;
  dayOfWeek: number;
  dayOfMonth: number;
  isActive: boolean;
  // Type-specific config
  reportKey: string;
  recipients: string;
  subject: string;
  body: string;
}

export const EMPTY_TASK: TaskFormState = {
  name: "",
  description: "",
  taskType: "EMAIL_REPORT",
  frequency: "DAILY",
  hourUtc: 9,
  dayOfWeek: 1,
  dayOfMonth: 1,
  isActive: true,
  reportKey: "",
  recipients: "",
  subject: "",
  body: "",
};

interface Props {
  state: TaskFormState;
  onChange: (state: TaskFormState) => void;
  reports: ReportOption[];
}

/**
 * Shared form body for create + edit. Lifts state to the parent so
 * the dialogs can decide what to do on submit (call create vs update).
 * The state shape carries every possible config field — only the
 * ones relevant to the active taskType are rendered.
 */
export function TaskForm({ state, onChange, reports }: Props) {
  function patch(p: Partial<TaskFormState>) {
    onChange({ ...state, ...p });
  }

  // Pre-select the first report when the type flips to EMAIL_REPORT
  // and nothing's been picked yet — avoids a "nothing selected" state
  // that would silently fail validation later.
  useEffect(() => {
    if (
      state.taskType === "EMAIL_REPORT" &&
      !state.reportKey &&
      reports.length > 0
    ) {
      onChange({ ...state, reportKey: reports[0].key });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.taskType, reports.length]);

  return (
    <div className="space-y-4">
      <Input
        label="Name"
        value={state.name}
        onChange={(e) => patch({ name: e.target.value })}
        placeholder="e.g. Weekly status report to leadership"
      />
      <Textarea
        label="Description (optional)"
        value={state.description}
        onChange={(e) => patch({ description: e.target.value })}
        rows={2}
      />

      <Select
        label="What should this task do?"
        value={state.taskType}
        onChange={(e) => patch({ taskType: e.target.value as ScheduledTaskType })}
        options={[
          { label: "Email a report", value: "EMAIL_REPORT" },
          { label: "Broadcast a message", value: "EMAIL_MESSAGE" },
        ]}
      />

      {/* ─── Schedule ─── */}
      <div className="grid grid-cols-2 gap-3">
        <Select
          label="Frequency"
          value={state.frequency}
          onChange={(e) =>
            patch({ frequency: e.target.value as ScheduledTaskFrequency })
          }
          options={[
            { label: "Hourly", value: "HOURLY" },
            { label: "Daily", value: "DAILY" },
            { label: "Weekly", value: "WEEKLY" },
            { label: "Monthly", value: "MONTHLY" },
          ]}
        />
        {state.frequency !== "HOURLY" && (
          <Input
            label="Hour (UTC, 0–23)"
            type="number"
            min="0"
            max="23"
            value={state.hourUtc}
            onChange={(e) => patch({ hourUtc: parseInt(e.target.value, 10) || 0 })}
          />
        )}
      </div>
      {state.frequency === "WEEKLY" && (
        <Select
          label="Day of week"
          value={String(state.dayOfWeek)}
          onChange={(e) => patch({ dayOfWeek: parseInt(e.target.value, 10) })}
          options={[
            { label: "Sunday", value: "0" },
            { label: "Monday", value: "1" },
            { label: "Tuesday", value: "2" },
            { label: "Wednesday", value: "3" },
            { label: "Thursday", value: "4" },
            { label: "Friday", value: "5" },
            { label: "Saturday", value: "6" },
          ]}
        />
      )}
      {state.frequency === "MONTHLY" && (
        <Input
          label="Day of month (1–28)"
          type="number"
          min="1"
          max="28"
          value={state.dayOfMonth}
          onChange={(e) =>
            patch({ dayOfMonth: parseInt(e.target.value, 10) || 1 })
          }
        />
      )}

      {/* ─── Type-specific config ─── */}
      {state.taskType === "EMAIL_REPORT" && (
        <>
          <Select
            label="Which report?"
            value={state.reportKey}
            onChange={(e) => patch({ reportKey: e.target.value })}
            placeholder={
              reports.length === 0 ? "No reports registered" : "Select a report"
            }
            options={reports.map((r) => ({
              label: r.name,
              value: r.key,
            }))}
          />
          {state.reportKey && (
            <p className="text-[11px] text-muted-foreground -mt-2">
              {reports.find((r) => r.key === state.reportKey)?.description}
            </p>
          )}
        </>
      )}

      {state.taskType === "EMAIL_MESSAGE" && (
        <>
          <Input
            label="Subject"
            value={state.subject}
            onChange={(e) => patch({ subject: e.target.value })}
            placeholder="Weekly ops update"
          />
          <Textarea
            label="Body"
            value={state.body}
            onChange={(e) => patch({ body: e.target.value })}
            rows={6}
            placeholder={"Hi team,\n\nQuick update for the week ahead…"}
          />
        </>
      )}

      <Textarea
        label="Recipients"
        value={state.recipients}
        onChange={(e) => patch({ recipients: e.target.value })}
        rows={2}
        placeholder="alice@example.com, bob@example.com"
      />
      <p className="text-[11px] text-muted-foreground -mt-3">
        Comma, semicolon, or whitespace separated.
      </p>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={state.isActive}
          onChange={(e) => patch({ isActive: e.target.checked })}
        />
        Active (will fire on schedule)
      </label>
    </div>
  );
}

/**
 * Convert TaskFormState into the upsert payload the server actions
 * expect. Splits config out by task type so the action's discriminated
 * validators stay clean.
 */
export function stateToPayload(state: TaskFormState): {
  name: string;
  description: string | null;
  taskType: ScheduledTaskType;
  frequency: ScheduledTaskFrequency;
  hourUtc: number;
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  config: Record<string, unknown>;
  isActive: boolean;
} {
  const recipients = state.recipients
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  let config: Record<string, unknown>;
  if (state.taskType === "EMAIL_REPORT") {
    config = { reportKey: state.reportKey, recipients };
  } else {
    config = {
      subject: state.subject,
      body: state.body,
      recipients,
    };
  }

  return {
    name: state.name,
    description: state.description.trim() || null,
    taskType: state.taskType,
    frequency: state.frequency,
    hourUtc: state.hourUtc,
    dayOfWeek: state.frequency === "WEEKLY" ? state.dayOfWeek : null,
    dayOfMonth: state.frequency === "MONTHLY" ? state.dayOfMonth : null,
    config,
    isActive: state.isActive,
  };
}
