"use client";

import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TreeView, type TreeNode } from "@/components/shared/tree-view";
import { Building2, ChevronDown, ChevronRight, ArrowUpDown, ArrowUp, ArrowDown, Filter } from "lucide-react";
import Link from "next/link";
import { StatusBadge } from "@/components/shared/status-badge";

export interface ProjectData {
  id: string;
  /** Round-8: URL-friendly slug; falls back to id when null. */
  slug: string | null;
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

// "0 with access" told the reader nothing on every row — show the count
// only when someone actually has access.
function accessLabel(members: number): string | undefined {
  return members > 0 ? `${members} with access` : undefined;
}

function subtreeHasAccess(project: ProjectData): boolean {
  return project._count.members > 0 || project.childProjects.some(subtreeHasAccess);
}

function buildTreeNodes(projects: ProjectData[]): TreeNode[] {
  return projects.map((project) => ({
    id: project.id,
    label: project.name,
    href: `/projects/${project.slug ?? project.id}`,
    status: project.status,
    meta: accessLabel(project._count.members),
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

// A client with exactly one visible leaf project renders as this plain
// row — full group chrome (card, header, column-label row) around a lone
// row spent about twice the row's height on framing. Styling mirrors a
// level-0 TreeView row so it reads as part of the same list.
function SingleProjectRow({ group }: { group: ClientGroup }) {
  const project = group.projects[0];
  return (
    <div
      className="flex items-center gap-2 rounded-lg px-3 py-2"
      style={{
        backgroundColor: "color-mix(in srgb, var(--card) 97%, var(--foreground) 3%)",
        border: "1.5px solid color-mix(in srgb, var(--primary) 35%, transparent)",
      }}
    >
      <span className="w-6 shrink-0 flex justify-center">
        <span
          className="h-2 w-2 rounded-full"
          style={{ backgroundColor: "color-mix(in srgb, var(--primary) 40%, transparent)" }}
        />
      </span>
      <div className="flex flex-1 min-w-0 items-baseline gap-2">
        <Link
          href={`/projects/${project.slug ?? project.id}`}
          className="text-sm font-medium hover:underline hover:text-primary truncate"
        >
          {project.name}
        </Link>
        <Link
          href={`/clients/${group.id}`}
          className="text-xs text-muted-foreground hover:underline hover:text-primary truncate"
        >
          {group.name}
        </Link>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className="w-24 flex justify-center">
          <StatusBadge status={project.status} />
        </span>
        {/* Fixed width mirrors TreeView's meta column so the status pills
            line up with the group cards' rows. */}
        <span className="w-32 text-right text-xs text-muted-foreground truncate">
          {accessLabel(project._count.members) ?? ""}
        </span>
      </div>
    </div>
  );
}

interface Props {
  clientGroups: ClientGroup[];
}

export function ProjectsPageClient({ clientGroups }: Props) {
  const [statusFilter, setStatusFilter] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [sortMap, setSortMap] = useState<Record<string, PerClientSort>>({});

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

  const isSingleRowGroup = (group: ClientGroup) =>
    group.projects.length === 1 && group.projects[0].childProjects.length === 0;

  // Render sequence preserving client order: single-project clients
  // collapse to plain rows (consecutive ones stack tightly); clients with
  // 2+ projects or a sub-project tree keep the card presentation.
  type Block = { kind: "card"; group: ClientGroup } | { kind: "rows"; groups: ClientGroup[] };
  const blocks: Block[] = [];
  for (const group of filteredGroups) {
    const last = blocks[blocks.length - 1];
    if (!isSingleRowGroup(group)) blocks.push({ kind: "card", group });
    else if (last?.kind === "rows") last.groups.push(group);
    else blocks.push({ kind: "rows", groups: [group] });
  }

  // Only card groups can collapse, so Expand/Collapse All tracks them.
  const cardGroupIds = filteredGroups.filter((g) => !isSingleRowGroup(g)).map((g) => g.id);
  const allCollapsed = cardGroupIds.length > 0 && cardGroupIds.every((id) => collapsed.has(id));

  // A column that is empty for every visible row costs width and shows
  // nothing — hide the Access header until someone actually has access
  // (rows already omit their "0 with access" label via accessLabel).
  const anyAccess = filteredGroups.some((g) => g.projects.some(subtreeHasAccess));

  const toggleCollapse = (clientId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(clientId)) next.delete(clientId);
      else next.add(clientId);
      return next;
    });
  };

  const collapseAll = () => {
    setCollapsed(new Set(cardGroupIds));
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

        {cardGroupIds.length > 0 && (
          <button
            onClick={allCollapsed ? expandAll : collapseAll}
            className="px-3 py-2 text-sm border border-input rounded-md bg-background hover:bg-muted transition-colors"
          >
            {allCollapsed ? "Expand All" : "Collapse All"}
          </button>
        )}

        <span className="text-sm text-muted-foreground ml-auto">
          {filteredGroups.length} {filteredGroups.length === 1 ? "company" : "companies"} · {totalProjects} {totalProjects === 1 ? "project" : "projects"}
        </span>
      </div>

      {filteredGroups.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">
          No projects match the selected filter.
        </p>
      ) : (
        <div className="space-y-4">
          {blocks.map((block) => {
            if (block.kind === "rows") {
              return (
                <div key={block.groups[0].id} className="space-y-1.5">
                  {block.groups.map((group) => (
                    <SingleProjectRow key={group.id} group={group} />
                  ))}
                </div>
              );
            }

            const group = block.group;
            const isCollapsed = collapsed.has(group.id);
            const clientSort = sortMap[group.id] || null;
            const sorted = clientSort
              ? sortProjects(group.projects, clientSort.field, clientSort.dir)
              : group.projects;

            return (
              <Card key={group.id}>
                <CardHeader>
                  <div
                    className="flex items-center cursor-pointer select-none"
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
                  </div>
                </CardHeader>

                {!isCollapsed && (
                  <CardContent className="pt-3 pb-4">
                    {/* Sortable column headers */}
                    <div
                      className="flex items-center gap-2 px-2 py-1.5 mb-1 border-b text-xs font-semibold uppercase tracking-wider text-muted-foreground"
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
                      {anyAccess ? (
                        <button
                          className="w-32 flex items-center justify-end gap-1 hover:text-foreground transition-colors"
                          onClick={() => toggleSort(group.id, "members")}
                          title="People with view/edit access to this project. Different from staffing — staffed roles are managed on the project's Staffing card."
                        >
                          Access
                          <SortIcon field="members" current={clientSort} />
                        </button>
                      ) : (
                        // TreeView always reserves this width for its meta
                        // column — keep the header geometry aligned.
                        <span className="w-32" />
                      )}
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
