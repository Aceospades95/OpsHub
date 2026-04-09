"use client";

import React, { useState } from "react";
import { OrgChartTree, buildOrgTree } from "@/components/shared/org-chart-tree";
import { Card, CardContent } from "@/components/ui/card";
import { Network, Grid3x3, Users, Search } from "lucide-react";
import { useMemo } from "react";
import { StaffingMatrix } from "./components/staffing-matrix";
import { EmployeeList } from "./components/employee-list";
import type { UserData, ProjectData, ClientData, ServiceOfferingData } from "./components/team-types";

type ViewType = "org-chart" | "staffing" | "breakdown";

interface TeamPageClientProps {
  users: UserData[];
  inactiveUsers: UserData[];
  projects: ProjectData[];
  clients: ClientData[];
  serviceOfferings: ServiceOfferingData[];
  currentUserId: string;
  canManage: boolean;
}

const VIEW_TABS: { key: ViewType; label: string; icon: React.ElementType }[] = [
  { key: "org-chart", label: "Org Chart", icon: Network },
  { key: "staffing", label: "Staffing Matrix", icon: Grid3x3 },
  { key: "breakdown", label: "Employees", icon: Users },
];

export function TeamPageClient({ users, inactiveUsers, projects, clients, serviceOfferings, currentUserId, canManage }: TeamPageClientProps) {
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
        <OrgChartView users={users} search={search} currentUserId={currentUserId} />
      )}
      {view === "staffing" && (
        <StaffingMatrix
          users={users}
          projects={projects}
          clients={clients}
          serviceOfferings={serviceOfferings}
          search={search}
        />
      )}
      {view === "breakdown" && (
        <EmployeeList users={users} inactiveUsers={inactiveUsers} search={search} />
      )}
    </div>
  );
}

// ─── Org Chart View ─────────────────────────────────

function OrgChartView({ users, search, currentUserId }: { users: UserData[]; search: string; currentUserId: string }) {
  const filtered = useMemo(() => {
    if (!search) return users;
    const q = search.toLowerCase();
    return users.filter((u) =>
      u.name.toLowerCase().includes(q) ||
      u.jobTitle?.toLowerCase().includes(q) ||
      u.department?.toLowerCase().includes(q) ||
      u.location?.toLowerCase().includes(q)
    );
  }, [users, search]);

  const tree = useMemo(() => buildOrgTree(
    filtered.map((u) => ({ ...u, href: `/team/${u.id}` }))
  ), [filtered]);

  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground mb-2">
          {users.length} team members · Click a person to view their profile
        </div>
        <OrgChartTree nodes={tree} />
      </CardContent>
    </Card>
  );
}
