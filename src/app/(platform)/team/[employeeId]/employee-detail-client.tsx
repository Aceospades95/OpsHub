"use client";

import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import Link from "next/link";
import {
  User, Briefcase, BarChart3, FolderOpen, MapPin, Phone,
  Mail, Calendar, Users, FileText, ChevronRight,
  AlertTriangle, CheckCircle2,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface Assignment {
  id: string;
  allocationFte: number;
  status: string;
  role: string | null;
  function: string | null;
  notes: string | null;
  startDate: string | null;
  endDate: string | null;
  project: { id: string; name: string; status: string } | null;
  client: { id: string; name: string } | null;
  serviceOffering: { id: string; name: string } | null;
}

interface Employee {
  id: string;
  name: string;
  email: string;
  role: string;
  jobTitle: string | null;
  department: string | null;
  location: string | null;
  phone: string | null;
  avatar: string | null;
  isActive: boolean;
  createdAt: string;
  manager: { id: string; name: string; jobTitle: string | null; avatar: string | null } | null;
  directReports: { id: string; name: string; email: string; role: string; jobTitle: string | null; avatar: string | null }[];
  projectMembers: {
    id: string;
    role: string;
    project: {
      id: string;
      name: string;
      status: string;
      client: { id: string; name: string } | null;
    };
  }[];
  assignments: Assignment[];
}

interface ActivityLog {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  details: string | null;
  createdAt: string;
}

type TabKey = "overview" | "assignments" | "reporting" | "projects" | "activity";

const TABS: { key: TabKey; label: string; icon: React.ElementType }[] = [
  { key: "overview", label: "Overview", icon: User },
  { key: "assignments", label: "Assignments & Capacity", icon: BarChart3 },
  { key: "reporting", label: "Reporting", icon: Users },
  { key: "projects", label: "Projects", icon: FolderOpen },
  { key: "activity", label: "Activity", icon: FileText },
];

function formatFte(v: number): string {
  return v % 1 === 0 ? v.toFixed(0) : v.toFixed(2);
}

export function EmployeeDetailClient({
  employee, activity, canManage,
}: {
  employee: Employee;
  activity: ActivityLog[];
  canManage: boolean;
}) {
  const [activeTab, setActiveTab] = useState<TabKey>("overview");

  const totalFte = employee.assignments
    .filter((a) => a.status === "ACTIVE" || a.status === "PLANNED")
    .reduce((sum, a) => sum + a.allocationFte, 0);
  const remaining = 1.0 - totalFte;
  const isOver = totalFte > 1.0;
  const isFull = totalFte >= 0.95 && totalFte <= 1.0;

  return (
    <div className="space-y-6">
      {/* Profile Header Card */}
      <Card>
        <CardContent className="p-6">
          <div className="flex items-start gap-6">
            <Avatar name={employee.name} src={employee.avatar} size="lg" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <h2 className="text-xl font-bold">{employee.name}</h2>
                <Badge variant={employee.isActive ? "success" : "destructive"}>
                  {employee.isActive ? "Active" : "Inactive"}
                </Badge>
                <Badge variant={employee.role === "ADMIN" ? "default" : "secondary"}>{employee.role}</Badge>
              </div>
              {employee.jobTitle && <p className="text-sm text-primary/80 font-medium mt-1">{employee.jobTitle}</p>}
              <div className="flex items-center gap-4 mt-3 text-sm text-muted-foreground flex-wrap">
                <span className="flex items-center gap-1"><Mail className="h-3.5 w-3.5" />{employee.email}</span>
                {employee.phone && <span className="flex items-center gap-1"><Phone className="h-3.5 w-3.5" />{employee.phone}</span>}
                {employee.location && <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{employee.location}</span>}
                {employee.department && <span className="flex items-center gap-1"><Briefcase className="h-3.5 w-3.5" />{employee.department}</span>}
              </div>
            </div>
            {/* FTE Summary */}
            <div className="text-right shrink-0">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">FTE Allocation</p>
              <p className={`text-3xl font-bold ${isOver ? "text-red-600" : isFull ? "text-green-600" : ""}`}>{formatFte(totalFte)}</p>
              <p className="text-xs text-muted-foreground">
                {remaining > 0 ? `${formatFte(remaining)} available` : remaining < 0 ? `${formatFte(Math.abs(remaining))} over capacity` : "Fully allocated"}
              </p>
              <div className="h-1.5 w-24 bg-muted rounded-full overflow-hidden mt-1 ml-auto">
                <div
                  className={`h-full rounded-full ${isOver ? "bg-red-500" : isFull ? "bg-green-500" : totalFte > 0 ? "bg-yellow-500" : "bg-gray-300"}`}
                  style={{ width: `${Math.min(totalFte * 100, 100)}%` }}
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tab Navigation */}
      <div className="flex border-b border-border">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.key
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      {activeTab === "overview" && <OverviewTab employee={employee} totalFte={totalFte} />}
      {activeTab === "assignments" && <AssignmentsTab employee={employee} totalFte={totalFte} />}
      {activeTab === "reporting" && <ReportingTab employee={employee} />}
      {activeTab === "projects" && <ProjectsTab employee={employee} />}
      {activeTab === "activity" && <ActivityTab activity={activity} />}
    </div>
  );
}

