"use client";

import React, { useMemo, useState } from "react";
import { OrgChartTree, buildOrgTree } from "@/components/shared/org-chart-tree";
import { Network, Grid3x3, Users, Search } from "lucide-react";
import { StaffingMatrix } from "./components/staffing-matrix";
import { EmployeeList } from "./components/employee-list";
import { OrgEditDrawer } from "./org-edit-drawer";
import type {
  UserData,
  ProjectData,
  ClientData,
  ServiceOfferingData,
  RoleDefinitionData,
  ProjectRoleData,
} from "./components/team-types";

type ViewType = "org-chart" | "staffing" | "breakdown";

interface TeamPageClientProps {
  users: UserData[];
  inactiveUsers: UserData[];
  projects: ProjectData[];
  clients: ClientData[];
  serviceOfferings: ServiceOfferingData[];
  roleDefinitions: RoleDefinitionData[];
  projectRoles: ProjectRoleData[];
  currentUserId: string;
  canManage: boolean;
}

const VIEW_TABS: { key: ViewType; label: string; icon: React.ElementType }[] = [
  { key: "org-chart", label: "Org Chart", icon: Network },
  { key: "staffing", label: "Staffing Matrix", icon: Grid3x3 },
  { key: "breakdown", label: "Employees", icon: Users },
];

export function TeamPageClient({
  users,
  inactiveUsers,
  projects,
  clients,
  serviceOfferings,
  roleDefinitions,
  projectRoles,
  currentUserId,
  canManage,
}: TeamPageClientProps) {
  const [view, setView] = useState<ViewType>("org-chart");
  const [search, setSearch] = useState("");

  return (
    <div>
      <div className="flex items-center gap-2 mb-6">
        <div className="flex rounded-lg border border-border overflow-hidden">
          {VIEW_TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.key}
                onClick={() => setView(tab.key)}
                className={`flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors ${
                  view === tab.key
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted"
                }`}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </div>
        <div className="flex-1" />
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search employees..."
            className="pl-9 pr-3 py-2 text-sm border border-input rounded-md bg-background w-64"
          />
        </div>
      </div>

      {view === "org-chart" && (
        <OrgChartView
          users={users}
          search={search}
          canManage={canManage}
          currentUserId={currentUserId}
        />
      )}
      {view === "staffing" && (
        <StaffingMatrix
          users={users}
          projects={projects}
          clients={clients}
          serviceOfferings={serviceOfferings}
          roleDefinitions={roleDefinitions}
          projectRoles={projectRoles}
          search={search}
          canManage={canManage}
        />
      )}
      {view === "breakdown" && (
        <EmployeeList users={users} inactiveUsers={inactiveUsers} search={search} />
      )}
    </div>
  );
}

// ─── Org Chart View ─────────────────────────────────

function OrgChartView({
  users,
  search,
  canManage,
  currentUserId,
}: {
  users: UserData[];
  search: string;
  canManage: boolean;
  currentUserId: string;
}) {
  // Org chart edit drawer state. We track only the selected id and
  // resolve the user from the prop list — keeps the drawer in sync
  // when the page re-fetches after a save.
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Always pass the FULL user list to buildOrgTree. Filtering by
  // search would orphan the descendants of any unmatched manager and
  // shred the tree. We pass `search` to the chart as a HIGHLIGHT
  // hint instead — the chart rings matching cards in primary color.
  const tree = useMemo(
    () =>
      buildOrgTree(
        users.map((u) => ({
          id: u.id,
          name: u.name,
          jobTitle: u.jobTitle,
          department: u.department,
          location: u.location,
          avatar: u.avatar,
          role: u.role,
          managerId: u.managerId ?? undefined,
          // Don't set href — clicking opens the edit drawer instead
          // when the viewer can manage. For non-managers we route
          // to the canonical profile via href.
          href: canManage ? undefined : `/team/${u.id}`,
        }))
      ),
    [users, canManage]
  );

  const selected = useMemo(
    () => (selectedId ? users.find((u) => u.id === selectedId) ?? null : null),
    [selectedId, users]
  );

  // Manager picker options exclude the current user (can't manage
  // yourself) and anyone whose existing ancestry passes through
  // them — preventing cycles at edit time. Cheap because user counts
  // are typically O(100s).
  const managerOptions = useMemo(() => {
    if (!selected) return [];
    const descendantIds = collectDescendants(users, selected.id);
    return users
      .filter((u) => u.id !== selected.id && !descendantIds.has(u.id))
      .map((u) => ({ id: u.id, name: u.name }));
  }, [selected, users]);

  return (
    <div>
      {/* The status / how-to line that used to live here was a dupe of the
       *  one inside org-chart-canvas.tsx (which sits next to the chart's
       *  layout buttons). Pre-cleanup the team page rendered both, which
       *  the QA stress test flagged. The canvas version is the canonical
       *  one — it stays. */}
      <p className="text-xs text-muted-foreground mb-3">
        {canManage
          ? "Click a card to edit. Use search to highlight people without breaking the tree."
          : "Click a card to view the profile."}
      </p>

      <OrgChartTree
        nodes={tree}
        highlight={search}
        onCardClick={canManage ? (id) => setSelectedId(id) : undefined}
      />

      {canManage && selected && (
        <OrgEditDrawer
          user={{
            id: selected.id,
            name: selected.name,
            email: selected.email,
            role: selected.role,
            jobTitle: selected.jobTitle ?? null,
            department: selected.department ?? null,
            location: selected.location ?? null,
            managerId: selected.managerId ?? null,
            isActive: selected.isActive,
          }}
          managerOptions={managerOptions}
          onClose={() => setSelectedId(null)}
        />
      )}

      {/* Hidden heading-only marker so screen-readers announce who's
          currently being edited. The actual content is in the drawer. */}
      {selected && currentUserId === selected.id && (
        <span className="sr-only">Editing your own org-chart entry.</span>
      )}
    </div>
  );
}

/**
 * Walk the user list to find every descendant of a given id. Used by
 * the manager picker to forbid cycle-creating reassignments.
 */
function collectDescendants(users: UserData[], rootId: string): Set<string> {
  const childrenByManager = new Map<string, string[]>();
  for (const u of users) {
    if (u.managerId) {
      const arr = childrenByManager.get(u.managerId) ?? [];
      arr.push(u.id);
      childrenByManager.set(u.managerId, arr);
    }
  }
  const out = new Set<string>();
  function visit(id: string): void {
    const kids = childrenByManager.get(id) ?? [];
    for (const k of kids) {
      if (out.has(k)) continue;
      out.add(k);
      visit(k);
    }
  }
  visit(rootId);
  return out;
}
