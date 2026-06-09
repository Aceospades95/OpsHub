"use client";

import React, { useState, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import {
  ChevronDown, ChevronRight, MapPin, ArrowUpDown, Briefcase,
} from "lucide-react";
import Link from "next/link";
import {
  UserData,
  getAllocationStatus, getAllocationBadge, computeEmployeeFte, formatFte,
} from "./team-types";
import { isSyntheticEmail } from "@/lib/synthetic-email";

interface EmployeeListProps {
  users: UserData[];
  inactiveUsers: UserData[];
  search: string;
}

type SortField = "name" | "department" | "location" | "manager" | "role" | "totalFte" | "projects";
type SortDir = "asc" | "desc";

export function EmployeeList({ users, inactiveUsers, search }: EmployeeListProps) {
  const [deptFilter, setDeptFilter] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const [managerFilter, setManagerFilter] = useState("");
  const [allocationFilter, setAllocationFilter] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const toggleSort = (field: SortField) => {
    if (sortField === field) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDir("asc"); }
  };

  // Extract filter options from data
  const filterOptions = useMemo(() => {
    const allUsers = [...users, ...inactiveUsers];
    const depts = new Set(allUsers.map((u) => u.department).filter(Boolean) as string[]);
    const locs = new Set(allUsers.map((u) => u.location).filter(Boolean) as string[]);
    const mgrs = new Set(allUsers.map((u) => u.manager?.name).filter(Boolean) as string[]);
    return {
      departments: Array.from(depts).sort(),
      locations: Array.from(locs).sort(),
      managers: Array.from(mgrs).sort(),
    };
  }, [users, inactiveUsers]);

  function filterAndSort(list: UserData[]) {
    let result = list;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter((u) =>
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.jobTitle?.toLowerCase().includes(q)
      );
    }
    if (deptFilter) result = result.filter((u) => u.department === deptFilter);
    if (roleFilter) result = result.filter((u) => u.role === roleFilter);
    if (locationFilter) result = result.filter((u) => u.location === locationFilter);
    if (managerFilter) result = result.filter((u) => u.manager?.name === managerFilter);
    if (allocationFilter) {
      result = result.filter((u) => getAllocationStatus(computeEmployeeFte(u)) === allocationFilter);
    }

    // Sort
    result = [...result].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "name": cmp = a.name.localeCompare(b.name); break;
        case "department": cmp = (a.department || "").localeCompare(b.department || ""); break;
        case "location": cmp = (a.location || "").localeCompare(b.location || ""); break;
        case "manager": cmp = (a.manager?.name || "").localeCompare(b.manager?.name || ""); break;
        case "role": cmp = (a.jobTitle || "").localeCompare(b.jobTitle || ""); break;
        case "totalFte": cmp = computeEmployeeFte(a) - computeEmployeeFte(b); break;
        case "projects": cmp = a.assignments.length - b.assignments.length; break;
      }
      return sortDir === "desc" ? -cmp : cmp;
    });
    return result;
  }

  const filtered = filterAndSort(users);
  const filteredInactive = filterAndSort(inactiveUsers);

  // Summary stats
  const stats = useMemo(() => {
    let over = 0, full = 0, under = 0, unassigned = 0;
    for (const u of users) {
      const s = getAllocationStatus(computeEmployeeFte(u));
      if (s === "overallocated") over++;
      else if (s === "fully-allocated") full++;
      else if (s === "underallocated") under++;
      else unassigned++;
    }
    return { total: users.length, over, full, under, unassigned };
  }, [users]);

  const hasFilters = deptFilter || roleFilter || locationFilter || managerFilter || allocationFilter;

  const SortHeader = ({ field, children, className = "" }: { field: SortField; children: React.ReactNode; className?: string }) => (
    <button onClick={() => toggleSort(field)} className={`flex items-center gap-1 font-semibold hover:text-primary transition-colors ${className}`}>
      {children}
      <ArrowUpDown className={`h-3 w-3 ${sortField === field ? "text-primary" : "text-muted-foreground/50"}`} />
    </button>
  );

  function renderUserRow(user: UserData, isInactive = false) {
    const totalFte = computeEmployeeFte(user);
    const allocStatus = getAllocationStatus(totalFte);
    const badge = getAllocationBadge(allocStatus);
    const isExpanded = expandedId === user.id;

    return (
      <React.Fragment key={user.id}>
        <tr
          className={`border-b border-border/50 hover:bg-muted/30 transition-colors ${isInactive ? "opacity-60" : ""} ${allocStatus === "overallocated" ? "bg-destructive/5" : ""}`}
        >
          <td className="py-3 px-4">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setExpandedId(isExpanded ? null : user.id)}
                aria-expanded={isExpanded}
                aria-label={`${isExpanded ? "Collapse" : "Expand"} details for ${user.name}`}
                className="text-muted-foreground hover:text-foreground shrink-0"
              >
                {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              </button>
              <Avatar name={user.name} size="sm" />
              <div className="min-w-0">
                <Link href={`/team/${user.id}`} className="font-medium truncate block hover:text-primary hover:underline">
                  {user.name}
                </Link>
                {user.jobTitle && (
                  <p className="text-xs text-primary/80 font-medium truncate">{user.jobTitle}</p>
                )}
                {isSyntheticEmail(user.email) ? (
                  <p
                    className="text-[10px] text-muted-foreground truncate flex items-center gap-1"
                    title="Placeholder email assigned by the system because this employee was created without login access."
                  >
                    <span className="rounded-sm bg-muted px-1 py-px text-[9px] font-medium uppercase tracking-wide text-muted-foreground/80">
                      placeholder
                    </span>
                    <span className="truncate">{user.email}</span>
                  </p>
                ) : (
                  <p className="text-[10px] text-muted-foreground truncate">{user.email}</p>
                )}
              </div>
            </div>
          </td>
          <td className="py-3 px-4 text-muted-foreground hidden md:table-cell">{user.department || "—"}</td>
          <td className="py-3 px-4 text-muted-foreground hidden md:table-cell">
            {user.location ? (
              <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{user.location}</span>
            ) : "—"}
          </td>
          <td className="py-3 px-4 text-muted-foreground hidden lg:table-cell">
            {user.manager ? (
              <Link href={`/team/${user.manager.id}`} className="hover:text-primary hover:underline">{user.manager.name}</Link>
            ) : "—"}
          </td>
          <td className="py-3 px-4 text-center">
            <span className="text-xs text-muted-foreground">
              {user.jobTitle || "—"}
            </span>
          </td>
          <td className="py-3 px-4 text-center">
            <div className="flex flex-col items-center gap-0.5">
              <span className={`font-bold text-sm ${allocStatus === "overallocated" ? "text-destructive" : ""}`}>
                {formatFte(totalFte)}
              </span>
              <span className={`inline-flex text-[9px] px-1.5 py-0 rounded-full border font-medium ${badge.className}`}>
                {badge.label}
              </span>
            </div>
          </td>
          <td className="py-3 px-4 text-center hidden lg:table-cell">
            <div className="flex items-center justify-center gap-1">
              <Briefcase className="h-3 w-3 text-muted-foreground" />
              <span className="font-medium">{user.assignments.length}</span>
            </div>
          </td>
        </tr>
        {/* Expanded detail */}
        {isExpanded && (
          <tr className="bg-muted/15 border-b border-border/30">
            <td colSpan={7} className="py-3 px-8">
              <EmployeeExpandedDetail user={user} />
            </td>
          </tr>
        )}
      </React.Fragment>
    );
  }

  return (
    <div className="space-y-4">
      {/* Quick stats bar */}
      <div className="flex items-center gap-4 text-sm flex-wrap">
        <span className="font-medium">{stats.total} employees</span>
        <span className="text-muted-foreground">·</span>
        <span className="text-success">{stats.full} fully allocated</span>
        <span className="text-warning">{stats.under} available</span>
        {stats.over > 0 && <span className="text-destructive">{stats.over} overallocated</span>}
        {stats.unassigned > 0 && <span className="text-muted-foreground">{stats.unassigned} unassigned</span>}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        {filterOptions.departments.length > 0 && (
          <select value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)}
            className="px-3 py-1.5 text-sm border border-input rounded-md bg-background">
            <option value="">All Departments</option>
            {filterOptions.departments.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        )}
        <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}
          className="px-3 py-1.5 text-sm border border-input rounded-md bg-background">
          <option value="">All Roles</option>
          {["ADMIN", "MANAGER", "DEVELOPER", "CONTRIBUTOR", "VIEWER"].map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
        {filterOptions.locations.length > 0 && (
          <select value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)}
            className="px-3 py-1.5 text-sm border border-input rounded-md bg-background">
            <option value="">All Locations</option>
            {filterOptions.locations.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        )}
        {filterOptions.managers.length > 0 && (
          <select value={managerFilter} onChange={(e) => setManagerFilter(e.target.value)}
            className="px-3 py-1.5 text-sm border border-input rounded-md bg-background">
            <option value="">All Managers</option>
            {filterOptions.managers.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        )}
        <select value={allocationFilter} onChange={(e) => setAllocationFilter(e.target.value)}
          className="px-3 py-1.5 text-sm border border-input rounded-md bg-background">
          <option value="">All Allocations</option>
          <option value="overallocated">Overallocated</option>
          <option value="fully-allocated">Fully Allocated</option>
          <option value="underallocated">Available</option>
          <option value="unassigned">Unassigned</option>
        </select>

        {hasFilters && (
          <button onClick={() => { setDeptFilter(""); setRoleFilter(""); setLocationFilter(""); setManagerFilter(""); setAllocationFilter(""); }}
            className="text-xs px-2.5 py-1.5 rounded-md bg-muted text-muted-foreground hover:bg-muted/80">
            Clear filters
          </button>
        )}

        <span className="text-sm text-muted-foreground ml-auto">
          {filtered.length} active{filteredInactive.length > 0 ? ` · ${filteredInactive.length} inactive` : ""}
        </span>
      </div>

      {/* Employee Table */}
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted">
                <th className="text-left py-3 px-4 font-semibold whitespace-nowrap"><SortHeader field="name">Employee</SortHeader></th>
                <th className="text-left py-3 px-4 font-semibold whitespace-nowrap hidden md:table-cell"><SortHeader field="department">Department</SortHeader></th>
                <th className="text-left py-3 px-4 font-semibold whitespace-nowrap hidden md:table-cell"><SortHeader field="location">Location</SortHeader></th>
                <th className="text-left py-3 px-4 font-semibold whitespace-nowrap hidden lg:table-cell"><SortHeader field="manager">Reports To</SortHeader></th>
                <th className="text-center py-3 px-4 font-semibold whitespace-nowrap"><SortHeader field="role" className="justify-center">Position</SortHeader></th>
                <th className="text-center py-3 px-4 font-semibold whitespace-nowrap"><SortHeader field="totalFte" className="justify-center">FTE</SortHeader></th>
                <th className="text-center py-3 px-4 font-semibold whitespace-nowrap hidden lg:table-cell"><SortHeader field="projects" className="justify-center">Assignments</SortHeader></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={7} className="py-12 text-center text-muted-foreground">No employees match the current filters.</td></tr>
              )}
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
              <CardContent className="p-0 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted">
                      <th className="text-left py-3 px-4 font-semibold whitespace-nowrap">Employee</th>
                      <th className="text-left py-3 px-4 font-semibold whitespace-nowrap hidden md:table-cell">Department</th>
                      <th className="text-left py-3 px-4 font-semibold whitespace-nowrap hidden md:table-cell">Location</th>
                      <th className="text-left py-3 px-4 font-semibold whitespace-nowrap hidden lg:table-cell">Reports To</th>
                      <th className="text-center py-3 px-4 font-semibold whitespace-nowrap">Position</th>
                      <th className="text-center py-3 px-4 font-semibold whitespace-nowrap">FTE</th>
                      <th className="text-center py-3 px-4 font-semibold whitespace-nowrap hidden lg:table-cell">Assignments</th>
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

