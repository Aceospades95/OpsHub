/**
 * Generalized entity revalidation helpers.
 *
 * When you mutate an entity, you need to invalidate every page where that entity
 * can appear — not just the entity's own detail page. This module centralizes the
 * "which paths does this entity touch?" logic so individual server actions don't
 * have to remember.
 *
 * Rule of thumb: if you're about to write `revalidatePath("/team")` in a server
 * action, you probably want one of these helpers instead.
 *
 * See docs/entity-map.md for the canonical entity → pages mapping.
 */

import { revalidatePath } from "next/cache";

// ─── USER / EMPLOYEE ──────────────────────────────────────────
//
// A user can appear as: themselves (team page), team list, org chart, admin
// users list, manager on other users, assignee on tasks, account manager on
// clients, assignee on certifications, member/assignee on projects, comment
// author, activity log entry, dashboard widgets.

export function revalidateUser(
  userId: string,
  opts?: {
    /** Current managerId — will revalidate that manager's page */
    managerId?: string | null;
    /** Previous managerId if it changed — will revalidate their page too */
    previousManagerId?: string | null;
  }
) {
  // Canonical detail page
  revalidatePath(`/team/${userId}`);
  // List views that show this user
  revalidatePath("/team", "layout");
  revalidatePath("/admin/users");
  // Pages that reference users as members, assignees, authors, managers, etc.
  revalidatePath("/projects", "layout");
  revalidatePath("/tasks");
  revalidatePath("/certifications", "layout");
  revalidatePath("/clients", "layout");
  revalidatePath("/dashboard");

  // Manager relationship — changing a user's manager changes the manager's
  // direct reports list and the direct reports count on the manager's page
  if (opts?.managerId) {
    revalidatePath(`/team/${opts.managerId}`);
  }
  if (opts?.previousManagerId && opts.previousManagerId !== opts.managerId) {
    revalidatePath(`/team/${opts.previousManagerId}`);
  }
}

// ─── PROJECT ──────────────────────────────────────────────────
//
// A project appears on: projects list, project detail, client detail (client's
// project list), team staffing matrix, task lists, dashboard.

export function revalidateProject(
  projectId: string,
  opts?: {
    clientId?: string | null;
    previousClientId?: string | null;
  }
) {
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/projects", "layout");
  revalidatePath("/team", "layout"); // staffing matrix
  revalidatePath("/tasks");
  revalidatePath("/dashboard");

  if (opts?.clientId) {
    revalidatePath(`/clients/${opts.clientId}`);
  }
  if (opts?.previousClientId && opts.previousClientId !== opts.clientId) {
    revalidatePath(`/clients/${opts.previousClientId}`);
  }
}

// ─── CLIENT ───────────────────────────────────────────────────
//
// A client appears on: clients list, client detail, projects (shows client
// name), team staffing matrix (client is a grouping level), dashboard.

export function revalidateClient(clientId: string) {
  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/clients", "layout");
  revalidatePath("/projects", "layout"); // projects show client name
  revalidatePath("/team", "layout"); // staffing matrix groups by client
  revalidatePath("/dashboard");
}

// ─── ASSIGNMENT ────────────────────────────────────────────────
//
// An assignment doesn't have its own detail page — it's always shown as a row
// under a user, project, or matrix. But it touches multiple views.

export function revalidateAssignment(opts: {
  employeeId?: string | null;
  projectId?: string | null;
}) {
  revalidatePath("/team", "layout");
  revalidatePath("/projects", "layout");
  if (opts.employeeId) revalidatePath(`/team/${opts.employeeId}`);
  if (opts.projectId) revalidatePath(`/projects/${opts.projectId}`);
  revalidatePath("/dashboard"); // dashboard shows assignment counts
}

// ─── TASK ─────────────────────────────────────────────────────
//
// A task appears on: tasks list, project detail (project's tasks), client
// detail (client's tasks via projects), dashboard, assignee's team profile.

