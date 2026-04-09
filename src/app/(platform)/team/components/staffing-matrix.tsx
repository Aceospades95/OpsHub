"use client";

import React, { useState, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ChevronDown, ChevronRight, ArrowUpDown, Plus, MapPin, X,
} from "lucide-react";
import Link from "next/link";
import {
  UserData, ProjectData, ClientData, ServiceOfferingData,
  AllocationStatus, getAllocationStatus, computeEmployeeFte, formatFte,
} from "./team-types";
import { AddAssignmentDialog } from "./add-assignment-dialog";
import { ManageOfferingsDialog } from "./manage-offerings-dialog";

interface StaffingMatrixProps {
  users: UserData[];
  projects: ProjectData[];
  clients: ClientData[];
  serviceOfferings: ServiceOfferingData[];
  search: string;
  canManage: boolean;
}

// One row per assignment line
interface MatrixRow {
  key: string;
  offering: string;
  offeringId: string | null;
  managerName: string;
  managerId: string | null;
  clientName: string;
  clientId: string | null;
  projectName: string;
  projectId: string | null;
  location: string;
  roleRequired: string;
  fte: number;
  employees: { id: string; name: string; jobTitle: string | null }[];
  notes: string;
  assignmentIds: string[];
  source: "assignment" | "project-member" | "unassigned";
}

// 3-level hierarchy: Offering → Client → rows
interface ClientGroup {
  clientName: string;
  clientId: string | null;
  rows: MatrixRow[];
  totalFte: number;
}

interface OfferingGroup {
  offering: string;
  clients: ClientGroup[];
  totalFte: number;
  employeeCount: number;
  hasProjectMembers: boolean;
}

// Color system for offering groups — parent color with shade variations
const OFFERING_COLORS = [
  { name: "emerald", border: "border-l-emerald-500", offeringBg: "bg-emerald-500/10", clientBg: "bg-emerald-500/5", rowBg: "hover:bg-emerald-500/[0.03]" },
  { name: "blue",    border: "border-l-blue-500",    offeringBg: "bg-blue-500/10",    clientBg: "bg-blue-500/5",    rowBg: "hover:bg-blue-500/[0.03]" },
  { name: "amber",   border: "border-l-amber-500",   offeringBg: "bg-amber-500/10",   clientBg: "bg-amber-500/5",   rowBg: "hover:bg-amber-500/[0.03]" },
  { name: "purple",  border: "border-l-purple-500",  offeringBg: "bg-purple-500/10",  clientBg: "bg-purple-500/5",  rowBg: "hover:bg-purple-500/[0.03]" },
  { name: "rose",    border: "border-l-rose-500",    offeringBg: "bg-rose-500/10",    clientBg: "bg-rose-500/5",    rowBg: "hover:bg-rose-500/[0.03]" },
  { name: "cyan",    border: "border-l-cyan-500",    offeringBg: "bg-cyan-500/10",    clientBg: "bg-cyan-500/5",    rowBg: "hover:bg-cyan-500/[0.03]" },
  { name: "orange",  border: "border-l-orange-500",  offeringBg: "bg-orange-500/10",  clientBg: "bg-orange-500/5",  rowBg: "hover:bg-orange-500/[0.03]" },
  { name: "pink",    border: "border-l-pink-500",    offeringBg: "bg-pink-500/10",    clientBg: "bg-pink-500/5",    rowBg: "hover:bg-pink-500/[0.03]" },
  { name: "teal",    border: "border-l-teal-500",    offeringBg: "bg-teal-500/10",    clientBg: "bg-teal-500/5",    rowBg: "hover:bg-teal-500/[0.03]" },
  { name: "indigo",  border: "border-l-indigo-500",  offeringBg: "bg-indigo-500/10",  clientBg: "bg-indigo-500/5",  rowBg: "hover:bg-indigo-500/[0.03]" },
];

type SortField = "offering" | "manager" | "client" | "project" | "fte";
type SortDir = "asc" | "desc";
type CapacityFilter = AllocationStatus | null;

