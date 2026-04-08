"use client";

import { useState, useMemo } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { OrgChartTree, buildOrgTree } from "@/components/shared/org-chart-tree";
import { Network, Grid3x3, Users, Search, ChevronDown, ChevronRight, MapPin } from "lucide-react";

type ViewType = "org-chart" | "staffing" | "breakdown";

interface UserData {
  id: string;
  name: string;
  email: string;
  role: string;
  jobTitle: string | null;
  department: string | null;
  location: string | null;
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
  inactiveUsers: UserData[];
  projects: ProjectData[];
  currentUserId: string;
}

const VIEW_TABS: { key: ViewType; label: string; icon: React.ElementType }[] = [
  { key: "org-chart", label: "Org Chart", icon: Network },
  { key: "staffing", label: "Staffing Matrix", icon: Grid3x3 },
  { key: "breakdown", label: "Employees", icon: Users },
];

export function TeamPageClient({ users, inactiveUsers, projects, currentUserId }: TeamPageClientProps) {
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
            placeholder="Search by name..."
            className="pl-9 pr-3 py-2 text-sm border border-input rounded-md bg-background w-64"
          />
        </div>
      </div>

      {view === "org-chart" && (
        <OrgChartView users={users} search={search} currentUserId={currentUserId} />
      )}
      {view === "staffing" && (
        <StaffingMatrix users={users} projects={projects} search={search} />
      )}
      {view === "breakdown" && (
        <EmployeeBreakdown users={users} inactiveUsers={inactiveUsers} search={search} />
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

const STATUS_GROUPS: { status: string[]; label: string; color: string }[] = [
  { status: ["ACTIVE"], label: "Active Projects", color: "text-green-700" },
  { status: ["PLANNING", "ON_HOLD"], label: "Planning / On Hold", color: "text-blue-700" },
  { status: ["COMPLETED"], label: "Completed", color: "text-muted-foreground" },
];

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
    if (deptFilter) result = result.filter((u) => u.department === deptFilter);
    return result;
  }, [users, search, deptFilter]);

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

  // Group projects by status
  const groupedProjects = useMemo(() => {
    const projectIds = new Set(users.flatMap((u) => u.projectMembers.map((pm) => pm.project.id)));
    const relevantProjects = projects.filter((p) => projectIds.has(p.id));
    return STATUS_GROUPS.map((g) => ({
      ...g,
      projects: relevantProjects.filter((p) => g.status.includes(p.status)),
    })).filter((g) => g.projects.length > 0);
  }, [users, projects]);

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

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {groupedProjects.map((group) => (
          <Card key={group.label}>
            <CardHeader className="pb-2">
              <CardTitle className={`text-sm ${group.color}`}>{group.label}</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2 px-3 text-xs font-semibold text-muted-foreground">Employee</th>
                      {group.projects.map((p) => (
                        <th key={p.id} className="text-center py-2 px-2 text-xs font-semibold min-w-[80px]">
                          <div className="truncate max-w-[80px]" title={p.name}>{p.name}</div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredUsers.filter((u) =>
                      group.projects.some((p) => (assignments.get(u.id) || new Map()).has(p.id))
                    ).map((user) => {
                      const userAssignments = assignments.get(user.id) || new Map();
                      return (
                        <tr key={user.id} className="border-b border-border/50">
                          <td className="py-1.5 px-3">
                            <div className="flex items-center gap-2">
                              <Avatar name={user.name} size="xs" />
                              <span className="text-xs font-medium truncate">{user.name}</span>
                            </div>
                          </td>
                          {group.projects.map((p) => {
                            const role = userAssignments.get(p.id);
                            return (
                              <td key={p.id} className="text-center py-1.5 px-2">
                                {role ? (
                                  <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${roleColors[role] || "bg-gray-100 text-gray-800"}`}>
                                    {role}
                                  </span>
                                ) : (
                                  <span className="text-muted-foreground/20">—</span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ─── Employee Breakdown View ────────────────────────

function EmployeeBreakdown({ users, inactiveUsers, search }: { users: UserData[]; inactiveUsers: UserData[]; search: string }) {
  const [deptFilter, setDeptFilter] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  const departments = useMemo(() => {
    const depts = new Set([...users, ...inactiveUsers].map((u) => u.department).filter(Boolean) as string[]);
    return Array.from(depts).sort();
  }, [users, inactiveUsers]);

  function filterUsers(list: UserData[]) {
    let result = list;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter((u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
    }
    if (deptFilter) result = result.filter((u) => u.department === deptFilter);
    if (roleFilter) result = result.filter((u) => u.role === roleFilter);
    return result;
  }

  const filtered = filterUsers(users);
  const filteredInactive = filterUsers(inactiveUsers);

  const roleColors: Record<string, string> = {
    ADMIN: "bg-purple-100 text-purple-800",
    MANAGER: "bg-blue-100 text-blue-800",
    DEVELOPER: "bg-green-100 text-green-800",
    CONTRIBUTOR: "bg-yellow-100 text-yellow-800",
    VIEWER: "bg-gray-100 text-gray-800",
  };

  function renderUserRow(user: UserData, isInactive = false) {
    return (
      <>
        <tr key={user.id}
          className={`border-b border-border/50 hover:bg-muted/30 cursor-pointer ${isInactive ? "opacity-60" : ""}`}
          onClick={() => setExpandedId(expandedId === user.id ? null : user.id)}
        >
          <td className="py-3 px-4">
            <div className="flex items-center gap-3">
              <Avatar name={user.name} size="sm" />
              <div className="min-w-0">
                <p className="font-medium truncate">{user.name}</p>
                {user.jobTitle && (
                  <p className="text-xs text-primary/80 font-medium truncate">{user.jobTitle}</p>
                )}
                <p className="text-[10px] text-muted-foreground truncate">{user.email}</p>
              </div>
            </div>
          </td>
          <td className="py-3 px-4 text-muted-foreground hidden md:table-cell">{user.department || "—"}</td>
          <td className="py-3 px-4 text-muted-foreground hidden md:table-cell">
            {user.location ? (
              <span className="flex items-center gap-1">
                <MapPin className="h-3 w-3" />{user.location}
              </span>
            ) : "—"}
          </td>
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
    );
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-4 flex-wrap">
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
        <span className="text-sm text-muted-foreground ml-auto">
          {filtered.length} active{filteredInactive.length > 0 ? ` · ${filteredInactive.length} inactive` : ""}
        </span>
      </div>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="text-left py-3 px-4 font-semibold">Employee</th>
                <th className="text-left py-3 px-4 font-semibold hidden md:table-cell">Department</th>
                <th className="text-left py-3 px-4 font-semibold hidden md:table-cell">Location</th>
                <th className="text-left py-3 px-4 font-semibold hidden lg:table-cell">Reports To</th>
                <th className="text-center py-3 px-4 font-semibold">System Role</th>
                <th className="text-center py-3 px-4 font-semibold">Projects</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((user) => renderUserRow(user))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Inactive / Former Employees */}
      {inactiveUsers.length > 0 && (
        <div className="mt-6">
          <button
            onClick={() => setShowInactive(!showInactive)}
            className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors mb-2"
          >
            {showInactive ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            Former Employees ({filteredInactive.length})
          </button>
          {showInactive && (
            <Card className="opacity-75">
              <CardContent className="p-0">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/50">
                      <th className="text-left py-3 px-4 font-semibold">Employee</th>
                      <th className="text-left py-3 px-4 font-semibold hidden md:table-cell">Department</th>
                      <th className="text-left py-3 px-4 font-semibold hidden md:table-cell">Location</th>
                      <th className="text-left py-3 px-4 font-semibold hidden lg:table-cell">Reports To</th>
                      <th className="text-center py-3 px-4 font-semibold">System Role</th>
                      <th className="text-center py-3 px-4 font-semibold">Projects</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredInactive.map((user) => renderUserRow(user, true))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