export function revalidateTask(opts: {
  projectId?: string | null;
  assigneeId?: string | null;
  clientId?: string | null;
  /** If the task is being reassigned, pass the previous assignee id */
  previousAssigneeId?: string | null;
}) {
  revalidatePath("/tasks");
  revalidatePath("/dashboard");
  if (opts.projectId) revalidatePath(`/projects/${opts.projectId}`);
  if (opts.clientId) revalidatePath(`/clients/${opts.clientId}`);
  if (opts.assigneeId) revalidatePath(`/team/${opts.assigneeId}`);
  if (opts.previousAssigneeId && opts.previousAssigneeId !== opts.assigneeId) {
    revalidatePath(`/team/${opts.previousAssigneeId}`);
  }
}

// ─── QUOTE ────────────────────────────────────────────────────
//
// A quote appears on: quotes list, quote editor/detail, client detail
// (client's quotes section), project detail (project's quotes section),
// dashboard.

export function revalidateQuote(
  quoteId: string,
  opts?: {
    clientId?: string | null;
    previousClientId?: string | null;
    projectId?: string | null;
    previousProjectId?: string | null;
  }
) {
  revalidatePath(`/quotes/${quoteId}`);
  revalidatePath(`/quotes/${quoteId}/edit`);
  revalidatePath("/quotes", "layout");
  revalidatePath("/dashboard");

  if (opts?.clientId) revalidatePath(`/clients/${opts.clientId}`);
  if (opts?.previousClientId && opts.previousClientId !== opts.clientId) {
    revalidatePath(`/clients/${opts.previousClientId}`);
  }
  if (opts?.projectId) revalidatePath(`/projects/${opts.projectId}`);
  if (opts?.previousProjectId && opts.previousProjectId !== opts.projectId) {
    revalidatePath(`/projects/${opts.previousProjectId}`);
  }
}

// ─── WORKFLOW TEMPLATE ────────────────────────────────────────
//
// A template appears on: /workflows/templates list, the editor page,
// and indirectly on instance views (instance shows template name).

export function revalidateWorkflowTemplate(templateId: string) {
  revalidatePath("/workflows", "layout");
  revalidatePath(`/workflows/templates/${templateId}/edit`);
  revalidatePath("/workflows/templates");
}

export function revalidateWorkflowEmailTemplate(templateId: string) {
  revalidatePath("/workflows/email-templates");
  revalidatePath(`/workflows/email-templates/${templateId}/edit`);
}

// ─── WORKFLOW INSTANCE ────────────────────────────────────────
//
// An instance appears on: /workflows/instances dashboard, the per-
// instance detail view, the subject's profile (employee or candidate),
// and possibly the dashboard via "my tasks" widget.

export function revalidateWorkflowInstance(
  instanceId: string,
  opts?: {
    subjectType?: "EMPLOYEE" | "CANDIDATE" | "CUSTOM";
    subjectId?: string | null;
  }
) {
  revalidatePath(`/workflows/instances/${instanceId}`);
  revalidatePath("/workflows/instances");
  revalidatePath("/workflows", "layout");
  revalidatePath("/dashboard");
  if (opts?.subjectType === "EMPLOYEE" && opts.subjectId) {
    revalidatePath(`/team/${opts.subjectId}`);
  }
}

// ─── COMMENT ──────────────────────────────────────────────────
//
// Comments are attached to a parent entity (project, client, task, etc.). A
// new comment affects the parent's detail page and the author's "recent
// activity" if we show that.

export function revalidateComment(opts: {
  entityType: "project" | "client" | "task" | "contract" | "document";
  entityId: string;
  authorId?: string | null;
}) {
  const pathMap = {
    project: `/projects/${opts.entityId}`,
    client: `/clients/${opts.entityId}`,
    task: "/tasks",
    contract: `/contracts/${opts.entityId}`,
    document: `/documents/${opts.entityId}`,
  } as const;
  revalidatePath(pathMap[opts.entityType]);
  revalidatePath("/dashboard"); // activity feeds
  if (opts.authorId) revalidatePath(`/team/${opts.authorId}`);
}
