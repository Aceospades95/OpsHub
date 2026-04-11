"use client";

import React, { useState, useMemo, useTransition } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ChevronDown, ChevronRight, ArrowUpDown, Plus, MapPin, X, AlertTriangle, UserPlus, UserCheck,
} from "lucide-react";
import Link from "next/link";
import {
  UserData, ProjectData, ClientData, ServiceOfferingData, RoleDefinitionData, ProjectRoleData,
  AllocationStatus, getAllocationStatus, computeEmployeeFte, formatFte,
} from "./team-types";
import { AddAssignmentDialog } from "./add-assignment-dialog";
import { ManageOfferingsDialog } from "./manage-offerings-dialog";
import { updateAssignmentFte, updateAssignmentRole, createProjectRole, createRoleDefinition, deleteProjectRole, updateProjectRole, removeAssignment, quickAssign } from "@/actions/assignments";

interface StaffingMatrixProps {
  users: UserData[];
  projects: ProjectData[];
  clients: ClientData[];
  serviceOfferings: ServiceOfferingData[];
  roleDefinitions: RoleDefinitionData[];
  projectRoles: ProjectRoleData[];
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
  projectRoleId: string | null;
  fte: number;
  employees: { id: string; name: string; jobTitle: string | null }[];
  notes: string;
  assignmentIds: string[];
  source: "assignment" | "unassigned";
}

