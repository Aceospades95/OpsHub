"use client";

import { useState, useMemo } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { OrgChartTree, buildOrgTree } from "@/components/shared/org-chart-tree";
import { Network, Grid3x3, Users, Search } from "lucide-react";

type ViewType = "org-chart" | "staffing" | "breakdown";

interface UserData {
  id: string;
  name: string;
  email: string;
  role: string;
  jobTitle: string | null;
  department: string | null;
  avatar: string | null;
  managerId: string | null;
  manager: { id: string; name: string } | null;
  isActive: boolean;
  projectMembers: {
    role: string;
    project: { id: string; name: string; status: string };
  }[];
}

interface ProjectData {
  id: string;
  name: string;
  status: string;
}

interface TeamPageClientProps {
  users: UserData[];
  projects: ProjectData[];
  currentUserId: string;
}

const VIEW_TABS: { key: ViewType; label: string; icon: React.ElementType }[] = [
  { key: "org-chart", label: "Org Chart", icon: Network },
  { key: "staffing", label: "Staffing Matrix", icon: Grid3x3 },
  { key: "breakdown", label: "Employees", icon: Users },
];

export function TeamPageClient({ users, projects, currentUserId }: TeamPageClientProps) {
  const [view, setView] = useState<ViewType>("org-chart");
  const [search, setSearch] = useState("");

  return (
    <div>
      {/* View switcher */}
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
            placeholder="Search by name..."
            className="pl-9 pr-3 py-2 text-sm border border-input rounded-md bg-background w-64"
          />
        </div>
      </div>

      {/* Views */}
      {view === "org-chart" && (
        <OrgChartView users={users} search={search} currentUserId={currentUserId} />
      )}
      {view === "staffing" && (
        <StaffingMatrix users={users} projects={projects} search={search} />
      )}
      {view === "breakdown" && (
        <EmployeeBreakdown users={users} search={search} />
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
      u.department?.toLowerCase().includes(q)
    );
  }, [users, search]);

  const tree = useMemo(() => buildOrgTree(filtered), [filtered]);

  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground mb-2">
          {users.length} team members · Click nodes to collapse/expand
        </div>
        <OrgChartTree nodes={tree} highlightId={currentUserId} />
      </CardContent>
    </Card>
  );
}

// ─── Staffing Matrix View ───────────────────────────