function OverviewTab({ employee, totalFte }: { employee: Employee; totalFte: number }) {
  const remaining = 1.0 - totalFte;
  const activeAssignments = employee.assignments.filter((a) => a.status === "ACTIVE" || a.status === "PLANNED");

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-6">
        {/* Info Grid */}
        <Card>
          <CardHeader><CardTitle>Employee Information</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <InfoField label="Full Name" value={employee.name} />
              <InfoField label="Email" value={employee.email} />
              <InfoField label="Job Title" value={employee.jobTitle} />
              <InfoField label="Department" value={employee.department} />
              <InfoField label="Location" value={employee.location} />
              <InfoField label="Phone" value={employee.phone} />
              <InfoField label="System Role" value={employee.role} />
              <InfoField label="Status" value={employee.isActive ? "Active" : "Inactive"} />
              {employee.manager && (
                <div>
                  <p className="text-muted-foreground text-xs mb-0.5">Reports To</p>
                  <Link href={`/team/${employee.manager.id}`} className="text-primary hover:underline font-medium">
                    {employee.manager.name}
                  </Link>
                </div>
              )}
              <InfoField label="Member Since" value={new Date(employee.createdAt).toLocaleDateString()} />
            </div>
          </CardContent>
        </Card>

        {/* Capacity Overview */}
        <Card>
          <CardHeader><CardTitle>Capacity Overview</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Total Allocation</span>
              <span className={`text-lg font-bold ${totalFte > 1 ? "text-red-600" : totalFte >= 0.95 ? "text-green-600" : ""}`}>
                {formatFte(totalFte)} / 1.0 FTE
              </span>
            </div>
            <div className="h-3 bg-muted rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${totalFte > 1 ? "bg-red-500" : totalFte >= 0.95 ? "bg-green-500" : totalFte > 0 ? "bg-yellow-500" : "bg-gray-300"}`}
                style={{ width: `${Math.min(totalFte * 100, 100)}%` }}
              />
            </div>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div className="p-3 rounded-lg bg-muted/50">
                <p className="text-xs text-muted-foreground">Allocated</p>
                <p className="text-lg font-bold">{formatFte(totalFte)}</p>
              </div>
              <div className="p-3 rounded-lg bg-muted/50">
                <p className="text-xs text-muted-foreground">Available</p>
                <p className={`text-lg font-bold ${remaining < 0 ? "text-red-600" : remaining > 0 ? "text-green-600" : ""}`}>
                  {formatFte(Math.max(remaining, 0))}
                </p>
              </div>
              <div className="p-3 rounded-lg bg-muted/50">
                <p className="text-xs text-muted-foreground">Assignments</p>
                <p className="text-lg font-bold">{activeAssignments.length}</p>
              </div>
            </div>
            {totalFte > 1 && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>This employee is overallocated by {formatFte(totalFte - 1)} FTE.</span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Sidebar */}
      <div className="space-y-6">
        {/* Top Assignments */}
        <Card>
          <CardHeader><CardTitle>Current Assignments ({activeAssignments.length})</CardTitle></CardHeader>
          <CardContent>
            {activeAssignments.length === 0 ? (
              <p className="text-sm text-muted-foreground">No active assignments.</p>
            ) : (
              <div className="space-y-2">
                {activeAssignments.slice(0, 5).map((a) => (
                  <div key={a.id} className="flex items-center justify-between p-2 rounded border border-border text-sm">
                    <div className="min-w-0">
                      <p className="font-medium truncate">
                        {a.project ? (
                          <Link href={`/projects/${a.project.id}`} className="text-primary hover:underline">{a.project.name}</Link>
                        ) : a.client?.name || a.serviceOffering?.name || a.function || "General"}
                      </p>
                      {a.role && <p className="text-[10px] text-muted-foreground">{a.role}</p>}
                    </div>
                    <span className="font-bold text-xs shrink-0 ml-2">{formatFte(a.allocationFte)}</span>
                  </div>
                ))}
                {activeAssignments.length > 5 && (
                  <button onClick={() => {}} className="text-xs text-primary hover:underline">
                    +{activeAssignments.length - 5} more
                  </button>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Direct Reports */}
        {employee.directReports.length > 0 && (
          <Card>
            <CardHeader><CardTitle>Direct Reports ({employee.directReports.length})</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-2">
                {employee.directReports.map((report) => (
                  <Link key={report.id} href={`/team/${report.id}`}
                    className="flex items-center gap-2 rounded border border-border p-2 hover:bg-muted transition-colors">
                    <Avatar name={report.name} src={report.avatar} size="xs" />
                    <div className="min-w-0">
                      <span className="text-sm font-medium truncate block">{report.name}</span>
                      {report.jobTitle && <span className="text-[10px] text-muted-foreground">{report.jobTitle}</span>}
                    </div>
                    <Badge variant="outline" className="ml-auto text-[9px]">{report.role}</Badge>
                  </Link>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function AssignmentsTab({ employee, totalFte }: { employee: Employee; totalFte: number }) {
  const activeAssignments = employee.assignments.filter((a) => a.status === "ACTIVE" || a.status === "PLANNED");
  const completedAssignments = employee.assignments.filter((a) => a.status === "COMPLETED" || a.status === "ON_HOLD");

  return (
    <div className="space-y-6">
      {/* FTE Breakdown by type */}
      <Card>
        <CardHeader><CardTitle>FTE Allocation Breakdown</CardTitle></CardHeader>
        <CardContent>
          {activeAssignments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No active allocations.</p>
          ) : (
            <div className="space-y-3">
              {activeAssignments.map((a) => {
                const pct = (a.allocationFte / Math.max(totalFte, 1)) * 100;
                return (
                  <div key={a.id} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">
                          {a.project?.name || a.client?.name || a.serviceOffering?.name || a.function || "General"}
                        </span>
                        {a.role && <Badge variant="outline" className="text-[9px]">{a.role}</Badge>}
                        {a.serviceOffering && <Badge variant="secondary" className="text-[9px]">{a.serviceOffering.name}</Badge>}
                        <Badge variant={a.status === "ACTIVE" ? "success" : "warning"} className="text-[9px]">{a.status}</Badge>
                      </div>
                      <span className="font-bold">{formatFte(a.allocationFte)} FTE</span>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-primary/70 rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                    {a.notes && <p className="text-[10px] text-muted-foreground">{a.notes}</p>}
                    <div className="flex gap-3 text-[10px] text-muted-foreground">
                      {a.startDate && <span>Start: {new Date(a.startDate).toLocaleDateString()}</span>}
                      {a.endDate && <span>End: {new Date(a.endDate).toLocaleDateString()}</span>}
                    </div>
                  </div>
                );
              })}
              <div className="flex items-center justify-between pt-3 border-t border-border font-semibold text-sm">
                <span>Total</span>
                <span className={totalFte > 1 ? "text-red-600" : ""}>{formatFte(totalFte)} / 1.0 FTE</span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Past Assignments */}
      {completedAssignments.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Past / On Hold ({completedAssignments.length})</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {completedAssignments.map((a) => (
                <div key={a.id} className="flex items-center justify-between p-2 rounded border border-border text-sm opacity-60">
                  <div className="min-w-0">
                    <p className="font-medium truncate">
                      {a.project?.name || a.client?.name || a.serviceOffering?.name || a.function || "General"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs">{formatFte(a.allocationFte)} FTE</span>
                    <Badge variant="outline" className="text-[9px]">{a.status}</Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ReportingTab({ employee }: { employee: Employee }) {
  return (
    <div className="space-y-6">
      {/* Manager */}
      <Card>
        <CardHeader><CardTitle>Reports To</CardTitle></CardHeader>
        <CardContent>
          {employee.manager ? (
            <Link href={`/team/${employee.manager.id}`} className="flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-muted transition-colors">
              <Avatar name={employee.manager.name} src={employee.manager.avatar} size="md" />
              <div>
                <p className="font-semibold">{employee.manager.name}</p>
                {employee.manager.jobTitle && <p className="text-sm text-muted-foreground">{employee.manager.jobTitle}</p>}
              </div>
              <ChevronRight className="h-4 w-4 ml-auto text-muted-foreground" />
            </Link>
          ) : (
            <p className="text-sm text-muted-foreground">No manager assigned. This is a top-level employee.</p>
          )}
        </CardContent>
      </Card>

      {/* Direct Reports */}
      <Card>
        <CardHeader><CardTitle>Direct Reports ({employee.directReports.length})</CardTitle></CardHeader>
        <CardContent>
          {employee.directReports.length === 0 ? (
            <p className="text-sm text-muted-foreground">No direct reports.</p>
          ) : (
            <div className="space-y-2">
              {employee.directReports.map((report) => (
                <Link key={report.id} href={`/team/${report.id}`}
                  className="flex items-center gap-3 p-2.5 rounded border border-border hover:bg-muted transition-colors">
                  <Avatar name={report.name} src={report.avatar} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium truncate">{report.name}</p>
                    {report.jobTitle && <p className="text-xs text-muted-foreground">{report.jobTitle}</p>}
                    <p className="text-[10px] text-muted-foreground">{report.email}</p>
                  </div>
                  <Badge variant="outline" className="text-[9px]">{report.role}</Badge>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ProjectsTab({ employee }: { employee: Employee }) {
  const statusColors: Record<string, string> = {
    ACTIVE: "success",
    PLANNING: "warning",
    ON_HOLD: "secondary",
    COMPLETED: "outline",
  };

  return (
    <Card>
      <CardHeader><CardTitle>Project Memberships ({employee.projectMembers.length})</CardTitle></CardHeader>
      <CardContent>
        {employee.projectMembers.length === 0 ? (
          <p className="text-sm text-muted-foreground">Not assigned to any projects.</p>
        ) : (
          <div className="space-y-2">
            {employee.projectMembers.map((pm) => {
              // Find matching assignment for FTE data
              const assignment = employee.assignments.find((a) => a.project?.id === pm.project.id && (a.status === "ACTIVE" || a.status === "PLANNED"));
              return (
                <Link key={pm.id} href={`/projects/${pm.project.id}`}
                  className="flex items-center gap-3 p-3 rounded border border-border hover:bg-muted transition-colors">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{pm.project.name}</p>
                    {pm.project.client && <p className="text-xs text-muted-foreground">Client: {pm.project.client.name}</p>}
                  </div>
                  <Badge variant="outline" className="text-[9px]">{pm.role}</Badge>
                  <Badge variant={(statusColors[pm.project.status] || "outline") as "success" | "warning" | "secondary" | "outline"} className="text-[9px]">{pm.project.status}</Badge>
                  {assignment && <span className="text-xs font-bold">{formatFte(assignment.allocationFte)} FTE</span>}
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </Link>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ActivityTab({ activity }: { activity: ActivityLog[] }) {
  return (
    <Card>
      <CardHeader><CardTitle>Recent Activity</CardTitle></CardHeader>
      <CardContent>
        {activity.length === 0 ? (
          <p className="text-sm text-muted-foreground">No recent activity.</p>
        ) : (
          <div className="space-y-3">
            {activity.map((log) => (
              <div key={log.id} className="flex items-start gap-3 text-sm">
                <div className="mt-0.5 h-2 w-2 rounded-full bg-primary shrink-0" />
                <div>
                  <p>
                    <Badge variant="outline" className="mr-1 text-[9px]">{log.action}</Badge>
                    <span className="font-medium">{log.entityType}</span>
                    {log.details && <span className="text-muted-foreground"> — {log.details}</span>}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(log.createdAt), { addSuffix: true })}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function InfoField({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <p className="text-muted-foreground text-xs mb-0.5">{label}</p>
      <p className="font-medium">{value || "—"}</p>
    </div>
  );
}
