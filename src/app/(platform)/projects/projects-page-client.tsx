"use client";

import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TreeView, type TreeNode } from "@/components/shared/tree-view";
import { Building2, ChevronDown, ChevronRight, ArrowUpDown, ArrowUp, ArrowDown, Filter } from "lucide-react";
import Link from "next/link";
import { ProjectCreateButton } from "./project-create-button";

export interface ProjectData {
  id: string;
  name: string;
  status: string;
  client: { id: string; name: string };
  _count: { members: number; childProjects: number; tasks: number };
  childProjects: ProjectData[];
}

export interface ClientGroup {
  id: string;
  name: string;
  projects: ProjectData[];
}

type SortField = "name" | "status" | "members";
type SortDir = "asc" | "desc";

interface PerClientSort {
  field: SortField;
  dir: SortDir;
}

const STATUS_OPTIONS = [
  { label: "All Statuses", value: "" },
  { label: "Active", value: "ACTIVE" },
  { label: "Planning", value: "PLANNING" },
  { label: "On Hold", value: "ON_HOLD" },
  { label: "Completed", value: "COMPLETED" },
  { label: "Archived", value: "ARCHIVED" },
];

const STATUS_ORDER: Record<string, number> = {
  ACTIVE: 0,
  PLANNING: 1,
  ON_HOLD: 2,
  COMPLETED: 3,
  ARCHIVED: 4,
};

function buildTreeNodes(projects: ProjectData[]): TreeNode[] {
  return projects.map((project) => ({
    id: project.id,
    label: project.name,
    href: `/projects/${project.id}`,
    status: project.status,
    meta:
      project._count.members === 1
        ? "1 with access"
        : `${project._count.members} with access`,
    children: project.childProjects.length > 0
      ? buildTreeNodes(project.childProjects)
      : undefined,
  }));
}

function sortProjects(projects: ProjectData[], field: SortField, dir: SortDir): ProjectData[] {
  return [...projects].sort((a, b) => {
    let cmp = 0;
    switch (field) {
      case "name":
        cmp = a.name.localeCompare(b.name);
        break;
      case "status":
        cmp = (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99);
        break;
      case "members":
        cmp = a._count.members - b._count.members;
        break;
    }
    return dir === "desc" ? -cmp : cmp;
  });
}

function hasStatus(project: ProjectData, status: string): boolean {
  if (project.status === status) return true;
  return project.childProjects.some((child) => hasStatus(child, status));
}

function SortIcon({ field, current }: { field: SortField; current: PerClientSort | null }) {
  if (!current || current.field !== field) {
    return <ArrowUpDown className="h-3 w-3 opacity-40" />;
  }
  return current.dir === "asc"
    ? <ArrowUp className="h-3 w-3" />
    : <ArrowDown className="h-3 w-3" />;
}

interface Props {
  clientGroups: ClientGroup[];
  clients: { id: string; name: string }[];
  allProjects: { id: string; name: string }[];
  canCreate: boolean;
}

