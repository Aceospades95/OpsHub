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
        <OrgChartTree nodes={tree} />
      </CardContent>
    </Card>
  );
}

// ─── Staffing Matrix View ───────────────────────────

interface StaffingRow {
  department: string;
  manager: string;
  project: { id: string; name: string; status: string };
  location: string;
  role: string;
  employees: { id: string; name: string }[];
  fte: number;
}

const DEPT_COLORS = [
  "border-l-blue-500 bg-blue-500/5",
  "border-l-green-500 bg-green-500/5",
  "border-l-purple-500 bg-purple-500/5",
  "border-l-orange-500 bg-orange-500/5",
  "border-l-pink-500 bg-pink-500/5",
  "border-l-cyan-500 bg-cyan-500/5",
  "border-l-yellow-500 bg-yellow-500/5",
];

function StaffingMatrix({ users, projects, search }: { users: UserData[]; projects: ProjectData[]; search: string }) {
  const [statusFilter, setStatusFilter] = useState<string>("ACTIVE");

  // Build rows: group by department → project → role
  const rows = useMemo(() => {
    const result: StaffingRow[] = [];
    const projectMap = new Map(projects.map((p) => [p.id, p]));

    // Group users by their project assignments
    const projRoleMap = new Map<string, { project: ProjectData; role: string; employees: UserData[] }>();

    for (const user of users) {
      if (search) {
        const q = search.toLowerCase();
        if (!user.name.toLowerCase().includes(q)) continue;
      }
      for (const pm of user.projectMembers) {
        const proj = projectMap.get(pm.project.id);
        if (!proj) continue;
        if (statusFilter && !statusFilter.split(",").includes(proj.status)) continue;

        const key = `${pm.project.id}::${pm.role}`;
        if (!projRoleMap.has(key)) {
          projRoleMap.set(key, { project: proj, role: pm.role, employees: [] });
        }
        projRoleMap.get(key)!.employees.push(user);
      }
    }

    for (const entry of Array.from(projRoleMap.values())) {
      // Find a manager among the employees or use the first one's manager
      const managerUser = entry.employees.find((u) => u.role === "MANAGER" || u.role === "ADMIN");
      const firstUser = entry.employees[0];
      const dept = firstUser?.department || "Unassigned";
      const manager = managerUser?.name || firstUser?.manager?.name || "—";
      const location = firstUser?.location || "—";

      result.push({
        department: dept,
        manager,
        project: entry.project,
        location,
        role: entry.role,
        employees: entry.employees.map((emp) => ({ id: emp.id, name: emp.name })),
        fte: entry.employees.length,
      });
    }

    // Sort by department, then project name
    result.sort((a, b) => a.department.localeCompare(b.department) || a.project.name.localeCompare(b.project.name));
    return result;
  }, [users, projects, search, statusFilter]);

  // Group rows by department for colored sections
  const departments = useMemo(() => {
    const depts = new Map<string, StaffingRow[]>();
    for (const row of rows) {
      if (!depts.has(row.department)) depts.set(row.department, []);
      depts.get(row.department)!.push(row);
    }
    return depts;
  }, [rows]);

  const totalFte = rows.reduce((sum, r) => sum + r.fte, 0);

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 text-sm border border-input rounded-md bg-background">
          <option value="ACTIVE">Active Projects</option>
          <option value="PLANNING,ON_HOLD">Planning / On Hold</option>
          <option value="ACTIVE,PLANNING,ON_HOLD">All Open</option>
          <option value="COMPLETED">Completed</option>
          <option value="">All Statuses</option>
        </select>
        <span className="text-sm text-muted-foreground ml-auto">
          {rows.length} assignments · {totalFte} FTE
        </span>
      </div>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b-2 border-border bg-muted/50">
                <th className="text-left py-3 px-4 font-semibold">Department</th>
                <th className="text-left py-3 px-3 font-semibold">Manager</th>
                <th className="text-left py-3 px-3 font-semibold">Project</th>
                <th className="text-left py-3 px-3 font-semibold hidden md:table-cell">Location</th>
                <th className="text-left py-3 px-3 font-semibold">Role</th>
                <th className="text-center py-3 px-3 font-semibold w-16">FTE</th>
                <th className="text-left py-3 px-3 font-semibold">Employee(s)</th>
              </tr>
            </thead>
            <tbody>
              {Array.from(departments.entries()).map(([dept, deptRows], deptIdx) => {
                const colorClass = DEPT_COLORS[deptIdx % DEPT_COLORS.length];
                return deptRows.map((row, rowIdx) => (
                  <tr key={`${dept}-${row.project.id}-${row.role}`}
                    className={`border-b border-border/40 border-l-4 ${colorClass}`}
                  >
                    {/* Department — only show on first row of each group */}
                    <td className="py-2.5 px-4 font-medium">
                      {rowIdx === 0 ? dept : ""}
                    </td>
                    <td className="py-2.5 px-3 text-muted-foreground">{row.manager}</td>
                    <td className="py-2.5 px-3">
                      <a href={`/projects/${row.project.id}`} className="hover:underline hover:text-primary font-medium">
                        {row.project.name}
                      </a>
                    </td>
                    <td className="py-2.5 px-3 text-muted-foreground hidden md:table-cell">
                      {row.location !== "—" && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{row.location}</span>}
                      {row.location === "—" && "—"}
                    </td>
                    <td className="py-2.5 px-3">
                      <Badge variant="outline" className="text-[10px]">{row.role}</Badge>
                    </td>
                    <td className="py-2.5 px-3 text-center font-semibold">
                      {row.fte.toFixed(row.fte % 1 ? 2 : 0)}
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="text-xs space-y-0.5">
                        {row.employees.map((e) => (
                          <div key={e.id}>{e.name}</div>
                        ))}
                      </div>
                    </td>
                  </tr>
                ));
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border bg-muted/30">
                <td colSpan={5} className="py-2.5 px-4 font-semibold text-right">Total FTE</td>
                <td className="py-2.5 px-3 text-center font-bold">{totalFte}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </CardContent>
      </Card>
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