function StaffingMatrix({ users, projects, search }: { users: UserData[]; projects: ProjectData[]; search: string }) {
  const [deptFilter, setDeptFilter] = useState("");

  const departments = useMemo(() => {
    const depts = new Set(users.map((u) => u.department).filter(Boolean) as string[]);
    return Array.from(depts).sort();
  }, [users]);

  const filteredUsers = useMemo(() => {
    let result = users;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter((u) => u.name.toLowerCase().includes(q));
    }
    if (deptFilter) {
      result = result.filter((u) => u.department === deptFilter);
    }
    return result;
  }, [users, search, deptFilter]);

  // Only show projects that have at least one member
  const activeProjects = useMemo(() => {
    const projectIds = new Set(users.flatMap((u) => u.projectMembers.map((pm) => pm.project.id)));
    return projects.filter((p) => projectIds.has(p.id));
  }, [users, projects]);

  // Build lookup: userId -> projectId -> role
  const assignments = useMemo(() => {
    const map = new Map<string, Map<string, string>>();
    for (const u of users) {
      const pm = new Map<string, string>();
      for (const m of u.projectMembers) {
        pm.set(m.project.id, m.role);
      }
      map.set(u.id, pm);
    }
    return map;
  }, [users]);

  const roleColors: Record<string, string> = {
    ADMIN: "bg-purple-100 text-purple-800",
    MANAGER: "bg-blue-100 text-blue-800",
    DEVELOPER: "bg-green-100 text-green-800",
    CONTRIBUTOR: "bg-yellow-100 text-yellow-800",
    VIEWER: "bg-gray-100 text-gray-800",
  };

  return (
    <div>
      {departments.length > 0 && (
        <div className="mb-4">
          <select value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)}
            className="px-3 py-2 text-sm border border-input rounded-md bg-background">
            <option value="">All Departments</option>
            {departments.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="text-left py-3 px-4 font-semibold sticky left-0 bg-muted/50 z-10 min-w-[180px]">
                    Employee
                  </th>
                  {activeProjects.map((p) => (
                    <th key={p.id} className="text-center py-3 px-3 font-semibold min-w-[100px]">
                      <div className="truncate max-w-[100px]" title={p.name}>{p.name}</div>
                      <Badge variant={p.status === "ACTIVE" ? "success" : "outline"} className="text-[9px] mt-0.5">
                        {p.status}
                      </Badge>
                    </th>
                  ))}
                  <th className="text-center py-3 px-3 font-semibold text-muted-foreground min-w-[60px]">Total</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((user) => {
                  const userAssignments = assignments.get(user.id) || new Map();
                  return (
                    <tr key={user.id} className="border-b border-border/50 hover:bg-muted/30">
                      <td className="py-2 px-4 sticky left-0 bg-card z-10">
                        <div className="flex items-center gap-2">
                          <Avatar name={user.name} size="xs" />
                          <div className="min-w-0">
                            <p className="font-medium text-sm truncate">{user.name}</p>
                            <p className="text-[10px] text-muted-foreground truncate">{user.jobTitle || user.department || ""}</p>
                          </div>
                        </div>
                      </td>
                      {activeProjects.map((p) => {
                        const role = userAssignments.get(p.id);
                        return (
                          <td key={p.id} className="text-center py-2 px-3">
                            {role ? (
                              <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${roleColors[role] || "bg-gray-100 text-gray-800"}`}>
                                {role}
                              </span>
                            ) : (
                              <span className="text-muted-foreground/30">—</span>
                            )}
                          </td>
                        );
                      })}
                      <td className="text-center py-2 px-3 font-medium text-muted-foreground">
                        {userAssignments.size}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border bg-muted/30">
                  <td className="py-2 px-4 font-semibold text-sm sticky left-0 bg-muted/30 z-10">
                    Total Members
                  </td>
                  {activeProjects.map((p) => {
                    const count = filteredUsers.filter((u) =>
                      (assignments.get(u.id) || new Map()).has(p.id)
                    ).length;
                    return (
                      <td key={p.id} className="text-center py-2 px-3 font-semibold text-sm">
                        {count || "—"}
                      </td>
                    );
                  })}
                  <td className="text-center py-2 px-3" />
                </tr>
              </tfoot>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Employee Breakdown View ────────────────────────

function EmployeeBreakdown({ users, search }: { users: UserData[]; search: string }) {
  const [deptFilter, setDeptFilter] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const departments = useMemo(() => {
    const depts = new Set(users.map((u) => u.department).filter(Boolean) as string[]);
    return Array.from(depts).sort();
  }, [users]);

  const filtered = useMemo(() => {
    let result = users;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter((u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
    }
    if (deptFilter) result = result.filter((u) => u.department === deptFilter);
    if (roleFilter) result = result.filter((u) => u.role === roleFilter);
    return result;
  }, [users, search, deptFilter, roleFilter]);

  const roleColors: Record<string, string> = {
    ADMIN: "bg-purple-100 text-purple-800",
    MANAGER: "bg-blue-100 text-blue-800",
    DEVELOPER: "bg-green-100 text-green-800",
    CONTRIBUTOR: "bg-yellow-100 text-yellow-800",
    VIEWER: "bg-gray-100 text-gray-800",
  };

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        {departments.length > 0 && (
          <select value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)}
            className="px-3 py-2 text-sm border border-input rounded-md bg-background">
            <option value="">All Departments</option>
            {departments.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        )}
        <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}
          className="px-3 py-2 text-sm border border-input rounded-md bg-background">
          <option value="">All Roles</option>
          {["ADMIN", "MANAGER", "DEVELOPER", "CONTRIBUTOR", "VIEWER"].map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
        <span className="text-sm text-muted-foreground ml-auto">{filtered.length} employees</span>
      </div>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="text-left py-3 px-4 font-semibold">Employee</th>
                <th className="text-left py-3 px-4 font-semibold hidden md:table-cell">Job Title</th>
                <th className="text-left py-3 px-4 font-semibold hidden lg:table-cell">Department</th>
                <th className="text-left py-3 px-4 font-semibold hidden lg:table-cell">Manager</th>
                <th className="text-center py-3 px-4 font-semibold">Role</th>
                <th className="text-center py-3 px-4 font-semibold">Projects</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((user) => (
                <>
                  <tr key={user.id}
                    className="border-b border-border/50 hover:bg-muted/30 cursor-pointer"
                    onClick={() => setExpandedId(expandedId === user.id ? null : user.id)}
                  >
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        <Avatar name={user.name} size="sm" />
                        <div className="min-w-0">
                          <p className="font-medium truncate">{user.name}</p>
                          <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-muted-foreground hidden md:table-cell">{user.jobTitle || "—"}</td>
                    <td className="py-3 px-4 text-muted-foreground hidden lg:table-cell">{user.department || "—"}</td>
                    <td className="py-3 px-4 text-muted-foreground hidden lg:table-cell">{user.manager?.name || "—"}</td>
                    <td className="py-3 px-4 text-center">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${roleColors[user.role] || ""}`}>
                        {user.role}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-center font-medium">
                      {user.projectMembers.length || "—"}
                    </td>
                  </tr>
                  {expandedId === user.id && user.projectMembers.length > 0 && (
                    <tr key={`${user.id}-expand`} className="bg-muted/20">
                      <td colSpan={6} className="py-2 px-8">
                        <div className="flex flex-wrap gap-2">
                          {user.projectMembers.map((pm) => (
                            <a key={pm.project.id} href={`/projects/${pm.project.id}`}
                              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md border border-border bg-card text-sm hover:bg-muted transition-colors">
                              <span className="font-medium">{pm.project.name}</span>
                              <Badge variant={pm.project.status === "ACTIVE" ? "success" : "outline"} className="text-[9px]">
                                {pm.role}
                              </Badge>
                            </a>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