export function ProjectsPageClient({ clientGroups, clients, allProjects, canCreate }: Props) {
  const [statusFilter, setStatusFilter] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [sortMap, setSortMap] = useState<Record<string, PerClientSort>>({});

  const toggleCollapse = (clientId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(clientId)) next.delete(clientId);
      else next.add(clientId);
      return next;
    });
  };

  const collapseAll = () => {
    setCollapsed(new Set(clientGroups.map((g) => g.id)));
  };

  const expandAll = () => {
    setCollapsed(new Set());
  };

  const toggleSort = (clientId: string, field: SortField) => {
    setSortMap((prev) => {
      const current = prev[clientId];
      if (current?.field === field) {
        if (current.dir === "asc") {
          return { ...prev, [clientId]: { field, dir: "desc" } };
        }
        // Already desc — remove sort
        const next = { ...prev };
        delete next[clientId];
        return next;
      }
      return { ...prev, [clientId]: { field, dir: "asc" } };
    });
  };

  const filteredGroups = useMemo(() => {
    if (!statusFilter) return clientGroups;
    return clientGroups
      .map((group) => ({
        ...group,
        projects: group.projects.filter((p) => hasStatus(p, statusFilter)),
      }))
      .filter((group) => group.projects.length > 0);
  }, [clientGroups, statusFilter]);

  const totalProjects = filteredGroups.reduce((sum, g) => sum + g.projects.length, 0);
  const allCollapsed = collapsed.size >= filteredGroups.length && filteredGroups.length > 0;

  return (
    <div>
      {/* Global controls */}
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 text-sm border border-input rounded-md bg-background"
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <button
          onClick={allCollapsed ? expandAll : collapseAll}
          className="px-3 py-2 text-sm border border-input rounded-md bg-background hover:bg-muted transition-colors"
        >
          {allCollapsed ? "Expand All" : "Collapse All"}
        </button>

        <span className="text-sm text-muted-foreground ml-auto">
          {filteredGroups.length} {filteredGroups.length === 1 ? "company" : "companies"} · {totalProjects} {totalProjects === 1 ? "project" : "projects"}
        </span>
      </div>

      {filteredGroups.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">
          No projects match the selected filter.
        </p>
      ) : (
        <div className="space-y-6">
          {filteredGroups.map((group) => {
            const isCollapsed = collapsed.has(group.id);
            const clientSort = sortMap[group.id] || null;
            const sorted = clientSort
              ? sortProjects(group.projects, clientSort.field, clientSort.dir)
              : group.projects;

            return (
              <Card key={group.id}>
                <CardHeader>
                  <div
                    className="flex items-center justify-between cursor-pointer select-none"
                    onClick={() => toggleCollapse(group.id)}
                  >
                    <CardTitle className="flex items-center gap-2">
                      {isCollapsed ? (
                        <ChevronRight className="h-5 w-5 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="h-5 w-5 text-muted-foreground" />
                      )}
                      <Building2 className="h-5 w-5 text-primary" />
                      <Link
                        href={`/clients/${group.id}`}
                        className="hover:underline hover:text-primary"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {group.name}
                      </Link>
                      <span className="text-sm font-normal text-muted-foreground ml-1">
                        {group.projects.length} {group.projects.length === 1 ? "project" : "projects"}
                      </span>
                    </CardTitle>
                    {canCreate && (
                      <div onClick={(e) => e.stopPropagation()}>
                        <ProjectCreateButton
                          clients={clients}
                          projects={allProjects}
                          defaultClientId={group.id}
                        />
                      </div>
                    )}
                  </div>
                </CardHeader>

                {!isCollapsed && (
                  <CardContent>
                    {/* Sortable column headers */}
                    <div
                      className="flex items-center gap-2 px-2 py-2 mb-2 border-b text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                      style={{ borderColor: "color-mix(in srgb, var(--foreground) 10%, transparent)" }}
                    >
                      <span className="w-6" />
                      <button
                        className="flex-1 flex items-center gap-1 text-left hover:text-foreground transition-colors"
                        onClick={() => toggleSort(group.id, "name")}
                      >
                        Project
                        <SortIcon field="name" current={clientSort} />
                      </button>
                      <button
                        className="w-24 flex items-center justify-center gap-1 hover:text-foreground transition-colors"
                        onClick={() => toggleSort(group.id, "status")}
                      >
                        Status
                        <SortIcon field="status" current={clientSort} />
                      </button>
                      <button
                        className="w-32 flex items-center justify-end gap-1 hover:text-foreground transition-colors"
                        onClick={() => toggleSort(group.id, "members")}
                        title="People with view/edit access to this project. Different from staffing — staffed roles are managed on the project's Staffing card."
                      >
                        Access
                        <SortIcon field="members" current={clientSort} />
                      </button>
                    </div>
                    <TreeView nodes={buildTreeNodes(sorted)} />
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
