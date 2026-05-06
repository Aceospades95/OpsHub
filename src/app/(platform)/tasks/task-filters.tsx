"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

interface TaskFiltersProps {
  projects: { id: string; name: string }[];
  clients: { id: string; name: string }[];
  users: { id: string; name: string }[];
  currentAssignee?: string;
  currentProject?: string;
  currentClient?: string;
  currentShow?: string;
  currentDue?: string;
  currentUserId: string;
}

export function TaskFilters({
  projects,
  clients,
  users,
  currentAssignee,
  currentProject,
  currentClient,
  currentShow,
  currentDue,
  currentUserId,
}: TaskFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const updateFilter = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      router.push(`/tasks?${params.toString()}`);
    },
    [router, searchParams]
  );

  const clearAll = () => {
    router.push("/tasks");
  };

  const hasFilters =
    currentAssignee || currentProject || currentClient || currentShow || currentDue;

  return (
    <div className="flex flex-wrap items-center gap-3 mb-6">
      {/* Quick filters */}
      <div className="flex flex-wrap items-center gap-1.5">
        <QuickButton
          label="My Tasks"
          active={currentAssignee === "me"}
          onClick={() => updateFilter("assignee", currentAssignee === "me" ? "" : "me")}
        />
        <QuickButton
          label="Active"
          active={currentShow === "active"}
          onClick={() => updateFilter("show", currentShow === "active" ? "" : "active")}
        />
        <QuickButton
          label="Completed"
          active={currentShow === "done"}
          onClick={() => updateFilter("show", currentShow === "done" ? "" : "done")}
        />
        <QuickButton
          label="Past due"
          active={currentDue === "overdue"}
          onClick={() => updateFilter("due", currentDue === "overdue" ? "" : "overdue")}
        />
        <QuickButton
          label="Due this week"
          active={currentDue === "week"}
          onClick={() => updateFilter("due", currentDue === "week" ? "" : "week")}
        />
        <QuickButton
          label="No assignee"
          active={currentAssignee === "unassigned"}
          onClick={() =>
            updateFilter(
              "assignee",
              currentAssignee === "unassigned" ? "" : "unassigned"
            )
          }
        />
        <QuickButton
          label="No project"
          active={currentProject === "none"}
          onClick={() => updateFilter("project", currentProject === "none" ? "" : "none")}
        />
      </div>

      <span className="text-border">|</span>

      {/* Dropdown filters */}
      <FilterSelect
        value={currentAssignee === "me" ? "me" : currentAssignee || ""}
        onChange={(v) => updateFilter("assignee", v)}
        placeholder="Assignee"
      >
        <option value="">All people</option>
        <option value="me">Assigned to me</option>
        <option value="unassigned">Unassigned</option>
        {users
          .filter((u) => u.id !== currentUserId)
          .map((u) => (
            <option key={u.id} value={u.id}>{u.name}</option>
          ))}
      </FilterSelect>

      <FilterSelect
        value={currentProject || ""}
        onChange={(v) => updateFilter("project", v)}
        placeholder="Project"
      >
        <option value="">All projects</option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </FilterSelect>

      <FilterSelect
        value={currentClient || ""}
        onChange={(v) => updateFilter("client", v)}
        placeholder="Client"
      >
        <option value="">All clients</option>
        {clients.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </FilterSelect>

      {hasFilters && (
        <button
          onClick={clearAll}
          className="text-xs text-primary hover:underline"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}

function QuickButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
        active
          ? "bg-primary text-primary-foreground"
          : "bg-muted text-muted-foreground hover:bg-border"
      }`}
    >
      {label}
    </button>
  );
}

function FilterSelect({
  value,
  onChange,
  placeholder,
  children,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  children: React.ReactNode;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`h-8 rounded border border-input bg-background px-2 text-xs outline-none focus:ring-2 focus:ring-primary ${
        value ? "text-foreground font-medium" : "text-muted-foreground"
      }`}
      aria-label={placeholder}
    >
      {children}
    </select>
  );
}