function EmployeeExpandedDetail({ user }: { user: UserData }) {
  const totalFte = computeEmployeeFte(user);
  const remaining = 1.0 - totalFte;

  return (
    <div className="space-y-3">
      {/* Quick info row */}
      <div className="flex items-center gap-6 text-xs text-muted-foreground flex-wrap">
        {user.department && <span>Department: <span className="text-foreground font-medium">{user.department}</span></span>}
        {user.manager && <span>Manager: <Link href={`/team/${user.manager.id}`} className="text-primary hover:underline">{user.manager.name}</Link></span>}
        {user.directReports.length > 0 && <span>Direct Reports: <span className="text-foreground font-medium">{user.directReports.length}</span></span>}
        <span>Total FTE: <span className={`font-bold ${totalFte > 1 ? "text-destructive" : "text-foreground"}`}>{formatFte(totalFte)}</span></span>
        <span>Remaining: <span className={`font-bold ${remaining < 0 ? "text-destructive" : remaining > 0 ? "text-success" : "text-foreground"}`}>{formatFte(remaining)}</span></span>
      </div>

      {/* Assignments */}
      {user.assignments.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">No active assignments.</p>
      ) : (
        <div className="grid gap-1.5">
          {user.assignments.map((a) => (
            <div key={a.id} className="flex items-center gap-3 text-xs bg-background rounded-md border border-border/60 px-3 py-1.5">
              <span className="font-medium min-w-[100px]">
                {a.project ? (
                  <Link href={`/projects/${a.project.id}`} className="text-primary hover:underline">{a.project.name}</Link>
                ) : a.client ? (
                  <span>{a.client.name}</span>
                ) : a.serviceOffering ? (
                  <span>{a.serviceOffering.name}</span>
                ) : a.function || "General"}
              </span>
              {a.role && <Badge variant="outline" className="text-[9px]">{a.role}</Badge>}
              {a.serviceOffering && <span className="text-muted-foreground">{a.serviceOffering.name}</span>}
              {a.function && <span className="text-muted-foreground">{a.function}</span>}
              <span className="ml-auto font-bold">{formatFte(a.allocationFte)} FTE</span>
              <Badge variant={a.status === "ACTIVE" ? "success" : "secondary"} className="text-[9px]">{a.status}</Badge>
            </div>
          ))}
        </div>
      )}

      {/* Capacity bar */}
      <div className="mt-2">
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground mb-1">
          <span>Capacity Usage</span>
          <span className="ml-auto">{formatFte(totalFte)} / 1.0 FTE</span>
        </div>
        <div className="h-2 bg-muted rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${totalFte > 1 ? "bg-destructive" : totalFte >= 0.95 ? "bg-success" : totalFte > 0 ? "bg-warning" : "bg-muted-foreground/30"}`}
            style={{ width: `${Math.min(totalFte * 100, 100)}%` }}
          />
        </div>
        {totalFte > 1 && (
          <p className="text-[10px] text-destructive mt-0.5">Overallocated by {formatFte(totalFte - 1)} FTE</p>
        )}
      </div>
    </div>
  );
}