export function StaffingMatrix({ users, projects, clients, serviceOfferings, search, canManage }: StaffingMatrixProps) {
  const [expandedOfferings, setExpandedOfferings] = useState<Set<string>>(new Set(["__all__"]));
  const [expandedClients, setExpandedClients] = useState<Set<string>>(new Set(["__all__"]));
  const [offeringFilter, setOfferingFilter] = useState("");
  const [clientFilter, setClientFilter] = useState("");
  const [managerFilter, setManagerFilter] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const [capacityFilter, setCapacityFilter] = useState<CapacityFilter>(null);
  const [sortField, setSortField] = useState<SortField>("offering");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [addDialogKey, setAddDialogKey] = useState(0);
  const [offeringsDialogOpen, setOfferingsDialogOpen] = useState(false);
  const [fteHighlight, setFteHighlight] = useState<string | null>(null);

  const toggleExpand = (set: Set<string>, key: string, setter: React.Dispatch<React.SetStateAction<Set<string>>>) => {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const toggleSort = (field: SortField) => {
    if (sortField === field) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDir("asc"); }
  };

  const openAddDialog = () => {
    setAddDialogKey((k) => k + 1);
    setAddDialogOpen(true);
  };

  // Compute per-user allocation status for capacity filtering
  const userAllocationMap = useMemo(() => {
    const map = new Map<string, AllocationStatus>();
    for (const u of users) {
      map.set(u.id, getAllocationStatus(computeEmployeeFte(u)));
    }
    return map;
  }, [users]);

  // Build rows from Assignments AND ProjectMembers
  const rows: MatrixRow[] = useMemo(() => {
    const rowMap = new Map<string, MatrixRow>();
    const assignmentProjectKeys = new Set<string>();

    for (const user of users) {
      // Search filter
      if (search) {
        const q = search.toLowerCase();
        const matchesUser = user.name.toLowerCase().includes(q) ||
          user.jobTitle?.toLowerCase().includes(q) ||
          user.email.toLowerCase().includes(q);
        const matchesAssignment = user.assignments.some((a) =>
          a.project?.name.toLowerCase().includes(q) ||
          a.client?.name.toLowerCase().includes(q) ||
          a.serviceOffering?.name.toLowerCase().includes(q) ||
          a.role?.toLowerCase().includes(q) ||
          a.function?.toLowerCase().includes(q)
        );
        const matchesProject = user.projectMembers.some((pm) =>
          pm.project.name.toLowerCase().includes(q)
        );
        if (!matchesUser && !matchesAssignment && !matchesProject) continue;
      }

      // 1) Rows from explicit Assignments
      for (const assignment of user.assignments) {
        const offeringName = assignment.serviceOffering?.name || assignment.function || "Unassigned";
        const offeringId = assignment.serviceOffering?.id || null;
        const clientName = assignment.client?.name || "";
        const clientId = assignment.client?.id || null;
        const projectName = assignment.project?.name || "";
        const projectId = assignment.project?.id || null;
        // Functional role from the assignment — NOT the system role
        const role = assignment.role || "";

        if (projectId) assignmentProjectKeys.add(`${user.id}::${projectId}`);

        const managerName = user.manager?.name || "";
        const key = `${offeringName}::${managerName}::${clientName}::${projectName}::${role}`;

        if (!rowMap.has(key)) {
          rowMap.set(key, {
            key, offering: offeringName, offeringId, managerName,
            managerId: user.managerId, clientName, clientId, projectName, projectId,
            location: user.location || "", roleRequired: role, fte: 0,
            employees: [], notes: assignment.notes || "", assignmentIds: [],
            source: "assignment",
          });
        }

        const row = rowMap.get(key)!;
        row.fte += assignment.allocationFte;
        row.assignmentIds.push(assignment.id);
        if (!row.employees.find((e) => e.id === user.id)) {
          row.employees.push({ id: user.id, name: user.name, jobTitle: user.jobTitle });
        }
        if (!row.location && user.location) row.location = user.location;
        if (assignment.notes && !row.notes) row.notes = assignment.notes;
      }

      // 2) Rows from ProjectMembers without a matching Assignment
      for (const pm of user.projectMembers) {
        if (assignmentProjectKeys.has(`${user.id}::${pm.project.id}`)) continue;

        const projectName = pm.project.name;
        const projectId = pm.project.id;
        const projectStatus = pm.project.status;
        const clientId = pm.project.clientId || null;
        const clientName = clientId ? (clients.find((c) => c.id === clientId)?.name || "") : "";
        const managerName = user.manager?.name || "";
        // Do NOT use pm.role — that's the system permission role (ADMIN/CONTRIBUTOR/etc.)
        // Leave roleRequired empty for project-member rows
        const offeringName = "Project Staffing";
        const key = `pm::${managerName}::${clientName}::${projectName}::${user.id}`;

        if (!rowMap.has(key)) {
          rowMap.set(key, {
            key, offering: offeringName, offeringId: null, managerName,
            managerId: user.managerId, clientName, clientId, projectName, projectId,
            location: user.location || "", roleRequired: "", fte: 0,
            employees: [], notes: `From project membership (${projectStatus})`,
            assignmentIds: [], source: "project-member",
          });
        }

        const row = rowMap.get(key)!;
        if (!row.employees.find((e) => e.id === user.id)) {
          row.employees.push({ id: user.id, name: user.name, jobTitle: user.jobTitle });
        }
      }

      // 3) Unassigned employees (no assignments AND no project memberships)
      if (user.assignments.length === 0 && user.projectMembers.length === 0) {
        const key = `Unassigned::::::::${user.id}`;
        rowMap.set(key, {
          key, offering: "Unassigned", offeringId: null,
          managerName: user.manager?.name || "", managerId: user.managerId,
          clientName: "", clientId: null, projectName: "", projectId: null,
          location: user.location || "",
          // Don't use user.role (system role) — leave blank for unassigned
          roleRequired: "",
          fte: 0, employees: [{ id: user.id, name: user.name, jobTitle: user.jobTitle }],
          notes: "", assignmentIds: [], source: "unassigned",
        });
      }
    }

    return Array.from(rowMap.values());
  }, [users, clients, search]);

  // Apply filters (including capacity filter)
  const filteredRows = useMemo(() => {
    let result = rows;
    if (offeringFilter) result = result.filter((r) => r.offering === offeringFilter);
    if (clientFilter) result = result.filter((r) => r.clientName === clientFilter);
    if (managerFilter) result = result.filter((r) => r.managerName === managerFilter);
    if (locationFilter) result = result.filter((r) => r.location === locationFilter);

    // Capacity filter: show only rows whose employees match the selected allocation status
    if (capacityFilter) {
      const matchingUserIds = new Set(
        users.filter((u) => userAllocationMap.get(u.id) === capacityFilter).map((u) => u.id)
      );
      result = result.filter((r) => r.employees.some((e) => matchingUserIds.has(e.id)));
    }

    // Sort
    result = [...result].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "offering": cmp = a.offering.localeCompare(b.offering) || a.clientName.localeCompare(b.clientName) || a.projectName.localeCompare(b.projectName); break;
        case "manager": cmp = a.managerName.localeCompare(b.managerName); break;
        case "client": cmp = a.clientName.localeCompare(b.clientName) || a.projectName.localeCompare(b.projectName); break;
        case "project": cmp = a.projectName.localeCompare(b.projectName); break;
        case "fte": cmp = a.fte - b.fte; break;
      }
      return sortDir === "desc" ? -cmp : cmp;
    });
    return result;
  }, [rows, offeringFilter, clientFilter, managerFilter, locationFilter, capacityFilter, users, userAllocationMap, sortField, sortDir]);

  // Build 3-level hierarchy: Offering → Client → Rows
  const offeringGroups: OfferingGroup[] = useMemo(() => {
    const offeringMap = new Map<string, Map<string, MatrixRow[]>>();

    for (const row of filteredRows) {
      if (!offeringMap.has(row.offering)) offeringMap.set(row.offering, new Map());
      const clientMap = offeringMap.get(row.offering)!;
      const clientKey = row.clientName || "(No Client)";
      if (!clientMap.has(clientKey)) clientMap.set(clientKey, []);
      clientMap.get(clientKey)!.push(row);
    }

    const groups: OfferingGroup[] = [];
    Array.from(offeringMap.entries()).forEach(([offering, clientMap]) => {
      const clientGroups: ClientGroup[] = [];
      let totalFte = 0;
      const allEmployeeIds = new Set<string>();
      let hasProjectMembers = false;

      Array.from(clientMap.entries()).forEach(([clientName, clientRows]) => {
        const clientFte = clientRows.reduce((s, r) => s + r.fte, 0);
        const firstRow = clientRows[0];
        clientGroups.push({
          clientName: clientName === "(No Client)" ? "" : clientName,
          clientId: firstRow?.clientId || null,
          rows: clientRows,
          totalFte: clientFte,
        });
        totalFte += clientFte;
        clientRows.forEach((r) => {
          r.employees.forEach((e) => allEmployeeIds.add(e.id));
          if (r.source === "project-member") hasProjectMembers = true;
        });
      });

      // Sort client groups by name
      clientGroups.sort((a, b) => (a.clientName || "zzz").localeCompare(b.clientName || "zzz"));

      groups.push({
        offering,
        clients: clientGroups,
        totalFte,
        employeeCount: allEmployeeIds.size,
        hasProjectMembers,
      });
    });
    return groups;
  }, [filteredRows]);

  // Filter options
  const filterOptions = useMemo(() => {
    const offerings = new Set(rows.map((r) => r.offering));
    const clientNames = new Set(rows.map((r) => r.clientName).filter(Boolean));
    const managers = new Set(rows.map((r) => r.managerName).filter(Boolean));
    const locations = new Set(rows.map((r) => r.location).filter(Boolean));
    return {
      offerings: Array.from(offerings).sort(),
      clients: Array.from(clientNames).sort(),
      managers: Array.from(managers).sort(),
      locations: Array.from(locations).sort(),
    };
  }, [rows]);

  // Summary metrics (always computed from full user list, not filtered rows)
  const metrics = useMemo(() => {
    const totalFte = filteredRows.reduce((s, r) => s + r.fte, 0);
    let overCount = 0, fullyCount = 0, underCount = 0, unassignedCount = 0;
    for (const u of users) {
      const s = getAllocationStatus(computeEmployeeFte(u));
      if (s === "overallocated") overCount++;
      else if (s === "fully-allocated") fullyCount++;
      else if (s === "underallocated") underCount++;
      else unassignedCount++;
    }
    return {
      totalFte,
      assignmentRows: filteredRows.length,
      headcount: users.length,
      overCount, fullyCount, underCount, unassignedCount,
    };
  }, [filteredRows, users]);

  const hasFilters = offeringFilter || clientFilter || managerFilter || locationFilter || capacityFilter;

  const clearAllFilters = () => {
    setOfferingFilter("");
    setClientFilter("");
    setManagerFilter("");
    setLocationFilter("");
    setCapacityFilter(null);
  };

  const SortHeader = ({ field, children, className = "" }: { field: SortField; children: React.ReactNode; className?: string }) => (
    <button onClick={() => toggleSort(field)} className={`flex items-center gap-1 font-semibold hover:text-primary transition-colors ${className}`}>
      {children}
      <ArrowUpDown className={`h-3 w-3 ${sortField === field ? "text-primary" : "text-muted-foreground/50"}`} />
    </button>
  );

  return (
    <div className="space-y-4">
      {/* Summary Metrics — clickable as filters */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        <MetricCard label="Headcount" value={metrics.headcount}
          active={capacityFilter === null && !hasFilters} onClick={() => setCapacityFilter(null)} />
        <MetricCard label="Total FTE" value={formatFte(metrics.totalFte)}
          active={false} onClick={() => { toggleSort("fte"); }} />
        <MetricCard label="Assignments" value={metrics.assignmentRows}
          active={false} onClick={() => { toggleSort("offering"); }} />
        <MetricCard label="Overallocated" value={metrics.overCount}
          variant={metrics.overCount > 0 ? "destructive" : "default"}
          active={capacityFilter === "overallocated"} onClick={() => setCapacityFilter(capacityFilter === "overallocated" ? null : "overallocated")} />
        <MetricCard label="Fully Allocated" value={metrics.fullyCount} variant="success"
          active={capacityFilter === "fully-allocated"} onClick={() => setCapacityFilter(capacityFilter === "fully-allocated" ? null : "fully-allocated")} />
        <MetricCard label="Available" value={metrics.underCount} variant="warning"
          active={capacityFilter === "underallocated"} onClick={() => setCapacityFilter(capacityFilter === "underallocated" ? null : "underallocated")} />
        <MetricCard label="Unassigned" value={metrics.unassignedCount}
          active={capacityFilter === "unassigned"} onClick={() => setCapacityFilter(capacityFilter === "unassigned" ? null : "unassigned")} />
      </div>

      {/* Active filter indicator */}
      {capacityFilter && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Filtering by:</span>
          <Badge variant="secondary" className="gap-1">
            {capacityFilter === "fully-allocated" ? "Fully Allocated" : capacityFilter.charAt(0).toUpperCase() + capacityFilter.slice(1)}
            <button onClick={() => setCapacityFilter(null)} className="ml-1 hover:text-destructive"><X className="h-3 w-3" /></button>
          </Badge>
        </div>
      )}

      {/* Controls */}
      <div className="flex items-center gap-2 flex-wrap">
        {filterOptions.offerings.length > 1 && (
          <select value={offeringFilter} onChange={(e) => setOfferingFilter(e.target.value)}
            className="px-3 py-1.5 text-sm border border-input rounded-md bg-background">
            <option value="">All Offerings</option>
            {filterOptions.offerings.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        )}
        {filterOptions.clients.length > 0 && (
          <select value={clientFilter} onChange={(e) => setClientFilter(e.target.value)}
            className="px-3 py-1.5 text-sm border border-input rounded-md bg-background">
            <option value="">All Clients</option>
            {filterOptions.clients.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
        {filterOptions.managers.length > 0 && (
          <select value={managerFilter} onChange={(e) => setManagerFilter(e.target.value)}
            className="px-3 py-1.5 text-sm border border-input rounded-md bg-background">
            <option value="">All Managers</option>
            {filterOptions.managers.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        )}
        {filterOptions.locations.length > 0 && (
          <select value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)}
            className="px-3 py-1.5 text-sm border border-input rounded-md bg-background">
            <option value="">All Locations</option>
            {filterOptions.locations.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        )}
        {hasFilters && (
          <button onClick={clearAllFilters}
            className="text-xs px-2 py-1.5 rounded-md bg-muted text-muted-foreground hover:bg-muted/80">
            Clear filters
          </button>
        )}

        <div className="ml-auto flex items-center gap-2">
          <span className="text-sm text-muted-foreground">
            {filteredRows.length} rows · {formatFte(metrics.totalFte)} FTE
          </span>
          {canManage && (
            <>
              <button onClick={() => setOfferingsDialogOpen(true)}
                className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium border border-input rounded-md hover:bg-muted transition-colors">
                Manage Offerings
              </button>
              <button onClick={openAddDialog}
                className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors">
                <Plus className="h-3.5 w-3.5" />
                Add Assignment
              </button>
            </>
          )}
        </div>
      </div>

      {/* Matrix Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b-2 border-border bg-muted/50">
                  <th className="text-left py-3 px-4 font-semibold min-w-[160px]">
                    <SortHeader field="offering">Offering</SortHeader>
                  </th>
                  <th className="text-left py-3 px-3 font-semibold min-w-[130px]">
                    <SortHeader field="manager">Manager / Lead</SortHeader>
                  </th>
                  <th className="text-left py-3 px-3 font-semibold min-w-[130px]">
                    <SortHeader field="client">Client</SortHeader>
                  </th>
                  <th className="text-left py-3 px-3 font-semibold min-w-[160px]">
                    <SortHeader field="project">Project</SortHeader>
                  </th>
                  <th className="text-left py-3 px-3 font-semibold hidden md:table-cell min-w-[90px]">Location</th>
                  <th className="text-left py-3 px-3 font-semibold min-w-[120px]">Role Required</th>
                  <th className="text-center py-3 px-3 font-semibold w-16">
                    <SortHeader field="fte" className="justify-center">FTE</SortHeader>
                  </th>
                  <th className="text-left py-3 px-3 font-semibold min-w-[180px]">Employee(s)</th>
                  <th className="text-left py-3 px-3 font-semibold hidden lg:table-cell min-w-[200px]">Notes</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.length === 0 && (
                  <tr>
                    <td colSpan={9} className="py-12 text-center text-muted-foreground">
                      No assignments match the current filters.
                    </td>
                  </tr>
                )}
                {offeringGroups.map((group, groupIdx) => {
                  const color = OFFERING_COLORS[groupIdx % OFFERING_COLORS.length];
                  const isOfferingExpanded = expandedOfferings.has("__all__") || expandedOfferings.has(group.offering);
                  const showClientHeaders = group.clients.length > 1 || (group.clients.length === 1 && group.clients[0].clientName);

                  return (
                    <React.Fragment key={group.offering}>
                      {/* ─── Offering Group Header (Level 1) ─── */}
                      <tr
                        className={`border-b border-border/60 border-l-4 ${color.border} ${color.offeringBg} cursor-pointer hover:brightness-95 transition-all`}
                        onClick={() => toggleExpand(expandedOfferings, group.offering, setExpandedOfferings)}
                      >
                        <td colSpan={6} className="py-2.5 px-4">
                          <div className="flex items-center gap-2">
                            {isOfferingExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            <span className="font-bold text-sm">{group.offering}</span>
                            {group.hasProjectMembers && (
                              <Badge variant="outline" className="text-[9px] bg-blue-50 border-blue-200 text-blue-700">
                                From Projects
                              </Badge>
                            )}
                            <span className="text-xs text-muted-foreground">
                              ({group.clients.reduce((s, c) => s + c.rows.length, 0)} row{group.clients.reduce((s, c) => s + c.rows.length, 0) !== 1 ? "s" : ""} · {group.employeeCount} employee{group.employeeCount !== 1 ? "s" : ""})
                            </span>
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-center font-bold">{formatFte(group.totalFte)}</td>
                        <td colSpan={2} className="py-2.5 px-3" />
                      </tr>

                      {isOfferingExpanded && group.clients.map((cg) => {
                        const clientExpandKey = `${group.offering}::${cg.clientName || "__none__"}`;
                        const isClientExpanded = expandedClients.has("__all__") || expandedClients.has(clientExpandKey);

                        return (
                          <React.Fragment key={clientExpandKey}>
                            {/* ─── Client Sub-Header (Level 2) ─── */}
                            {showClientHeaders && (
                              <tr
                                className={`border-b border-border/40 border-l-4 ${color.border} ${color.clientBg} cursor-pointer hover:brightness-95 transition-all`}
                                onClick={() => toggleExpand(expandedClients, clientExpandKey, setExpandedClients)}
                              >
                                <td className="py-2 px-4" />
                                <td className="py-2 px-3" />
                                <td colSpan={4} className="py-2 px-3">
                                  <div className="flex items-center gap-2">
                                    {isClientExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                                    {cg.clientId ? (
                                      <Link href={`/clients/${cg.clientId}`}
                                        className="font-semibold text-sm hover:text-primary hover:underline"
                                        onClick={(e) => e.stopPropagation()}>
                                        {cg.clientName}
                                      </Link>
                                    ) : (
                                      <span className="font-semibold text-sm text-muted-foreground">{cg.clientName || "No Client"}</span>
                                    )}
                                    <span className="text-xs text-muted-foreground">
                                      ({cg.rows.length} row{cg.rows.length !== 1 ? "s" : ""})
                                    </span>
                                  </div>
                                </td>
                                <td className="py-2 px-3 text-center font-semibold text-xs">{formatFte(cg.totalFte)}</td>
                                <td colSpan={2} className="py-2 px-3" />
                              </tr>
                            )}

                            {/* ─── Data Rows (Level 3) ─── */}
                            {(showClientHeaders ? isClientExpanded : true) && cg.rows.map((row) => (
                              <tr
                                key={row.key}
                                className={`border-b border-border/20 border-l-4 ${color.border} ${color.rowBg} transition-colors ${
                                  fteHighlight && row.employees.some((e) => e.id === fteHighlight) ? "bg-primary/5" : ""
                                }`}
                              >
                                <td className="py-2 px-4 text-muted-foreground text-xs" />
                                <td className="py-2 px-3 text-sm">
                                  {row.managerId ? (
                                    <Link href={`/team/${row.managerId}`} className="hover:text-primary hover:underline">
                                      {row.managerName}
                                    </Link>
                                  ) : row.managerName || <span className="text-muted-foreground">—</span>}
                                </td>
                                <td className="py-2 px-3 text-sm font-medium">
                                  {row.clientId ? (
                                    <Link href={`/clients/${row.clientId}`} className="hover:text-primary hover:underline">
                                      {row.clientName}
                                    </Link>
                                  ) : row.clientName || <span className="text-muted-foreground">—</span>}
                                </td>
                                <td className="py-2 px-3 text-sm">
                                  {row.projectId ? (
                                    <Link href={`/projects/${row.projectId}`} className="font-medium hover:text-primary hover:underline">
                                      {row.projectName}
                                    </Link>
                                  ) : row.projectName || <span className="text-muted-foreground">—</span>}
                                </td>
                                <td className="py-2 px-3 text-sm text-muted-foreground hidden md:table-cell">
                                  {row.location ? (
                                    <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{row.location}</span>
                                  ) : "—"}
                                </td>
                                <td className="py-2 px-3 text-sm">
                                  {row.roleRequired ? (
                                    <Badge variant="outline" className="text-[10px]">{row.roleRequired}</Badge>
                                  ) : <span className="text-muted-foreground">—</span>}
                                </td>
                                <td className="py-2 px-3 text-center">
                                  {row.source === "project-member" ? (
                                    <span className="text-xs text-muted-foreground italic" title="No FTE assigned — create an assignment to set allocation">—</span>
                                  ) : row.fte > 0 && row.employees.length === 1 ? (
                                    <Link
                                      href={`/team/${row.employees[0].id}`}
                                      className="font-bold text-sm hover:text-primary hover:underline cursor-pointer"
                                      title={`View ${row.employees[0].name}'s allocation details`}
                                      onMouseEnter={() => setFteHighlight(row.employees[0].id)}
                                      onMouseLeave={() => setFteHighlight(null)}
                                    >
                                      {formatFte(row.fte)}
                                    </Link>
                                  ) : (
                                    <button
                                      onClick={() => toggleSort("fte")}
                                      className={`font-bold text-sm hover:text-primary cursor-pointer ${row.fte > 1 ? "text-red-600" : ""}`}
                                      title="Sort by FTE"
                                    >
                                      {formatFte(row.fte)}
                                    </button>
                                  )}
                                </td>
                                <td className="py-2 px-3">
                                  <div className="space-y-0.5">
                                    {row.employees.map((emp) => (
                                      <div key={emp.id}>
                                        <Link href={`/team/${emp.id}`} className="text-xs hover:text-primary hover:underline">
                                          {emp.name}
                                        </Link>
                                      </div>
                                    ))}
                                    {row.employees.length === 0 && (
                                      <span className="text-xs text-muted-foreground italic">Unfilled</span>
                                    )}
                                  </div>
                                </td>
                                <td className="py-2 px-3 hidden lg:table-cell">
                                  {row.source === "project-member" && canManage ? (
                                    <button
                                      onClick={openAddDialog}
                                      className="text-xs text-primary hover:underline flex items-center gap-1"
                                    >
                                      <Plus className="h-3 w-3" />
                                      Create assignment
                                    </button>
                                  ) : row.source === "unassigned" && canManage ? (
                                    <button
                                      onClick={openAddDialog}
                                      className="text-xs text-primary hover:underline flex items-center gap-1"
                                    >
                                      <Plus className="h-3 w-3" />
                                      Assign
                                    </button>
                                  ) : row.notes ? (
                                    <span className="text-xs text-muted-foreground">{row.notes}</span>
                                  ) : null}
                                </td>
                              </tr>
                            ))}
                          </React.Fragment>
                        );
                      })}
                    </React.Fragment>
                  );
                })}
              </tbody>
              {/* Footer totals */}
              {filteredRows.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-border bg-muted/30 font-semibold">
                    <td colSpan={6} className="py-2.5 px-4 text-right">Total FTE</td>
                    <td className="py-2.5 px-3 text-center font-bold">
                      {formatFte(filteredRows.reduce((s, r) => s + r.fte, 0))}
                    </td>
                    <td colSpan={2} className="py-2.5 px-3" />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Dialogs — key forces remount to reset useFormState */}
      {canManage && (
        <>
          <AddAssignmentDialog
            key={`add-${addDialogKey}`}
            open={addDialogOpen}
            onClose={() => setAddDialogOpen(false)}
            users={users}
            projects={projects}
            clients={clients}
            serviceOfferings={serviceOfferings}
          />
          <ManageOfferingsDialog
            open={offeringsDialogOpen}
            onClose={() => setOfferingsDialogOpen(false)}
            serviceOfferings={serviceOfferings}
          />
        </>
      )}
    </div>
  );
}

function MetricCard({ label, value, variant = "default", active = false, onClick }: {
  label: string;
  value: string | number;
  variant?: "default" | "success" | "warning" | "destructive";
  active?: boolean;
  onClick?: () => void;
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
      className={`text-left p-3 rounded-lg border bg-card transition-all ${
        active
          ? "border-primary ring-2 ring-primary/20 shadow-sm"
          : "border-border hover:border-primary/40 hover:shadow-sm"
      }`}
    >
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{label}</p>
      <p className={`text-xl font-bold mt-0.5 ${colorMap[variant]}`}>{value}</p>
    </button>
  );
}
