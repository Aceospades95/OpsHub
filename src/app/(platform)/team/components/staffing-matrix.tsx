"use client";

import React, { useState, useMemo, useTransition } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ChevronDown, ChevronRight, ArrowUpDown, Plus, MapPin, X, Pencil, AlertTriangle, UserPlus, MessageSquare, Check, XCircle,
} from "lucide-react";
import Link from "next/link";
import {
  UserData, ProjectData, ClientData, ServiceOfferingData,
  AllocationStatus, getAllocationStatus, computeEmployeeFte, formatFte,
} from "./team-types";
import { AddAssignmentDialog } from "./add-assignment-dialog";
import { EditAssignmentDialog, type EditAssignmentData } from "./edit-assignment-dialog";
import { ManageOfferingsDialog } from "./manage-offerings-dialog";
import { updateAssignmentNotes, updateAssignmentFte } from "@/actions/assignments";

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

// 5-level hierarchy: Offering → Client → Project → Role → rows
interface RoleGroup {
  role: string;
  rows: MatrixRow[];
  totalFte: number;
  employeeCount: number;
  neededPositions: number;
}

interface ProjectGroup {
  projectName: string;
  projectId: string | null;
  roles: RoleGroup[];
  totalFte: number;
  neededPositions: number;
  filledPositions: number;
}

