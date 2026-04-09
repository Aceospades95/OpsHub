"use client";

import React, { useState, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import {
  ChevronDown, ChevronRight, AlertTriangle, CheckCircle2,
  ArrowUpDown, Filter, BarChart3,
} from "lucide-react";
import Link from "next/link";
import {
  UserData, ProjectData, ClientData, ServiceOfferingData,
  MatrixDimension, DIMENSION_LABELS,
  getAllocationStatus, getAllocationBadge, computeEmployeeFte, formatFte,
} from "./team-types";

interface StaffingMatrixProps {
  users: UserData[];
  projects: ProjectData[];
  clients: ClientData[];
  serviceOfferings: ServiceOfferingData[];
  search: string;
}

interface ColumnDef {
  key: string;
  label: string;
  linkHref?: string;
}

interface MatrixCell {
  employeeId: string;
  columnKey: string;
  fte: number;
  assignmentIds: string[];
}

type SortField = "name" | "totalFte" | "role" | "manager" | "department";
type SortDir = "asc" | "desc";

export function StaffingMatrix({ users, projects, clients, serviceOfferings, search }: StaffingMatrixProps) {
  const [dimension, setDimension] = useState<MatrixDimension>("project");
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [filterValue, setFilterValue] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");

  const toggleExpand = (id: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  // Filter users by search
  const filteredUsers = useMemo(() => {
    let result = users;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter((u) =>
        u.name.toLowerCase().includes(q) ||
        u.jobTitle?.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q)
      );
    }
    if (statusFilter) {
      result = result.filter((u) => {
        const s = getAllocationStatus(computeEmployeeFte(u));
        return s === statusFilter;
      });
    }
    return result;
  }, [users, search, statusFilter]);

  // Sort users
  const sortedUsers = useMemo(() => {
    const arr = [...filteredUsers];
    arr.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "name": cmp = a.name.localeCompare(b.name); break;
        case "totalFte": cmp = computeEmployeeFte(a) - computeEmployeeFte(b); break;
        case "role": cmp = a.role.localeCompare(b.role); break;
        case "manager": cmp = (a.manager?.name || "").localeCompare(b.manager?.name || ""); break;
        case "department": cmp = (a.department || "").localeCompare(b.department || ""); break;
      }
      return sortDir === "desc" ? -cmp : cmp;
    });
    return arr;
  }, [filteredUsers, sortField, sortDir]);

  // Build dynamic columns based on dimension
  const columns: ColumnDef[] = useMemo(() => {
    const cols: ColumnDef[] = [];
    const seen = new Set<string>();
    const addCol = (key: string, label: string, href?: string) => {
      if (!seen.has(key)) { seen.add(key); cols.push({ key, label, linkHref: href }); }
    };

    if (dimension === "project") {
      for (const u of filteredUsers) {
        for (const a of u.assignments) {
          if (a.project) addCol(a.project.id, a.project.name, `/projects/${a.project.id}`);
        }
      }
      cols.sort((a, b) => a.label.localeCompare(b.label));
    } else if (dimension === "client") {
      for (const u of filteredUsers) {
        for (const a of u.assignments) {
          if (a.client) addCol(a.client.id, a.client.name, `/clients`);
        }
      }
      cols.sort((a, b) => a.label.localeCompare(b.label));
    } else if (dimension === "serviceOffering") {
      for (const u of filteredUsers) {
        for (const a of u.assignments) {
          if (a.serviceOffering) addCol(a.serviceOffering.id, a.serviceOffering.name);
        }
      }
      cols.sort((a, b) => a.label.localeCompare(b.label));
    } else if (dimension === "function") {
      for (const u of filteredUsers) {
        for (const a of u.assignments) {
          if (a.function) addCol(a.function, a.function);
        }
      }
      cols.sort((a, b) => a.label.localeCompare(b.label));
    } else if (dimension === "manager") {
      for (const u of filteredUsers) {
        if (u.manager) addCol(u.manager.id, u.manager.name);
      }
      cols.sort((a, b) => a.label.localeCompare(b.label));
    } else if (dimension === "role") {
      for (const u of filteredUsers) {
        addCol(u.role, u.role);
        for (const a of u.assignments) {
          if (a.role) addCol(a.role, a.role);
        }
      }
      cols.sort((a, b) => a.label.localeCompare(b.label));
    } else if (dimension === "location") {
      for (const u of filteredUsers) {
        if (u.location) addCol(u.location, u.location);
      }
      cols.sort((a, b) => a.label.localeCompare(b.label));
    } else if (dimension === "department") {
      for (const u of filteredUsers) {
        if (u.department) addCol(u.department, u.department);
      }
      cols.sort((a, b) => a.label.localeCompare(b.label));
    }

    // Apply column filter
    if (filterValue) {
      const q = filterValue.toLowerCase();
      return cols.filter((c) => c.label.toLowerCase().includes(q));
    }
    return cols;
  }, [dimension, filteredUsers, filterValue]);

  // Build cell map: employeeId+columnKey -> fte
  const cellMap = useMemo(() => {
    const map = new Map<string, MatrixCell>();
    const getCell = (empId: string, colKey: string): MatrixCell => {
      const k = `${empId}::${colKey}`;
      if (!map.has(k)) map.set(k, { employeeId: empId, columnKey: colKey, fte: 0, assignmentIds: [] });
      return map.get(k)!;
    };

    for (const u of filteredUsers) {
      if (dimension === "manager") {
        if (u.manager) {
          const cell = getCell(u.id, u.manager.id);
          cell.fte = computeEmployeeFte(u);
        }
      } else if (dimension === "location") {
        if (u.location) {
          const cell = getCell(u.id, u.location);
          cell.fte = computeEmployeeFte(u);
        }
      } else if (dimension === "department") {
        if (u.department) {
          const cell = getCell(u.id, u.department);
          cell.fte = computeEmployeeFte(u);
        }
      } else {
        for (const a of u.assignments) {
          let colKey: string | null = null;
          if (dimension === "project" && a.project) colKey = a.project.id;
          else if (dimension === "client" && a.client) colKey = a.client.id;
          else if (dimension === "serviceOffering" && a.serviceOffering) colKey = a.serviceOffering.id;
          else if (dimension === "function" && a.function) colKey = a.function;
          else if (dimension === "role") colKey = a.role || u.role;
          if (colKey) {
            const cell = getCell(u.id, colKey);
            cell.fte += a.allocationFte;
            cell.assignmentIds.push(a.id);
          }
        }
      }
    }
    return map;
  }, [filteredUsers, dimension]);

  // Column totals
  const columnTotals = useMemo(() => {
    const totals = new Map<string, number>();
    for (const col of columns) {
      let total = 0;
      for (const u of sortedUsers) {
        const cell = cellMap.get(`${u.id}::${col.key}`);
        if (cell) total += cell.fte;
      }
      totals.set(col.key, total);
    }
    return totals;
  }, [columns, sortedUsers, cellMap]);

  // Summary metrics
  const metrics = useMemo(() => {
    let totalAllocated = 0;
    let overCount = 0;
    let underCount = 0;
    let unassignedCount = 0;
    let fullyCount = 0;
    for (const u of filteredUsers) {
      const fte = computeEmployeeFte(u);
      totalAllocated += fte;
      const status = getAllocationStatus(fte);
      if (status === "overallocated") overCount++;
      else if (status === "fully-allocated") fullyCount++;
      else if (status === "underallocated") underCount++;
      else unassignedCount++;
    }
    return {
      headcount: filteredUsers.length,
      totalAllocated,
      totalCapacity: filteredUsers.length,
      availableCapacity: filteredUsers.length - totalAllocated,
      overCount,
      fullyCount,
      underCount,
      unassignedCount,
    };
  }, [filteredUsers]);

  const SortHeader = ({ field, children }: { field: SortField; children: React.ReactNode }) => (
    <button onClick={() => toggleSort(field)} className="flex items-center gap-1 font-semibold hover:text-primary transition-colors">
      {children}
      <ArrowUpDown className={`h-3 w-3 ${sortField === field ? "text-primary" : "text-muted-foreground/50"}`} />
    </button>
  );

  return (
    <div className="space-y-4">
      {/* Summary Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <MetricCard label="Headcount" value={metrics.headcount} />
        <MetricCard label="Total Allocated FTE" value={formatFte(metrics.totalAllocated)} />
        <MetricCard label="Available Capacity" value={formatFte(metrics.availableCapacity)} variant={metrics.availableCapacity < 0 ? "destructive" : "default"} />
        <MetricCard label="Overallocated" value={metrics.overCount} variant={metrics.overCount > 0 ? "destructive" : "default"} onClick={() => setStatusFilter(statusFilter === "overallocated" ? "" : "overallocated")} active={statusFilter === "overallocated"} />
        <MetricCard label="Fully Allocated" value={metrics.fullyCount} variant="success" onClick={() => setStatusFilter(statusFilter === "fully-allocated" ? "" : "fully-allocated")} active={statusFilter === "fully-allocated"} />
        <MetricCard label="Unassigned" value={metrics.unassignedCount} variant={metrics.unassignedCount > 0 ? "warning" : "default"} onClick={() => setStatusFilter(statusFilter === "unassigned" ? "" : "unassigned")} active={statusFilter === "unassigned"} />
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium text-muted-foreground">View by:</span>
          <select
            value={dimension}
            onChange={(e) => { setDimension(e.target.value as MatrixDimension); setFilterValue(""); }}
            className="px-3 py-1.5 text-sm border border-input rounded-md bg-background font-medium"
          >
            {(Object.keys(DIMENSION_LABELS) as MatrixDimension[]).map((d) => (
              <option key={d} value={d}>{DIMENSION_LABELS[d]}</option>
            ))}
          </select>
        </div>

        {columns.length > 5 && (
          <div className="relative">
            <Filter className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              value={filterValue}
              onChange={(e) => setFilterValue(e.target.value)}
              placeholder={`Filter ${DIMENSION_LABELS[dimension].toLowerCase()}s...`}
              className="pl-8 pr-3 py-1.5 text-sm border border-input rounded-md bg-background w-48"
            />
          </div>
        )}

        {statusFilter && (
          <button onClick={() => setStatusFilter("")} className="text-xs px-2 py-1 rounded-md bg-muted text-muted-foreground hover:bg-muted/80">
            Clear status filter
          </button>
        )}

        <span className="text-sm text-muted-foreground ml-auto">
          {sortedUsers.length} employees · {columns.length} {DIMENSION_LABELS[dimension].toLowerCase()}s
        </span>
      </div>

      {/* Matrix Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b-2 border-border bg-muted/50">
                  <th className="text-left py-3 px-4 font-semibold sticky left-0 bg-muted/50 z-10 min-w-[220px]">
                    <SortHeader field="name">Employee</SortHeader>
                  </th>
                  <th className="text-center py-3 px-2 font-semibold w-16">
                    <SortHeader field="totalFte">Total</SortHeader>
                  </th>
                  <th className="text-center py-3 px-2 font-semibold w-20">Status</th>
                  {columns.map((col) => (
                    <th key={col.key} className="text-center py-3 px-2 font-semibold min-w-[90px] max-w-[140px]">
                      <div className="truncate text-xs" title={col.label}>
                        {col.linkHref ? (
                          <Link href={col.linkHref} className="hover:text-primary hover:underline">{col.label}</Link>
                        ) : col.label}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedUsers.length === 0 && (
                  <tr>
                    <td colSpan={3 + columns.length} className="py-12 text-center text-muted-foreground">
                      No employees match the current filters.
                    </td>
                  </tr>
                )}
                {sortedUsers.map((user) => {
                  const totalFte = computeEmployeeFte(user);
                  const allocStatus = getAllocationStatus(totalFte);
                  const badge = getAllocationBadge(allocStatus);
                  const isExpanded = expandedRows.has(user.id);

                  return (
                    <React.Fragment key={user.id}>
                      <tr className={`border-b border-border/40 hover:bg-muted/20 transition-colors ${allocStatus === "overallocated" ? "bg-red-50/30" : ""}`}>
                        <td className="py-2.5 px-4 sticky left-0 bg-background z-10">
                          <div className="flex items-center gap-2.5">
                            <button onClick={() => toggleExpand(user.id)} className="text-muted-foreground hover:text-foreground shrink-0">
                              {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                            </button>
                            <Avatar name={user.name} size="xs" />
                            <div className="min-w-0">
                              <Link href={`/team/${user.id}`} className="font-medium hover:text-primary hover:underline text-sm truncate block">
                                {user.name}
                              </Link>
                              {user.jobTitle && (
                                <p className="text-[10px] text-muted-foreground truncate">{user.jobTitle}</p>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="py-2.5 px-2 text-center">
                          <span className={`font-bold text-sm ${allocStatus === "overallocated" ? "text-red-600" : ""}`}>
                            {formatFte(totalFte)}
                          </span>
                        </td>
                        <td className="py-2.5 px-2 text-center">
                          <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border font-medium ${badge.className}`}>
                            {allocStatus === "overallocated" && <AlertTriangle className="h-2.5 w-2.5" />}
                            {allocStatus === "fully-allocated" && <CheckCircle2 className="h-2.5 w-2.5" />}
                            {badge.label}
                          </span>
                        </td>
                        {columns.map((col) => {
                          const cell = cellMap.get(`${user.id}::${col.key}`);
                          const val = cell?.fte || 0;
                          return (
                            <td key={col.key} className="py-2.5 px-2 text-center">
                              {val > 0 ? (
                                <span className={`text-xs font-medium px-2 py-0.5 rounded ${val > 0.5 ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                                  {formatFte(val)}
                                </span>
                              ) : (
                                <span className="text-muted-foreground/30">—</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                      {/* Expanded assignment details */}
                      {isExpanded && (
                        <tr className="bg-muted/10 border-b border-border/20">
                          <td colSpan={3 + columns.length} className="py-3 px-8">
                            <EmployeeExpanded user={user} />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
              {/* Footer totals */}
              {sortedUsers.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-border bg-muted/30 font-semibold">
                    <td className="py-2.5 px-4 sticky left-0 bg-muted/30 z-10">Column Totals</td>
                    <td className="py-2.5 px-2 text-center font-bold">
                      {formatFte(sortedUsers.reduce((s, u) => s + computeEmployeeFte(u), 0))}
                    </td>
                    <td className="py-2.5 px-2" />
                    {columns.map((col) => (
                      <td key={col.key} className="py-2.5 px-2 text-center text-xs font-bold">
                        {formatFte(columnTotals.get(col.key) || 0)}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// Expanded row showing all assignments for an employee
function EmployeeExpanded({ user }: { user: UserData }) {
  if (user.assignments.length === 0) {
    return (
      <p className="text-xs text-muted-foreground italic">No assignments. This employee has no FTE allocations.</p>
    );
  }
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground mb-2">
        {user.assignments.length} assignment{user.assignments.length !== 1 ? "s" : ""} · Total: {formatFte(computeEmployeeFte(user))} FTE
      </p>
      <div className="grid gap-1.5">
        {user.assignments.map((a) => (
          <div key={a.id} className="flex items-center gap-3 text-xs bg-background rounded-md border border-border/60 px-3 py-1.5">
            <span className="font-medium min-w-[120px]">
              {a.project ? (
                <Link href={`/projects/${a.project.id}`} className="text-primary hover:underline">{a.project.name}</Link>
              ) : a.client ? (
                <span>{a.client.name}</span>
              ) : a.serviceOffering ? (
                <span>{a.serviceOffering.name}</span>
              ) : a.function ? (
                <span>{a.function}</span>
              ) : "General"}
            </span>
            {a.role && <Badge variant="outline" className="text-[9px]">{a.role}</Badge>}
            {a.function && <span className="text-muted-foreground">{a.function}</span>}
            <span className="ml-auto font-bold">{formatFte(a.allocationFte)} FTE</span>
            <Badge variant={a.status === "ACTIVE" ? "success" : "secondary"} className="text-[9px]">{a.status}</Badge>
          </div>
        ))}
      </div>
    </div>
  );
}

// Summary metric card
function MetricCard({ label, value, variant = "default", onClick, active }: {
  label: string;
  value: string | number;
  variant?: "default" | "success" | "warning" | "destructive";
  onClick?: () => void;
  active?: boolean;
}) {
  const colorMap = {
    default: "",
    success: "text-green-600",
    warning: "text-yellow-600",
    destructive: "text-red-600",
  };
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className={`text-left p-3 rounded-lg border transition-colors ${active ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border bg-card"} ${onClick ? "cursor-pointer hover:border-primary/50" : "cursor-default"}`}
    >
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{label}</p>
      <p className={`text-xl font-bold mt-0.5 ${colorMap[variant]}`}>{value}</p>
    </button>
  );
}