// 5-level hierarchy: Offering → Client → Project → Role → rows
interface RoleGroup {
  role: string;
  projectRoleId: string | null;
  requiredFte: number;
  requiredQuantity: number;
  rows: MatrixRow[];
  totalFte: number;
  employeeCount: number;
  filledCount: number;
  unfilledCount: number;
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

export function StaffingMatrix({ users, projects, clients, serviceOfferings, roleDefinitions, projectRoles, search, canManage }: StaffingMatrixProps) {
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
  const [addDialogDefaults, setAddDialogDefaults] = useState<{ employeeId?: string; projectId?: string; clientId?: string; serviceOfferingId?: string; projectRoleId?: string; roleName?: string; roleDefinitionId?: string }>({});
  const [offeringsDialogOpen, setOfferingsDialogOpen] = useState(false);
  const [fteHighlight, setFteHighlight] = useState<string | null>(null);
  const [editingFte, setEditingFte] = useState<{ assignmentId: string; value: string } | null>(null);
  const [collapsedRoles, setCollapsedRoles] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();
  const [editingRole, setEditingRole] = useState<{ assignmentId: string; value: string } | null>(null);
  const [editingProjectRoleFte, setEditingProjectRoleFte] = useState<{ projectRoleId: string; quantity: string; requiredFte: number } | null>(null);
  const [addRoleProjectId, setAddRoleProjectId] = useState<string | null>(null);
  const [addRoleForm, setAddRoleForm] = useState({ roleDefinitionId: "", newRoleName: "", requiredFte: "1", quantity: "1" });
  const [quickAssignCtx, setQuickAssignCtx] = useState<{
    projectId: string; clientId?: string; projectRoleId?: string;
    roleDefinitionId?: string; roleName?: string; requiredFte: number;
    serviceOfferingId?: string;
  } | null>(null);

  const saveFte = (assignmentId: string, valueStr: string) => {
    const value = Math.max(0, Math.min(2, parseFloat(valueStr) || 0));
    startTransition(async () => {
      await updateAssignmentFte(assignmentId, value);
      setEditingFte(null);
    });
  };

  const saveRole = (assignmentId: string, roleDefId: string) => {
    const rd = roleDefinitions.find((r) => r.id === roleDefId);
    if (!rd) { setEditingRole(null); return; }
    startTransition(async () => {
      await updateAssignmentRole(assignmentId, rd.name, rd.id);
      setEditingRole(null);
    });
  };

  const saveProjectRoleQuantity = (projectRoleId: string, quantityStr: string, requiredFte: number) => {
    const qty = Math.max(1, Math.min(50, parseInt(quantityStr) || 1));
    startTransition(async () => {
      await updateProjectRole(projectRoleId, requiredFte, qty);
      setEditingProjectRoleFte(null);
    });
  };

  const handleAddRole = async () => {
    if (!addRoleProjectId) return;
    let roleDefId = addRoleForm.roleDefinitionId;
    if (roleDefId === "__new__") {
      if (!addRoleForm.newRoleName.trim()) return;
      const result = await createRoleDefinition(addRoleForm.newRoleName.trim());
      if (result.id) roleDefId = result.id;
      else return;
    }
    if (!roleDefId) return;
    const fte = Math.max(0.05, Math.min(2, parseFloat(addRoleForm.requiredFte) || 1));
    const qty = Math.max(1, Math.min(50, parseInt(addRoleForm.quantity) || 1));
    await createProjectRole(addRoleProjectId, roleDefId, fte, qty);
    setAddRoleProjectId(null);
    setAddRoleForm({ roleDefinitionId: "", newRoleName: "", requiredFte: "1", quantity: "1" });
  };

  const handleQuickAssign = (employeeId: string) => {
    if (!quickAssignCtx) return;
    startTransition(async () => {
      await quickAssign({
        employeeId,
        projectId: quickAssignCtx.projectId,
        clientId: quickAssignCtx.clientId,
        projectRoleId: quickAssignCtx.projectRoleId,
        roleDefinitionId: quickAssignCtx.roleDefinitionId,
        role: quickAssignCtx.roleName,
        allocationFte: quickAssignCtx.requiredFte,
        serviceOfferingId: quickAssignCtx.serviceOfferingId,
      });
      setQuickAssignCtx(null);
    });
  };

  const handleRemoveAssignment = (assignmentId: string, employeeName: string) => {
    if (!confirm(`Remove ${employeeName} from this assignment?`)) return;
    startTransition(async () => {
      await removeAssignment(assignmentId);
    });
  };

  const handleDeleteRole = (projectRoleId: string) => {
    startTransition(async () => {
      await deleteProjectRole(projectRoleId);
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

  const openAddDialog = (defaults: typeof addDialogDefaults = {}) => {
    setAddDialogKey((k) => k + 1);
    setAddDialogDefaults(defaults);
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

  // Build rows from Assignments only (project-members don't create staffing rows)
  const rows: MatrixRow[] = useMemo(() => {
    const rowMap = new Map<string, MatrixRow>();

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
        // Offering and client both come from the linked project (source of truth).
        // If the project has no offering, the row goes into the "Unassigned" group.
        // If the project has no client, it goes under "(No Client)".
        const projData = assignment.project?.id
          ? projects.find((p) => p.id === assignment.project!.id)
          : null;
        const offeringName = projData?.serviceOffering?.name || "Unassigned";
        const offeringId = projData?.serviceOffering?.id || null;
        // Derive client from project, not from assignment.client — this keeps
        // the row under the correct client group even if the assignment's
        // clientId is stale or null.
        const clientData = projData?.clientId
          ? clients.find((c) => c.id === projData.clientId)
          : null;
        const clientName = clientData?.name || assignment.client?.name || "";
        const clientId = clientData?.id || assignment.client?.id || null;
        const projectName = assignment.project?.name || "";
        const projectId = assignment.project?.id || null;
        // Role: prefer projectRole > roleDefinition > freeform role
        const role = assignment.projectRole?.roleDefinition?.name || assignment.roleDefinition?.name || assignment.role || "";
        const prId = assignment.projectRoleId || null;

        const managerName = user.manager?.name || "";
        // Include projectRoleId in key so assignments linked to a project role group together
        const key = `${offeringName}::${managerName}::${clientName}::${projectName}::${prId || role}`;

        if (!rowMap.has(key)) {
          rowMap.set(key, {
            key, offering: offeringName, offeringId, managerName,
            managerId: user.managerId, clientName, clientId, projectName, projectId,
            location: user.location || "", roleRequired: role, projectRoleId: prId, fte: 0,
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

      // 2) Unassigned employees (no active assignments)
      // Project memberships alone don't create staffing rows — the matrix
      // is driven by real Assignment records + defined ProjectRoles only.
      if (user.assignments.length === 0) {
        const key = `Unassigned::::::::${user.id}`;
        rowMap.set(key, {
          key, offering: "Unassigned", offeringId: null,
          managerName: user.manager?.name || "", managerId: user.managerId,
          clientName: "", clientId: null, projectName: "", projectId: null,
          location: user.location || "",
          // Don't use user.role (system role) — leave blank for unassigned
          roleRequired: "", projectRoleId: null,
          fte: 0, employees: [{ id: user.id, name: user.name, jobTitle: user.jobTitle }],
          notes: "", assignmentIds: [], source: "unassigned",
        });
      }
    }

    return Array.from(rowMap.values());
  }, [users, projects, clients, search]);

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

  // Build lookup: projectId → ProjectRoles
  const projectRolesMap = useMemo(() => {
    const map = new Map<string, ProjectRoleData[]>();
    for (const pr of projectRoles) {
      if (!map.has(pr.projectId)) map.set(pr.projectId, []);
      map.get(pr.projectId)!.push(pr);
    }
    return map;
  }, [projectRoles]);

  // Build 5-level hierarchy: Offering → Client → Project → Role → Rows
  const offeringGroups: OfferingGroup[] = useMemo(() => {
    // Group rows by offering → client → project
    const offeringMap = new Map<string, Map<string, Map<string, MatrixRow[]>>>();
    for (const row of filteredRows) {
      if (!offeringMap.has(row.offering)) offeringMap.set(row.offering, new Map());
      const clientMap = offeringMap.get(row.offering)!;
      const clientKey = row.clientName || "(No Client)";
      if (!clientMap.has(clientKey)) clientMap.set(clientKey, new Map());
      const projectMap = clientMap.get(clientKey)!;
      const projectKey = row.projectName || "(No Project)";
      if (!projectMap.has(projectKey)) projectMap.set(projectKey, []);
      projectMap.get(projectKey)!.push(row);
    }

    // Also ensure projects with defined roles appear even if no assignments yet
    for (const project of projects) {
      const pRoles = projectRolesMap.get(project.id);
      if (!pRoles || pRoles.length === 0) continue;
      const offering = project.serviceOffering?.name || "Unassigned";
      const clientName = clients.find((c) => c.id === project.clientId)?.name || "(No Client)";
      if (!offeringMap.has(offering)) offeringMap.set(offering, new Map());
      const clientMap = offeringMap.get(offering)!;
      if (!clientMap.has(clientName)) clientMap.set(clientName, new Map());
      const projectMap = clientMap.get(clientName)!;
      if (!projectMap.has(project.name)) projectMap.set(project.name, []);
    }

    const groups: OfferingGroup[] = [];
    Array.from(offeringMap.entries()).forEach(([offering, clientMap]) => {
      const clientGroups: ClientGroup[] = [];
      let totalFte = 0;
      const allEmployeeIds = new Set<string>();

      Array.from(clientMap.entries()).forEach(([clientName, projectMap]) => {
        const projectGroups: ProjectGroup[] = [];
        let clientFte = 0;

        Array.from(projectMap.entries()).forEach(([projectName, projectRows]) => {
          const projectId = projectRows[0]?.projectId || projects.find((p) => p.name === projectName)?.id || null;
          const definedRoles = projectId ? (projectRolesMap.get(projectId) || []) : [];

          // Build role groups: merge defined ProjectRoles with assignment rows
          const roleGroups: RoleGroup[] = [];
          let pFte = 0;
          const totalEmployees = new Set<string>();
          const usedRowKeys = new Set<string>();

          // 1) Create groups from defined ProjectRoles
          for (const pr of definedRoles) {
            const roleName = pr.roleDefinition.name;
            // Match by projectRoleId first, then fall back to role name
            const matchingRows = projectRows.filter((r) =>
              (r.projectRoleId && r.projectRoleId === pr.id) ||
              (!r.projectRoleId && r.roleRequired === roleName)
            );
            matchingRows.forEach((r) => usedRowKeys.add(r.key));
            const rFte = matchingRows.reduce((s, r) => s + r.fte, 0);
            const roleEmployees = new Set<string>();
            matchingRows.forEach((r) => r.employees.forEach((e) => roleEmployees.add(e.id)));
            const filledCount = roleEmployees.size;
            roleGroups.push({
              role: roleName,
              projectRoleId: pr.id,
              requiredFte: pr.requiredFte,
              requiredQuantity: pr.quantity,
              rows: matchingRows,
              totalFte: rFte,
              employeeCount: filledCount,
              filledCount,
              unfilledCount: Math.max(0, pr.quantity - filledCount),
            });
            pFte += rFte;
            matchingRows.forEach((r) => {
              r.employees.forEach((e) => { totalEmployees.add(e.id); allEmployeeIds.add(e.id); });
            });
          }

          // 2) Remaining rows not matched to a defined ProjectRole
          const remainingRows = projectRows.filter((r) => !usedRowKeys.has(r.key));
          const remainingByRole = new Map<string, MatrixRow[]>();
          for (const r of remainingRows) {
            const roleKey = r.roleRequired || "(No Role)";
            if (!remainingByRole.has(roleKey)) remainingByRole.set(roleKey, []);
            remainingByRole.get(roleKey)!.push(r);
          }
          Array.from(remainingByRole.entries()).forEach(([roleName, roleRows]) => {
            const rFte = roleRows.reduce((s, r) => s + r.fte, 0);
            const roleEmployees = new Set<string>();
            roleRows.forEach((r) => r.employees.forEach((e) => roleEmployees.add(e.id)));
            roleGroups.push({
              role: roleName === "(No Role)" ? "" : roleName,
              projectRoleId: null,
              requiredFte: 0,
              requiredQuantity: 0,
              rows: roleRows,
              totalFte: rFte,
              employeeCount: roleEmployees.size,
              filledCount: roleEmployees.size,
              unfilledCount: 0,
            });
            pFte += rFte;
            roleRows.forEach((r) => {
              r.employees.forEach((e) => { totalEmployees.add(e.id); allEmployeeIds.add(e.id); });
            });
          });

          roleGroups.sort((a, b) => (a.role || "zzz").localeCompare(b.role || "zzz"));
          const totalRequired = definedRoles.reduce((s, pr) => s + pr.quantity, 0);
          const neededPositions = Math.max(totalRequired, totalEmployees.size);

          projectGroups.push({
            projectName: projectName === "(No Project)" ? "" : projectName,
            projectId,
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
      });
    });
    return groups;
  }, [filteredRows, projects, clients, projectRolesMap]);

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
                  <th className="py-3 px-2 w-10" />
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
                            <span className="text-xs text-muted-foreground">
                              ({totalRows} row{totalRows !== 1 ? "s" : ""} · {group.employeeCount} employee{group.employeeCount !== 1 ? "s" : ""})
                            </span>
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-center font-bold">{formatFte(group.totalFte)}</td>
                        <td colSpan={2} className="py-2.5 px-3" />
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
                                <td colSpan={2} className="py-2 px-3" />
                              </tr>
                            )}

                            {/* ─── Project Groups (Level 3) ─── */}
                            {(showClientHeaders ? isClientExpanded : true) && cg.projects.map((pg) => {
                              const projectExpandKey = `${clientExpandKey}::${pg.projectName || "__none__"}`;
                              const isProjectExpanded = !collapsedProjects.has(projectExpandKey);
                              const totalRoleRows = pg.roles.reduce((s, r) => s + r.rows.length, 0);
                              // Always show project header when there's a real project, so
                              // the Add Role button is accessible on every project.
                              const showProjectHeader = !!pg.projectId;
                              const unfilled = Math.max(0, pg.neededPositions - pg.filledPositions);

                              return (
                                <React.Fragment key={projectExpandKey}>
                                  {showProjectHeader && (
                                    <tr
                                      className={`border-b border-border/40 border-l-4 ${color.border} cursor-pointer hover:brightness-95 transition-all bg-muted/30`}
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
                                            <Badge variant="outline" className="text-[9px] bg-amber-500/15 border-amber-500/50 text-amber-700 dark:text-amber-300 gap-0.5">
                                              <AlertTriangle className="h-2.5 w-2.5" />
                                              {unfilled} unfilled
                                            </Badge>
                                          )}
                                        </div>
                                      </td>
                                      <td className="py-1.5 px-3 text-center font-semibold text-xs">{formatFte(pg.totalFte)}</td>
                                      <td colSpan={2} className="py-1.5 px-3">
                                        {canManage && pg.projectId && (
                                          <button
                                            onClick={(e) => { e.stopPropagation(); setAddRoleProjectId(pg.projectId); }}
                                            className="text-[10px] text-primary hover:underline flex items-center gap-0.5"
                                          >
                                            <Plus className="h-3 w-3" /> Add Role
                                          </button>
                                        )}
                                      </td>
                                    </tr>
                                  )}

                                  {/* ─── Role Groups (Level 4) ─── */}
                                  {(showProjectHeader ? isProjectExpanded : true) && pg.roles.map((rg) => {
                                    const roleExpandKey = `${projectExpandKey}::${rg.role || "__none__"}`;
                                    const isRoleExpanded = !collapsedRoles.has(roleExpandKey);
                                    const showRoleHeader = rg.role && (pg.roles.length > 1 || rg.rows.length > 1 || rg.projectRoleId);

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
                                                {rg.projectRoleId ? (
                                                  <span className="text-[10px] text-muted-foreground">
                                                    ({rg.filledCount}/{rg.requiredQuantity} filled · {formatFte(rg.requiredFte)} FTE each)
                                                  </span>
                                                ) : (
                                                  <span className="text-[10px] text-muted-foreground">
                                                    ({rg.employeeCount} employee{rg.employeeCount !== 1 ? "s" : ""})
                                                  </span>
                                                )}
                                                {rg.unfilledCount > 0 && (
                                                  <Badge variant="outline" className="text-[9px] bg-amber-500/15 border-amber-500/50 text-amber-700 dark:text-amber-300 gap-0.5">
                                                    <AlertTriangle className="h-2.5 w-2.5" />
                                                    {rg.unfilledCount} unfilled
                                                  </Badge>
                                                )}
                                              </div>
                                            </td>
                                            <td className="py-1 px-3" />
                                            <td className="py-1 px-3 text-center font-semibold text-[11px]">
                                              {editingProjectRoleFte?.projectRoleId === rg.projectRoleId && rg.projectRoleId ? (
                                                <form onSubmit={(e) => { e.preventDefault(); saveProjectRoleQuantity(rg.projectRoleId!, editingProjectRoleFte.quantity, editingProjectRoleFte.requiredFte); }} className="flex items-center gap-1 justify-center" onClick={(e) => e.stopPropagation()}>
                                                  <input
                                                    type="number" min="1" max="50"
                                                    value={editingProjectRoleFte.quantity}
                                                    onChange={(e) => setEditingProjectRoleFte((p) => p ? { ...p, quantity: e.target.value } : p)}
                                                    onBlur={() => saveProjectRoleQuantity(rg.projectRoleId!, editingProjectRoleFte.quantity, editingProjectRoleFte.requiredFte)}
                                                    autoFocus
                                                    className="w-10 h-5 text-[10px] text-center border border-primary rounded bg-background focus:outline-none"
                                                    title="Number of positions"
                                                  />
                                                  <span className="text-[9px] text-muted-foreground">slots</span>
                                                </form>
                                              ) : canManage && rg.projectRoleId ? (
                                                <button
                                                  onClick={(e) => { e.stopPropagation(); setEditingProjectRoleFte({ projectRoleId: rg.projectRoleId!, quantity: String(rg.requiredQuantity), requiredFte: rg.requiredFte }); }}
                                                  className="text-blue-600 hover:text-primary cursor-pointer"
                                                  title="Click to edit positions needed"
                                                >
                                                  {formatFte(rg.totalFte)}
                                                </button>
                                              ) : (
                                                formatFte(rg.totalFte)
                                              )}
                                            </td>
                                            <td className="py-1 px-3" />
                                            <td className="py-1 px-2">
                                              {canManage && rg.projectRoleId && (
                                                <button
                                                  onClick={(e) => { e.stopPropagation(); if (confirm("Delete this role requirement?")) handleDeleteRole(rg.projectRoleId!); }}
                                                  className="p-0.5 rounded hover:bg-destructive/10 text-muted-foreground/40 hover:text-destructive transition-colors"
                                                  title="Remove role requirement"
                                                >
                                                  <X className="h-3 w-3" />
                                                </button>
                                              )}
                                            </td>
                                          </tr>
                                        )}

                                        {/* ─── Employee Rows (Level 5) ─── */}
                                        {(showRoleHeader ? isRoleExpanded : true) && rg.rows.map((row) => {
                                          const singleAssignment = row.source === "assignment" && row.assignmentIds.length === 1 && row.employees.length === 1;
                                          const assignmentId = singleAssignment ? row.assignmentIds[0] : null;

                                          return (
                                            <tr
                                              key={row.key}
                                              className={`border-b border-border/10 border-l-4 ${color.border} ${color.rowBg} transition-colors bg-background ${
                                                fteHighlight && row.employees.some((e) => e.id === fteHighlight) ? "!bg-primary/5" : ""
                                              }`}
                                            >
                                              {/* Offering (empty - shown in header) */}
                                              <td className="py-1.5 px-4 text-muted-foreground text-xs" />
                                              {/* Client */}
                                              <td className="py-1.5 px-3 text-xs text-muted-foreground">
                                                {row.clientId ? (
                                                  <Link href={`/clients/${row.clientId}`} className="hover:text-primary hover:underline">
                                                    {row.clientName}
                                                  </Link>
                                                ) : row.clientName || <span className="text-muted-foreground/60">—</span>}
                                              </td>
                                              {/* Project */}
                                              <td className="py-1.5 px-3 text-xs text-muted-foreground">
                                                {row.projectId ? (
                                                  <Link href={`/projects/${row.projectId}`} className="hover:text-primary hover:underline">
                                                    {row.projectName}
                                                  </Link>
                                                ) : row.projectName || <span className="text-muted-foreground/60">—</span>}
                                              </td>
                                              {/* Location */}
                                              <td className="py-1.5 px-3 text-xs text-muted-foreground hidden md:table-cell">
                                                {row.location ? (
                                                  <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{row.location}</span>
                                                ) : <span className="text-muted-foreground/60">—</span>}
                                              </td>
                                              {/* Manager / Lead */}
                                              <td className="py-1.5 px-3 text-xs text-muted-foreground">
                                                {row.managerId ? (
                                                  <Link href={`/team/${row.managerId}`} className="hover:text-primary hover:underline">
                                                    {row.managerName}
                                                  </Link>
                                                ) : row.managerName || <span className="text-muted-foreground/60">—</span>}
                                              </td>
                                              {/* Role Required - inline editable dropdown */}
                                              <td className="py-1.5 px-3 text-xs">
                                                {editingRole?.assignmentId === assignmentId && assignmentId ? (
                                                  <select
                                                    value={editingRole.value}
                                                    onChange={(e) => { saveRole(assignmentId, e.target.value); }}
                                                    onBlur={() => setEditingRole(null)}
                                                    autoFocus
                                                    className="h-6 text-[10px] rounded border border-primary bg-background px-1 focus:outline-none"
                                                  >
                                                    <option value="">Select role...</option>
                                                    {roleDefinitions.map((rd) => (
                                                      <option key={rd.id} value={rd.id}>{rd.name}</option>
                                                    ))}
                                                  </select>
                                                ) : singleAssignment && canManage ? (
                                                  <button
                                                    onClick={() => setEditingRole({ assignmentId: assignmentId!, value: "" })}
                                                    className="cursor-pointer hover:opacity-70"
                                                    title="Click to change role"
                                                  >
                                                    {row.roleRequired ? (
                                                      <Badge variant="outline" className="text-[10px] font-normal">{row.roleRequired}</Badge>
                                                    ) : <span className="text-muted-foreground/60 hover:text-primary">Set role</span>}
                                                  </button>
                                                ) : row.roleRequired ? (
                                                  <Badge variant="outline" className="text-[10px] font-normal">{row.roleRequired}</Badge>
                                                ) : <span className="text-muted-foreground/60">—</span>}
                                              </td>
                                              {/* FTE - inline editable */}
                                              <td className="py-1.5 px-3 text-center">
                                                {editingFte?.assignmentId === assignmentId && assignmentId ? (
                                                  <form onSubmit={(e) => { e.preventDefault(); saveFte(assignmentId, editingFte.value); }} className="flex items-center gap-0.5">
                                                    <input
                                                      type="number" step="0.05" min="0" max="2"
                                                      value={editingFte.value}
                                                      onChange={(e) => setEditingFte({ assignmentId, value: e.target.value })}
                                                      onBlur={() => saveFte(assignmentId, editingFte.value)}
                                                      autoFocus
                                                      className="w-14 h-6 text-xs text-center border border-primary rounded bg-background focus:outline-none"
                                                    />
                                                  </form>
                                                ) : singleAssignment && canManage ? (
                                                  <button
                                                    onClick={() => setEditingFte({ assignmentId: assignmentId!, value: String(row.fte) })}
                                                    className="font-bold text-sm text-blue-600 hover:text-primary cursor-pointer"
                                                    title="Click to edit FTE"
                                                    onMouseEnter={() => setFteHighlight(row.employees[0]?.id)}
                                                    onMouseLeave={() => setFteHighlight(null)}
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
                                              <td className="py-1.5 px-3">
                                                <div className="space-y-0.5">
                                                  {row.employees.map((emp) => (
                                                    <div key={emp.id}>
                                                      <Link href={`/team/${emp.id}`} className="text-xs font-semibold text-foreground hover:text-primary hover:underline">
                                                        {emp.name}
                                                      </Link>
                                                    </div>
                                                  ))}
                                                  {row.employees.length === 0 && (
                                                    <span className="text-xs text-muted-foreground italic">—</span>
                                                  )}
                                                </div>
                                              </td>
                                              {/* Remove button */}
                                              <td className="py-1.5 px-2">
                                                {singleAssignment && canManage ? (
                                                  <button
                                                    onClick={() => handleRemoveAssignment(row.assignmentIds[0], row.employees[0].name)}
                                                    className="p-1 rounded hover:bg-destructive/10 text-muted-foreground/40 hover:text-destructive transition-colors"
                                                    title={`Remove ${row.employees[0].name} from this assignment`}
                                                  >
                                                    <X className="h-3.5 w-3.5" />
                                                  </button>
                                                ) : null}
                                              </td>
                                            </tr>
                                          );
                                        })}

                                        {/* ─── Unfilled Slots from ProjectRole ─── */}
                                        {(showRoleHeader ? isRoleExpanded : true) && rg.unfilledCount > 0 && Array.from({ length: rg.unfilledCount }).map((_, i) => (
                                          <tr
                                            key={`unfilled-${roleExpandKey}-${i}`}
                                            className={`border-b border-border/10 border-l-4 ${color.border} transition-colors bg-background ${canManage ? "hover:bg-amber-50/50 cursor-pointer" : ""}`}
                                            onClick={canManage && pg.projectId ? () => {
                                              const proj = projects.find((p) => p.id === pg.projectId);
                                              setQuickAssignCtx({
                                                projectId: pg.projectId!,
                                                // Always use the project's own clientId as source of truth
                                                clientId: proj?.clientId || undefined,
                                                projectRoleId: rg.projectRoleId || undefined,
                                                roleDefinitionId: rg.projectRoleId ? projectRoles.find((pr) => pr.id === rg.projectRoleId)?.roleDefinition?.id : undefined,
                                                roleName: rg.role || undefined,
                                                requiredFte: rg.requiredFte || 1,
                                                serviceOfferingId: proj?.serviceOfferingId || undefined,
                                              });
                                            } : undefined}
                                          >
                                            <td className="py-1.5 px-4" />
                                            <td className="py-1.5 px-3 text-xs text-muted-foreground">
                                              {cg.clientId ? (
                                                <Link
                                                  href={`/clients/${cg.clientId}`}
                                                  className="hover:text-primary hover:underline"
                                                  onClick={(e) => e.stopPropagation()}
                                                >
                                                  {cg.clientName}
                                                </Link>
                                              ) : cg.clientName || <span className="text-muted-foreground/60">—</span>}
                                            </td>
                                            <td className="py-1.5 px-3 text-xs text-muted-foreground">
                                              {pg.projectId ? (
                                                <Link
                                                  href={`/projects/${pg.projectId}`}
                                                  className="hover:text-primary hover:underline"
                                                  onClick={(e) => e.stopPropagation()}
                                                >
                                                  {pg.projectName}
                                                </Link>
                                              ) : pg.projectName || <span className="text-muted-foreground/60">—</span>}
                                            </td>
                                            <td className="py-1.5 px-3 hidden md:table-cell" />
                                            <td className="py-1.5 px-3" />
                                            <td className="py-1.5 px-3">
                                              <Badge variant="outline" className="text-[10px] font-normal border-dashed border-amber-500/50 text-amber-700 dark:text-amber-300">{rg.role}</Badge>
                                            </td>
                                            <td className="py-1.5 px-3 text-center">
                                              <span className="text-xs text-muted-foreground">{formatFte(rg.requiredFte)}</span>
                                            </td>
                                            <td className="py-1.5 px-3">
                                              <div className="flex items-center gap-1.5 text-xs text-amber-600">
                                                <UserPlus className="h-3.5 w-3.5" />
                                                <span className="font-medium">Open — click to fill</span>
                                              </div>
                                            </td>
                                            <td className="py-1.5 px-2">
                                              {canManage && (
                                                <UserCheck className="h-3.5 w-3.5 text-muted-foreground/40" />
                                              )}
                                            </td>
                                          </tr>
                                        ))}
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
            roleDefinitions={roleDefinitions}
            defaultEmployeeId={addDialogDefaults.employeeId}
            defaultProjectId={addDialogDefaults.projectId}
            defaultClientId={addDialogDefaults.clientId}
            defaultServiceOfferingId={addDialogDefaults.serviceOfferingId}
            defaultProjectRoleId={addDialogDefaults.projectRoleId}
            defaultRoleName={addDialogDefaults.roleName}
            defaultRoleDefinitionId={addDialogDefaults.roleDefinitionId}
          />
          <ManageOfferingsDialog
            open={offeringsDialogOpen}
            onClose={() => setOfferingsDialogOpen(false)}
            serviceOfferings={serviceOfferings}
          />
        </>
      )}

      {/* Quick Assign Dialog — simple employee picker */}
      {quickAssignCtx && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setQuickAssignCtx(null)}>
          <div className="bg-background rounded-lg shadow-xl border p-5 w-full max-w-sm space-y-4" onClick={(e) => e.stopPropagation()}>
            <div>
              <h3 className="font-semibold text-sm">Assign Employee</h3>
              <p className="text-xs text-muted-foreground mt-1">
                {projects.find((p) => p.id === quickAssignCtx.projectId)?.name}
                {quickAssignCtx.roleName && <> — <span className="font-medium">{quickAssignCtx.roleName}</span></>}
                {" "}({formatFte(quickAssignCtx.requiredFte)} FTE)
              </p>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">Select Employee</label>
              <select
                autoFocus
                onChange={(e) => {
                  if (e.target.value) handleQuickAssign(e.target.value);
                }}
                className="w-full h-10 rounded border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="">Choose employee...</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}{u.jobTitle ? ` — ${u.jobTitle}` : ""}</option>
                ))}
              </select>
            </div>
            <div className="flex justify-end">
              <button onClick={() => setQuickAssignCtx(null)}
                className="px-3 py-1.5 text-sm rounded border border-input hover:bg-muted">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Add Project Role Dialog */}
      {addRoleProjectId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setAddRoleProjectId(null)}>
          <div className="bg-background rounded-lg shadow-xl border p-5 w-full max-w-md space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-sm">Add Role to Project</h3>
            <p className="text-xs text-muted-foreground">
              {projects.find((p) => p.id === addRoleProjectId)?.name}
            </p>
            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs font-medium">Role *</label>
                <select
                  value={addRoleForm.roleDefinitionId}
                  onChange={(e) => setAddRoleForm((f) => ({ ...f, roleDefinitionId: e.target.value, newRoleName: "" }))}
                  className="w-full h-9 rounded border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="">Select role...</option>
                  {roleDefinitions.map((rd) => (
                    <option key={rd.id} value={rd.id}>{rd.name}</option>
                  ))}
                  <option value="__new__">+ Add new role...</option>
                </select>
              </div>
              {addRoleForm.roleDefinitionId === "__new__" && (
                <div className="space-y-1">
                  <label className="text-xs font-medium">New Role Name *</label>
                  <input
                    value={addRoleForm.newRoleName}
                    onChange={(e) => setAddRoleForm((f) => ({ ...f, newRoleName: e.target.value }))}
                    placeholder="e.g. Lead Technician"
                    className="w-full h-9 rounded border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium">FTE per Position</label>
                  <input
                    type="number" step="0.05" min="0.05" max="2"
                    value={addRoleForm.requiredFte}
                    onChange={(e) => setAddRoleForm((f) => ({ ...f, requiredFte: e.target.value }))}
                    className="w-full h-9 rounded border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium">Quantity Needed</label>
                  <input
                    type="number" min="1" max="50"
                    value={addRoleForm.quantity}
                    onChange={(e) => setAddRoleForm((f) => ({ ...f, quantity: e.target.value }))}
                    className="w-full h-9 rounded border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setAddRoleProjectId(null)}
                className="px-3 py-1.5 text-sm rounded border border-input hover:bg-muted">Cancel</button>
              <button
                onClick={handleAddRole}
                disabled={!addRoleForm.roleDefinitionId || (addRoleForm.roleDefinitionId === "__new__" && !addRoleForm.newRoleName.trim())}
                className="px-3 py-1.5 text-sm rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >Add Role</button>
            </div>
          </div>
        </div>
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