interface ClientGroup {
  clientName: string;
  clientId: string | null;
  projects: ProjectGroup[];
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
  // Track collapsed groups (inverted: everything starts expanded)
  const [collapsedOfferings, setCollapsedOfferings] = useState<Set<string>>(new Set());
  const [collapsedClients, setCollapsedClients] = useState<Set<string>>(new Set());
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(new Set());
  const [offeringFilter, setOfferingFilter] = useState("");
  const [clientFilter, setClientFilter] = useState("");
  const [managerFilter, setManagerFilter] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const [capacityFilter, setCapacityFilter] = useState<CapacityFilter>(null);
  const [sortField, setSortField] = useState<SortField>("offering");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [addDialogKey, setAddDialogKey] = useState(0);
  const [addDialogDefaults, setAddDialogDefaults] = useState<{ employeeId?: string; projectId?: string; clientId?: string; serviceOfferingId?: string }>({});
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editDialogKey, setEditDialogKey] = useState(0);
  const [editAssignment, setEditAssignment] = useState<EditAssignmentData | null>(null);
  const [offeringsDialogOpen, setOfferingsDialogOpen] = useState(false);
  const [fteHighlight, setFteHighlight] = useState<string | null>(null);
  const [editingNotes, setEditingNotes] = useState<{ assignmentId: string; value: string } | null>(null);
  const [editingFte, setEditingFte] = useState<{ assignmentId: string; value: number } | null>(null);
  const [collapsedRoles, setCollapsedRoles] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();

  const saveNotes = (assignmentId: string, value: string) => {
    startTransition(async () => {
      await updateAssignmentNotes(assignmentId, value);
      setEditingNotes(null);
    });
  };

  const saveFte = (assignmentId: string, value: number) => {
    startTransition(async () => {
      await updateAssignmentFte(assignmentId, value);
      setEditingFte(null);
    });
  };

  const toggleCollapse = (key: string, setter: React.Dispatch<React.SetStateAction<Set<string>>>) => {
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

  const openAddDialog = (defaults: { employeeId?: string; projectId?: string; clientId?: string; serviceOfferingId?: string } = {}) => {
    setAddDialogKey((k) => k + 1);
    setAddDialogDefaults(defaults);
    setAddDialogOpen(true);
  };

  const openEditDialog = (data: EditAssignmentData) => {
    setEditDialogKey((k) => k + 1);
    setEditAssignment(data);
    setEditDialogOpen(true);
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
        // Use project's offering if available, fall back to assignment's offering
        const projOffering = assignment.project?.id
          ? projects.find((p) => p.id === assignment.project!.id)?.serviceOffering
          : null;
        const offeringName = projOffering?.name || assignment.serviceOffering?.name || assignment.function || "Unassigned";
        const offeringId = projOffering?.id || assignment.serviceOffering?.id || null;
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
            location: user.location || "", roleRequired: "", fte: 1,
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
  }, [users, clients, projects, search]);

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

  // Build 5-level hierarchy: Offering → Client → Project → Role → Rows
  const offeringGroups: OfferingGroup[] = useMemo(() => {
    const offeringMap = new Map<string, Map<string, Map<string, Map<string, MatrixRow[]>>>>();

    for (const row of filteredRows) {
      if (!offeringMap.has(row.offering)) offeringMap.set(row.offering, new Map());
      const clientMap = offeringMap.get(row.offering)!;
      const clientKey = row.clientName || "(No Client)";
      if (!clientMap.has(clientKey)) clientMap.set(clientKey, new Map());
      const projectMap = clientMap.get(clientKey)!;
      const projectKey = row.projectName || "(No Project)";
      if (!projectMap.has(projectKey)) projectMap.set(projectKey, new Map());
      const roleMap = projectMap.get(projectKey)!;
      const roleKey = row.roleRequired || "(No Role)";
      if (!roleMap.has(roleKey)) roleMap.set(roleKey, []);
      roleMap.get(roleKey)!.push(row);
    }

    const groups: OfferingGroup[] = [];
    Array.from(offeringMap.entries()).forEach(([offering, clientMap]) => {
      const clientGroups: ClientGroup[] = [];
      let totalFte = 0;
      const allEmployeeIds = new Set<string>();
      let hasProjectMembers = false;

      Array.from(clientMap.entries()).forEach(([clientName, projectMap]) => {
        const projectGroups: ProjectGroup[] = [];
        let clientFte = 0;

        Array.from(projectMap.entries()).forEach(([projectName, roleMap]) => {
          const roleGroups: RoleGroup[] = [];
          let pFte = 0;
          const totalEmployees = new Set<string>();

          Array.from(roleMap.entries()).forEach(([roleName, roleRows]) => {
            const rFte = roleRows.reduce((s, r) => s + r.fte, 0);
            const roleEmployees = new Set<string>();
            roleRows.forEach((r) => r.employees.forEach((e) => roleEmployees.add(e.id)));
            const neededPos = Math.max(Math.ceil(rFte), roleEmployees.size);
            roleGroups.push({
              role: roleName === "(No Role)" ? "" : roleName,
              rows: roleRows,
              totalFte: rFte,
              employeeCount: roleEmployees.size,
              neededPositions: neededPos,
            });
            pFte += rFte;
            roleRows.forEach((r) => {
              r.employees.forEach((e) => { totalEmployees.add(e.id); allEmployeeIds.add(e.id); });
              if (r.source === "project-member") hasProjectMembers = true;
            });
          });

          roleGroups.sort((a, b) => (a.role || "zzz").localeCompare(b.role || "zzz"));
          const neededPositions = Math.max(Math.ceil(pFte), totalEmployees.size);

          projectGroups.push({
            projectName: projectName === "(No Project)" ? "" : projectName,
            projectId: roleGroups[0]?.rows[0]?.projectId || null,
            roles: roleGroups,
            totalFte: pFte,
            neededPositions,
            filledPositions: totalEmployees.size,
          });
          clientFte += pFte;
        });

        projectGroups.sort((a, b) => (a.projectName || "zzz").localeCompare(b.projectName || "zzz"));

        const firstRow = projectGroups[0]?.roles[0]?.rows[0];
        clientGroups.push({
          clientName: clientName === "(No Client)" ? "" : clientName,
          clientId: firstRow?.clientId || null,
          projects: projectGroups,
          totalFte: clientFte,
        });
        totalFte += clientFte;
      });

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
              <button onClick={() => openAddDialog()}
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
                  <th className="text-left py-3 px-4 font-semibold min-w-[140px]">
                    <SortHeader field="offering">Offering</SortHeader>
                  </th>
                  <th className="text-left py-3 px-3 font-semibold min-w-[120px]">
                    <SortHeader field="client">Client</SortHeader>
                  </th>
                  <th className="text-left py-3 px-3 font-semibold min-w-[140px]">
                    <SortHeader field="project">Project</SortHeader>
                  </th>
                  <th className="text-left py-3 px-3 font-semibold hidden md:table-cell min-w-[90px]">Location</th>
                  <th className="text-left py-3 px-3 font-semibold min-w-[120px]">
                    <SortHeader field="manager">Manager / Lead</SortHeader>
                  </th>
                  <th className="text-left py-3 px-3 font-semibold min-w-[110px]">Role Required</th>
                  <th className="text-center py-3 px-3 font-semibold w-16">
                    <SortHeader field="fte" className="justify-center">FTE</SortHeader>
                  </th>
                  <th className="text-left py-3 px-3 font-semibold min-w-[150px]">Employee(s)</th>
                  <th className="text-left py-3 px-3 font-semibold hidden lg:table-cell min-w-[180px]">Notes</th>
                  <th className="py-3 px-2 w-10" />
                </tr>
              </thead>
              <tbody>
                {filteredRows.length === 0 && (
                  <tr>
                    <td colSpan={10} className="py-12 text-center text-muted-foreground">
                      No assignments match the current filters.
                    </td>
                  </tr>
                )}
                {offeringGroups.map((group, groupIdx) => {
                  const color = OFFERING_COLORS[groupIdx % OFFERING_COLORS.length];
                  const isOfferingExpanded = !collapsedOfferings.has(group.offering);
                  const showClientHeaders = group.clients.length > 1 || (group.clients.length === 1 && group.clients[0].clientName);
                  const totalRows = group.clients.reduce((s, c) => c.projects.reduce((s2, p) => p.roles.reduce((s3, r) => s3 + r.rows.length, s2), s), 0);

                  return (
                    <React.Fragment key={group.offering}>
                      {/* ─── Offering Group Header (Level 1) ─── */}
                      <tr
                        className={`border-b border-border/60 border-l-4 ${color.border} ${color.offeringBg} cursor-pointer hover:brightness-95 transition-all`}
                        onClick={() => toggleCollapse(group.offering, setCollapsedOfferings)}
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
                              ({totalRows} row{totalRows !== 1 ? "s" : ""} · {group.employeeCount} employee{group.employeeCount !== 1 ? "s" : ""})
                            </span>
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-center font-bold">{formatFte(group.totalFte)}</td>
                        <td colSpan={3} className="py-2.5 px-3" />
                      </tr>

                      {isOfferingExpanded && group.clients.map((cg) => {
                        const clientExpandKey = `${group.offering}::${cg.clientName || "__none__"}`;
                        const isClientExpanded = !collapsedClients.has(clientExpandKey);
                        const clientRowCount = cg.projects.reduce((s, p) => p.roles.reduce((s2, r) => s2 + r.rows.length, s), 0);

                        return (
                          <React.Fragment key={clientExpandKey}>
                            {/* ─── Client Sub-Header (Level 2) ─── */}
                            {showClientHeaders && (
                              <tr
                                className={`border-b border-border/40 border-l-4 ${color.border} ${color.clientBg} cursor-pointer hover:brightness-95 transition-all`}
                                onClick={() => toggleCollapse(clientExpandKey, setCollapsedClients)}
                              >
                                <td colSpan={6} className="py-2 px-4">
                                  <div className="flex items-center gap-2 pl-6">
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
                                      ({clientRowCount} row{clientRowCount !== 1 ? "s" : ""})
                                    </span>
                                  </div>
                                </td>
                                <td className="py-2 px-3 text-center font-semibold text-xs">{formatFte(cg.totalFte)}</td>
                                <td colSpan={3} className="py-2 px-3" />
                              </tr>
                            )}

                            {/* ─── Project Groups (Level 3) ─── */}
                            {(showClientHeaders ? isClientExpanded : true) && cg.projects.map((pg) => {
                              const projectExpandKey = `${clientExpandKey}::${pg.projectName || "__none__"}`;
                              const isProjectExpanded = !collapsedProjects.has(projectExpandKey);
                              const totalRoleRows = pg.roles.reduce((s, r) => s + r.rows.length, 0);
                              const showProjectHeader = pg.projectName && (cg.projects.length > 1 || totalRoleRows > 1);
                              const unfilled = Math.max(0, pg.neededPositions - pg.filledPositions);

                              return (
                                <React.Fragment key={projectExpandKey}>
                                  {showProjectHeader && (
                                    <tr
                                      className={`border-b border-border/30 border-l-4 ${color.border} cursor-pointer hover:brightness-95 transition-all bg-muted/20`}
                                      onClick={() => toggleCollapse(projectExpandKey, setCollapsedProjects)}
                                    >
                                      <td colSpan={6} className="py-1.5 px-4">
                                        <div className="flex items-center gap-2 pl-12">
                                          {isProjectExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                                          {pg.projectId ? (
                                            <Link href={`/projects/${pg.projectId}`}
                                              className="font-medium text-xs hover:text-primary hover:underline"
                                              onClick={(e) => e.stopPropagation()}>
                                              {pg.projectName}
                                            </Link>
                                          ) : (
                                            <span className="font-medium text-xs text-muted-foreground">{pg.projectName || "No Project"}</span>
                                          )}
                                          <span className="text-[10px] text-muted-foreground">
                                            ({pg.roles.length} role{pg.roles.length !== 1 ? "s" : ""} · {pg.filledPositions}/{pg.neededPositions} filled)
                                          </span>
                                          {unfilled > 0 && (
                                            <Badge variant="outline" className="text-[9px] bg-amber-50 border-amber-300 text-amber-700 gap-0.5">
                                              <AlertTriangle className="h-2.5 w-2.5" />
                                              {unfilled} unfilled
                                            </Badge>
                                          )}
                                        </div>
                                      </td>
                                      <td className="py-1.5 px-3 text-center font-semibold text-xs">{formatFte(pg.totalFte)}</td>
                                      <td colSpan={3} className="py-1.5 px-3" />
                                    </tr>
                                  )}

                                  {/* ─── Role Groups (Level 4) ─── */}
                                  {(showProjectHeader ? isProjectExpanded : true) && pg.roles.map((rg) => {
                                    const roleExpandKey = `${projectExpandKey}::${rg.role || "__none__"}`;
                                    const isRoleExpanded = !collapsedRoles.has(roleExpandKey);
                                    const showRoleHeader = rg.role && (pg.roles.length > 1 || rg.rows.length > 1);
                                    const roleUnfilled = Math.max(0, rg.neededPositions - rg.employeeCount);

                                    return (
                                      <React.Fragment key={roleExpandKey}>
                                        {showRoleHeader && (
                                          <tr
                                            className={`border-b border-border/20 border-l-4 ${color.border} cursor-pointer hover:brightness-95 transition-all bg-muted/10`}
                                            onClick={() => toggleCollapse(roleExpandKey, setCollapsedRoles)}
                                          >
                                            <td colSpan={5} className="py-1 px-4">
                                              <div className="flex items-center gap-2 pl-[72px]">
                                                {isRoleExpanded ? <ChevronDown className="h-2.5 w-2.5" /> : <ChevronRight className="h-2.5 w-2.5" />}
                                                <Badge variant="outline" className="text-[10px]">{rg.role}</Badge>
                                                <span className="text-[10px] text-muted-foreground">
                                                  ({rg.employeeCount} employee{rg.employeeCount !== 1 ? "s" : ""})
                                                </span>
                                                {roleUnfilled > 0 && (
                                                  <Badge variant="outline" className="text-[9px] bg-amber-50 border-amber-300 text-amber-700 gap-0.5">
                                                    <AlertTriangle className="h-2.5 w-2.5" />
                                                    {roleUnfilled} unfilled
                                                  </Badge>
                                                )}
                                              </div>
                                            </td>
                                            <td className="py-1 px-3" />
                                            <td className="py-1 px-3 text-center font-semibold text-[11px]">{formatFte(rg.totalFte)}</td>
                                            <td colSpan={3} className="py-1 px-3" />
                                          </tr>
                                        )}

                                        {/* ─── Employee Rows (Level 5) ─── */}
                                        {(showRoleHeader ? isRoleExpanded : true) && rg.rows.map((row) => {
                                          const rowUnfilled = Math.max(0, Math.ceil(row.fte) - row.employees.length);
                                          const singleAssignment = row.source === "assignment" && row.assignmentIds.length === 1 && row.employees.length === 1;
                                          const assignmentId = singleAssignment ? row.assignmentIds[0] : null;

                                          return (
                                            <tr
                                              key={row.key}
                                              className={`border-b border-border/20 border-l-4 ${color.border} ${color.rowBg} transition-colors ${
                                                fteHighlight && row.employees.some((e) => e.id === fteHighlight) ? "bg-primary/5" : ""
                                              }`}
                                            >
                                              {/* Offering (empty - shown in header) */}
                                              <td className="py-2 px-4 text-muted-foreground text-xs" />
                                              {/* Client */}
                                              <td className="py-2 px-3 text-sm font-medium">
                                                {row.clientId ? (
                                                  <Link href={`/clients/${row.clientId}`} className="hover:text-primary hover:underline">
                                                    {row.clientName}
                                                  </Link>
                                                ) : row.clientName || <span className="text-muted-foreground">—</span>}
                                              </td>
                                              {/* Project */}
                                              <td className="py-2 px-3 text-sm">
                                                {row.projectId ? (
                                                  <Link href={`/projects/${row.projectId}`} className="font-medium hover:text-primary hover:underline">
                                                    {row.projectName}
                                                  </Link>
                                                ) : row.projectName || <span className="text-muted-foreground">—</span>}
                                              </td>
                                              {/* Location */}
                                              <td className="py-2 px-3 text-sm text-muted-foreground hidden md:table-cell">
                                                {row.location ? (
                                                  <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{row.location}</span>
                                                ) : "—"}
                                              </td>
                                              {/* Manager / Lead */}
                                              <td className="py-2 px-3 text-sm">
                                                {row.managerId ? (
                                                  <Link href={`/team/${row.managerId}`} className="hover:text-primary hover:underline">
                                                    {row.managerName}
                                                  </Link>
                                                ) : row.managerName || <span className="text-muted-foreground">—</span>}
                                              </td>
                                              {/* Role Required */}
                                              <td className="py-2 px-3 text-sm">
                                                {row.roleRequired ? (
                                                  <Badge variant="outline" className="text-[10px]">{row.roleRequired}</Badge>
                                                ) : <span className="text-muted-foreground">—</span>}
                                              </td>
                                              {/* FTE - inline editable */}
                                              <td className="py-2 px-3 text-center">
                                                {editingFte?.assignmentId === assignmentId && assignmentId ? (
                                                  <form onSubmit={(e) => { e.preventDefault(); saveFte(assignmentId, editingFte.value); }} className="flex items-center gap-0.5">
                                                    <input
                                                      type="number" step="0.05" min="0" max="2"
                                                      value={editingFte.value}
                                                      onChange={(e) => setEditingFte({ assignmentId, value: parseFloat(e.target.value) || 0 })}
                                                      onBlur={() => saveFte(assignmentId, editingFte.value)}
                                                      autoFocus
                                                      className="w-14 h-6 text-xs text-center border border-primary rounded bg-background focus:outline-none"
                                                    />
                                                  </form>
                                                ) : singleAssignment && canManage ? (
                                                  <button
                                                    onClick={() => setEditingFte({ assignmentId: assignmentId!, value: row.fte })}
                                                    className="font-bold text-sm text-blue-600 hover:text-primary cursor-pointer"
                                                    title="Click to edit FTE"
                                                    onMouseEnter={() => setFteHighlight(row.employees[0]?.id)}
                                                    onMouseLeave={() => setFteHighlight(null)}
                                                  >
                                                    {formatFte(row.fte)}
                                                  </button>
                                                ) : row.source === "project-member" && canManage ? (
                                                  <button
                                                    onClick={() => openAddDialog({
                                                      employeeId: row.employees[0]?.id,
                                                      projectId: row.projectId || undefined,
                                                      clientId: row.clientId || undefined,
                                                    })}
                                                    className="font-bold text-sm text-blue-600 hover:text-primary cursor-pointer"
                                                    title="Default FTE — click to create assignment"
                                                  >
                                                    {formatFte(row.fte)}
                                                  </button>
                                                ) : (
                                                  <span className={`font-bold text-sm ${row.fte > 1 ? "text-red-600" : ""}`}>
                                                    {formatFte(row.fte)}
                                                  </span>
                                                )}
                                              </td>
                                              {/* Employee(s) */}
                                              <td className="py-2 px-3">
                                                <div className="space-y-0.5">
                                                  {row.employees.map((emp) => (
                                                    <div key={emp.id}>
                                                      <Link href={`/team/${emp.id}`} className="text-xs hover:text-primary hover:underline">
                                                        {emp.name}
                                                      </Link>
                                                    </div>
                                                  ))}
                                                  {rowUnfilled > 0 && Array.from({ length: rowUnfilled }).map((_, i) => (
                                                    <div key={`unfilled-${i}`} className="flex items-center gap-1 text-xs text-amber-600 italic">
                                                      <UserPlus className="h-3 w-3" />
                                                      <span>Unfilled</span>
                                                      {canManage && (
                                                        <button
                                                          onClick={() => openAddDialog({
                                                            projectId: row.projectId || undefined,
                                                            clientId: row.clientId || undefined,
                                                            serviceOfferingId: row.offeringId || undefined,
                                                          })}
                                                          className="text-primary hover:underline ml-1"
                                                        >
                                                          Assign
                                                        </button>
                                                      )}
                                                    </div>
                                                  ))}
                                                  {row.employees.length === 0 && rowUnfilled === 0 && (
                                                    <span className="text-xs text-muted-foreground italic">Unfilled</span>
                                                  )}
                                                </div>
                                              </td>
                                              {/* Notes - inline editable */}
                                              <td className="py-2 px-3 hidden lg:table-cell">
                                                {singleAssignment && canManage ? (
                                                  editingNotes?.assignmentId === assignmentId ? (
                                                    <div className="relative">
                                                      <div className="absolute z-20 bottom-0 left-0 w-72 bg-background border border-border rounded-lg shadow-lg p-2 space-y-2">
                                                        <textarea
                                                          value={editingNotes.value}
                                                          onChange={(e) => setEditingNotes({ assignmentId: assignmentId!, value: e.target.value })}
                                                          autoFocus
                                                          rows={4}
                                                          className="w-full text-xs border border-input rounded bg-background px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary resize-y"
                                                          placeholder="Add notes..."
                                                        />
                                                        <div className="flex justify-end gap-1">
                                                          <button
                                                            type="button"
                                                            onClick={() => setEditingNotes(null)}
                                                            className="px-2 py-1 text-[10px] rounded border border-input hover:bg-muted"
                                                          >
                                                            Cancel
                                                          </button>
                                                          <button
                                                            type="button"
                                                            onClick={() => saveNotes(assignmentId!, editingNotes.value)}
                                                            disabled={isPending}
                                                            className="px-2 py-1 text-[10px] rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                                                          >
                                                            {isPending ? "Saving..." : "Save"}
                                                          </button>
                                                        </div>
                                                      </div>
                                                    </div>
                                                  ) : (
                                                    <button
                                                      onClick={() => setEditingNotes({ assignmentId: assignmentId!, value: row.notes })}
                                                      className="text-xs text-left text-muted-foreground hover:text-foreground cursor-pointer max-w-[180px] truncate block"
                                                      title={row.notes || "Click to add notes"}
                                                    >
                                                      {row.notes ? (
                                                        <span className="flex items-center gap-1">
                                                          <MessageSquare className="h-3 w-3 shrink-0" />
                                                          <span className="truncate">{row.notes}</span>
                                                        </span>
                                                      ) : (
                                                        <span className="text-muted-foreground/50 flex items-center gap-1">
                                                          <MessageSquare className="h-3 w-3" />
                                                          Add note
                                                        </span>
                                                      )}
                                                    </button>
                                                  )
                                                ) : row.notes ? (
                                                  <span className="text-xs text-muted-foreground max-w-[180px] truncate block" title={row.notes}>{row.notes}</span>
                                                ) : null}
                                              </td>
                                              {/* Edit icon */}
                                              <td className="py-2 px-2">
                                                {singleAssignment && canManage ? (
                                                  <button
                                                    onClick={() => {
                                                      const emp = row.employees[0];
                                                      const a = users.find((u) => u.id === emp.id)?.assignments.find((a) => a.id === row.assignmentIds[0]);
                                                      if (a) openEditDialog({
                                                        id: a.id, employeeId: emp.id, employeeName: emp.name,
                                                        projectId: a.project?.id || null, clientId: a.client?.id || null,
                                                        serviceOfferingId: a.serviceOffering?.id || null,
                                                        function: a.function || "", role: a.role || "",
                                                        allocationFte: a.allocationFte, status: a.status,
                                                        startDate: a.startDate, endDate: a.endDate, notes: a.notes || "",
                                                      });
                                                    }}
                                                    className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-primary transition-colors"
                                                    title="Edit assignment"
                                                  >
                                                    <Pencil className="h-3.5 w-3.5" />
                                                  </button>
                                                ) : row.source === "project-member" && canManage ? (
                                                  <button
                                                    onClick={() => openAddDialog({
                                                      employeeId: row.employees[0]?.id,
                                                      projectId: row.projectId || undefined,
                                                      clientId: row.clientId || undefined,
                                                    })}
                                                    className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-primary transition-colors"
                                                    title="Create assignment"
                                                  >
                                                    <Plus className="h-3.5 w-3.5" />
                                                  </button>
                                                ) : row.source === "unassigned" && canManage ? (
                                                  <button
                                                    onClick={() => openAddDialog({ employeeId: row.employees[0]?.id })}
                                                    className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-primary transition-colors"
                                                    title="Assign employee"
                                                  >
                                                    <Plus className="h-3.5 w-3.5" />
                                                  </button>
                                                ) : null}
                                              </td>
                                            </tr>
                                          );
                                        })}
                                      </React.Fragment>
                                    );
                                  })}
                                </React.Fragment>
                              );
                            })}
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
                    <td colSpan={3} className="py-2.5 px-3" />
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
            defaultEmployeeId={addDialogDefaults.employeeId}
            defaultProjectId={addDialogDefaults.projectId}
            defaultClientId={addDialogDefaults.clientId}
            defaultServiceOfferingId={addDialogDefaults.serviceOfferingId}
          />
          <EditAssignmentDialog
            key={`edit-${editDialogKey}`}
            open={editDialogOpen}
            onClose={() => setEditDialogOpen(false)}
            assignment={editAssignment}
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
