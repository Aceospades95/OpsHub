"use client";

import React, { useState, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ChevronDown, ChevronRight, AlertTriangle, Filter, BarChart3,
  ArrowUpDown, Plus, MapPin,
} from "lucide-react";
import Link from "next/link";
import {
  UserData, ProjectData, ClientData, ServiceOfferingData,
  getAllocationStatus, getAllocationBadge, computeEmployeeFte, formatFte,
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

// One row per assignment line (like reference spreadsheet)
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

// Color bands for offering groups (matches reference image)
const OFFERING_COLORS = [
  { border: "border-l-emerald-500", bg: "bg-emerald-500/5", header: "bg-emerald-500/10" },
  { border: "border-l-blue-500", bg: "bg-blue-500/5", header: "bg-blue-500/10" },
  { border: "border-l-amber-500", bg: "bg-amber-500/5", header: "bg-amber-500/10" },
  { border: "border-l-purple-500", bg: "bg-purple-500/5", header: "bg-purple-500/10" },
  { border: "border-l-rose-500", bg: "bg-rose-500/5", header: "bg-rose-500/10" },
  { border: "border-l-cyan-500", bg: "bg-cyan-500/5", header: "bg-cyan-500/10" },
  { border: "border-l-orange-500", bg: "bg-orange-500/5", header: "bg-orange-500/10" },
  { border: "border-l-pink-500", bg: "bg-pink-500/5", header: "bg-pink-500/10" },
  { border: "border-l-teal-500", bg: "bg-teal-500/5", header: "bg-teal-500/10" },
  { border: "border-l-indigo-500", bg: "bg-indigo-500/5", header: "bg-indigo-500/10" },
];

type SortField = "offering" | "manager" | "client" | "project" | "fte";
type SortDir = "asc" | "desc";

export function StaffingMatrix({ users, projects, clients, serviceOfferings, search, canManage }: StaffingMatrixProps) {
  const [expandedOfferings, setExpandedOfferings] = useState<Set<string>>(new Set(["__all__"]));
  const [offeringFilter, setOfferingFilter] = useState("");
  const [clientFilter, setClientFilter] = useState("");
  const [managerFilter, setManagerFilter] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const [sortField, setSortField] = useState<SortField>("offering");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [offeringsDialogOpen, setOfferingsDialogOpen] = useState(false);

  const toggleOffering = (key: string) => {
    setExpandedOfferings((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const toggleSort = (field: SortField) => {
    if (sortField === field) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDir("asc"); }
  };

  // Build rows from Assignments AND ProjectMembers (single source of truth)
  const rows: MatrixRow[] = useMemo(() => {
    const rowMap = new Map<string, MatrixRow>();
    // Track which user+project combos have Assignment rows, so we can fill in from ProjectMembers
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
          pm.project.name.toLowerCase().includes(q) ||
          pm.project.clientId?.toLowerCase().includes(q)
        );
        if (!matchesUser && !matchesAssignment && !matchesProject) continue;
      }

      // 1) Build rows from explicit Assignments
      for (const assignment of user.assignments) {
        const offeringName = assignment.serviceOffering?.name || assignment.function || "Unassigned";
        const offeringId = assignment.serviceOffering?.id || null;
        const clientName = assignment.client?.name || "";
        const clientId = assignment.client?.id || null;
        const projectName = assignment.project?.name || "";
        const projectId = assignment.project?.id || null;
        const role = assignment.role || "";

        if (projectId) assignmentProjectKeys.add(`${user.id}::${projectId}`);

        const managerName = user.manager?.name || "";
        const key = `${offeringName}::${managerName}::${clientName}::${projectName}::${role}`;

        if (!rowMap.has(key)) {
          rowMap.set(key, {
            key,
            offering: offeringName,
            offeringId,
            managerName,
            managerId: user.managerId,
            clientName,
            clientId,
            projectName,
            projectId,
            location: user.location || "",
            roleRequired: role,
            fte: 0,
            employees: [],
            notes: assignment.notes || "",
            assignmentIds: [],
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

      // 2) Build rows from ProjectMembers that have no corresponding Assignment
      for (const pm of user.projectMembers) {
        if (assignmentProjectKeys.has(`${user.id}::${pm.project.id}`)) continue;

        const projectName = pm.project.name;
        const projectId = pm.project.id;
        const projectStatus = pm.project.status;
        const clientId = pm.project.clientId || null;
        // Resolve client name from the clients prop if available
        const clientName = clientId
          ? (clients.find((c) => c.id === clientId)?.name || "")
          : "";
        const role = pm.role || "";
        const managerName = user.manager?.name || "";

        const offeringName = "Project Staffing";
        const key = `pm::${managerName}::${clientName}::${projectName}::${role}::${user.id}`;

        if (!rowMap.has(key)) {
          rowMap.set(key, {
            key,
            offering: offeringName,
            offeringId: null,
            managerName,
            managerId: user.managerId,
            clientName,
            clientId,
            projectName,
            projectId,
            location: user.location || "",
            roleRequired: role,
            fte: 0,
            employees: [],
            notes: `From project membership (${projectStatus})`,
            assignmentIds: [],
            source: "project-member",
          });
        }

        const row = rowMap.get(key)!;
        if (!row.employees.find((e) => e.id === user.id)) {
          row.employees.push({ id: user.id, name: user.name, jobTitle: user.jobTitle });
        }
      }

      // 3) Show unassigned employees (no assignments AND no project memberships)
      if (user.assignments.length === 0 && user.projectMembers.length === 0) {
        const key = `Unassigned::::::::${user.id}`;
        rowMap.set(key, {
          key,
          offering: "Unassigned",
          offeringId: null,
          managerName: user.manager?.name || "",
          managerId: user.managerId,
          clientName: "",
          clientId: null,
          projectName: "",
          projectId: null,
          location: user.location || "",
          roleRequired: user.role || "",
          fte: 0,
          employees: [{ id: user.id, name: user.name, jobTitle: user.jobTitle }],
          notes: "",
          assignmentIds: [],
          source: "unassigned",
        });
      }
    }

    return Array.from(rowMap.values());
  }, [users, clients, search]);

  // Apply filters
  const filteredRows = useMemo(() => {
    let result = rows;
    if (offeringFilter) result = result.filter((r) => r.offering === offeringFilter);
    if (clientFilter) result = result.filter((r) => r.clientName === clientFilter);
    if (managerFilter) result = result.filter((r) => r.managerName === managerFilter);
    if (locationFilter) result = result.filter((r) => r.location === locationFilter);

    // Sort
    result = [...result].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "offering": cmp = a.offering.localeCompare(b.offering) || a.clientName.localeCompare(b.clientName) || a.projectName.localeCompare(b.projectName); break;
        case "manager": cmp = a.managerName.localeCompare(b.managerName); break;
        case "client": cmp = a.clientName.localeCompare(b.clientName); break;
        case "project": cmp = a.projectName.localeCompare(b.projectName); break;
        case "fte": cmp = a.fte - b.fte; break;
      }
      return sortDir === "desc" ? -cmp : cmp;
    });
    return result;
  }, [rows, offeringFilter, clientFilter, managerFilter, locationFilter, sortField, sortDir]);

  // Group rows by offering
  const offeringGroups = useMemo(() => {
    const groups = new Map<string, MatrixRow[]>();
    for (const row of filteredRows) {
      if (!groups.has(row.offering)) groups.set(row.offering, []);
      groups.get(row.offering)!.push(row);
    }
    return groups;
  }, [filteredRows]);

  // Extract unique values for filter dropdowns
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

  // Summary metrics
  const metrics = useMemo(() => {
    const totalFte = filteredRows.reduce((s, r) => s + r.fte, 0);
    const uniqueEmployees = new Set(filteredRows.flatMap((r) => r.employees.map((e) => e.id)));
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
      uniqueEmployees: uniqueEmployees.size,
      headcount: users.length,
      overCount, fullyCount, underCount, unassignedCount,
    };
  }, [filteredRows, users]);

  const hasFilters = offeringFilter || clientFilter || managerFilter || locationFilter;

  const SortHeader = ({ field, children, className = "" }: { field: SortField; children: React.ReactNode; className?: string }) => (
    <button onClick={() => toggleSort(field)} className={`flex items-center gap-1 font-semibold hover:text-primary transition-colors ${className}`}>
      {children}
      <ArrowUpDown className={`h-3 w-3 ${sortField === field ? "text-primary" : "text-muted-foreground/50"}`} />
    </button>
  );

  return (
    <div className="space-y-4">
      {/* Summary Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        <MetricCard label="Headcount" value={metrics.headcount} />
        <MetricCard label="Total FTE" value={formatFte(metrics.totalFte)} />
        <MetricCard label="Assignments" value={metrics.assignmentRows} />
        <MetricCard label="Overallocated" value={metrics.overCount} variant={metrics.overCount > 0 ? "destructive" : "default"} />
        <MetricCard label="Fully Allocated" value={metrics.fullyCount} variant="success" />
        <MetricCard label="Available" value={metrics.underCount} variant="warning" />
        <MetricCard label="Unassigned" value={metrics.unassignedCount} />
      </div>

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
          <button onClick={() => { setOfferingFilter(""); setClientFilter(""); setManagerFilter(""); setLocationFilter(""); }}
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
              <button
                onClick={() => setOfferingsDialogOpen(true)}
                className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium border border-input rounded-md hover:bg-muted transition-colors"
              >
                Manage Offerings
              </button>
              <button
                onClick={() => setAddDialogOpen(true)}
                className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
              >
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
                {Array.from(offeringGroups.entries()).map(([offering, groupRows], groupIdx) => {
                  const color = OFFERING_COLORS[groupIdx % OFFERING_COLORS.length];
                  const isExpanded = expandedOfferings.has("__all__") || expandedOfferings.has(offering);
                  const groupFte = groupRows.reduce((s, r) => s + r.fte, 0);
                  const groupEmployeeCount = new Set(groupRows.flatMap((r) => r.employees.map((e) => e.id))).size;

                  return (
                    <React.Fragment key={offering}>
                      {/* Offering group header */}
                      <tr
                        className={`border-b border-border/60 border-l-4 ${color.border} ${color.header} cursor-pointer hover:bg-muted/30 transition-colors`}
                        onClick={() => toggleOffering(offering)}
                      >
                        <td colSpan={6} className="py-2.5 px-4">
                          <div className="flex items-center gap-2">
                            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            <span className="font-bold text-sm">{offering}</span>
                            {groupRows.some((r) => r.source === "project-member") && (
                              <Badge variant="outline" className="text-[9px] bg-blue-50 border-blue-200 text-blue-700">
                                From Projects
                              </Badge>
                            )}
                            <span className="text-xs text-muted-foreground">
                              ({groupRows.length} row{groupRows.length !== 1 ? "s" : ""} · {groupEmployeeCount} employee{groupEmployeeCount !== 1 ? "s" : ""})
                            </span>
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-center font-bold">{formatFte(groupFte)}</td>
                        <td colSpan={2} className="py-2.5 px-3" />
                      </tr>
                      {/* Assignment rows within offering */}
                      {isExpanded && groupRows.map((row, rowIdx) => (
                        <tr
                          key={row.key}
                          className={`border-b border-border/30 border-l-4 ${color.border} ${color.bg} hover:bg-muted/20 transition-colors`}
                        >
                          <td className="py-2 px-4 text-muted-foreground text-xs">
                            {/* Show offering name only on first row if not grouped */}
                          </td>
                          <td className="py-2 px-3 text-sm">
                            {row.managerId ? (
                              <Link href={`/team/${row.managerId}`} className="hover:text-primary hover:underline">
                                {row.managerName}
                              </Link>
                            ) : row.managerName || <span className="text-muted-foreground">—</span>}
                          </td>
                          <td className="py-2 px-3 text-sm font-medium">
                            {row.clientName || <span className="text-muted-foreground">—</span>}
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
                            ) : (
                              <span className={`font-bold text-sm ${row.fte > 1 ? "text-primary" : ""}`}>
                                {formatFte(row.fte)}
                              </span>
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
                                onClick={() => setAddDialogOpen(true)}
                                className="text-xs text-primary hover:underline flex items-center gap-1"
                              >
                                <Plus className="h-3 w-3" />
                                Create assignment
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

      {/* Dialogs */}
      {canManage && (
        <>
          <AddAssignmentDialog
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

function MetricCard({ label, value, variant = "default" }: {
  label: string;
  value: string | number;
  variant?: "default" | "success" | "warning" | "destructive";
}) {
  const colorMap = {
    default: "",
    success: "text-green-600",
    warning: "text-yellow-600",
    destructive: "text-red-600",
  };
  return (
    <div className="text-left p-3 rounded-lg border border-border bg-card">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{label}</p>
      <p className={`text-xl font-bold mt-0.5 ${colorMap[variant]}`}>{value}</p>
    </div>
  );
}
