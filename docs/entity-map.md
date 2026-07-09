# Entity Linking Map

This document is the source of truth for how entities are displayed, linked, and
revalidated across OpsHub. Every time you add a new place that displays an
entity, or add a mutation that changes one, check this document and update it.

The goal is simple: **every entity has exactly one canonical detail page, every
reference to that entity links there, and every mutation invalidates every page
where the entity could appear.**

## Rules

1. **Canonical URL** — Each entity has exactly one detail page. Don't create
   parallel detail pages (e.g., `/admin/users/{id}` AND `/team/{id}`). If you
   need an "admin" variant, redirect it to the canonical page.
2. **Always link** — Any display of an entity name, avatar, or reference must
   be wrapped in `<Link href={canonicalUrl}>` unless it's inside the canonical
   page itself.
3. **Use the helper** — Every mutation that touches an entity calls the
   appropriate `revalidate<Entity>()` helper from `@/lib/revalidate-entity`,
   not piecemeal `revalidatePath()` calls.
4. **Pass related IDs** — If a mutation changes a foreign key (e.g., user's
   manager), pass both the new and previous ID to the helper so both related
   pages get revalidated.

## Entity → Canonical Page → Helper

| Entity | Canonical page | Helper | Related paths that get revalidated |
|---|---|---|---|
| User / Employee | `/team/{id}` | `revalidateUser(id, { managerId?, previousManagerId? })` | `/team`, `/admin/users`, `/projects/*`, `/tasks`, `/certifications/*`, `/clients/*`, `/dashboard`, previous + new manager's page |
| Project | `/projects/{id}` | `revalidateProject(id, { clientId?, previousClientId? })` | `/projects`, `/team` (staffing matrix), `/tasks`, `/dashboard`, client detail page |
| Client | `/clients/{id}` | `revalidateClient(id)` | `/clients`, `/projects`, `/team`, `/dashboard` |
| Assignment | (no standalone page — shown on user, project, team) | `revalidateAssignment({ employeeId?, projectId? })` | `/team`, `/projects`, employee profile, project detail, `/dashboard` |
| Task | (list page `/tasks`) | `revalidateTask({ projectId?, assigneeId?, clientId?, previousAssigneeId? })` | `/tasks`, `/dashboard`, project detail, client detail, assignee profile |
| Comment | (attached to parent entity) | `revalidateComment({ entityType, entityId, authorId? })` | parent entity's detail page, `/dashboard`, author profile |
| Quote | `/quotes/{id}` | `revalidateQuote(id, { clientId?, previousClientId?, projectId?, previousProjectId? })` | `/quotes`, `/quotes/{id}/edit`, `/dashboard`, client detail, project detail |
| Contract | `/contracts/{id}` | `revalidateContract(id, { clientId?, previousClientId?, projectId?, previousProjectId? })` | `/contracts` tree, `/dashboard`, old + new client detail, old + new project detail |
| Certification | `/certifications/{id}` | `revalidateCertification(id, { clientId?, previousClientId?, assigneeId?, previousAssigneeId? })` | `/certifications`, `/dashboard`, old + new assignee profile, old + new client detail |

## Where the Client entity appears (and how to link)

Every `client.name`, `project.client.name`, `task.client.name`, etc. must link
to `/clients/{client.id}`.

| Location | Component | Linked? |
|---|---|---|
| Clients list page | `clients/page.tsx` | ✅ |
| Client detail (canonical) | `clients/[clientId]/page.tsx` | N/A (self) |
| Projects list grouped by client | `projects-page-client.tsx` | ✅ |
| Contracts tree by client | `contracts/page.tsx` | ✅ |
| Tasks page task rows | `tasks/page.tsx` | ✅ |
| Dashboard task rows | `dashboard/page.tsx` | ✅ |
| Staffing matrix client header | `staffing-matrix.tsx` | ✅ |
| Staffing matrix data rows | `staffing-matrix.tsx` | ✅ |
| Staffing matrix unfilled slots | `staffing-matrix.tsx` | ✅ |
| Search results | `search/page.tsx` | ✅ |

Known limitations (not bugs, HTML constraint):
- Certification list rows show `cert.client.name` as text because the whole row
  is a `<Link>` to `/certifications/{id}` — can't nest links. The cert detail
  page itself properly links to the client.
- Widget cards with a clickable card wrapper (widget-recent-projects, widget-
  contract-alerts, widget-recent-contracts) show client name as text for the
  same reason.

## Global Search coverage

`search/page.tsx` queries and returns results for:

- **Clients** — by name, description (permission-gated)
- **Projects** — by name, description (permission-gated)
- **Contracts** — by title, description (permission-gated)
- **Suppliers** — by name, notes, quick-contact name, and contact-rolodex
  names (permission-gated)
- **Subcontractors** — by name, legal name, description, primary contact
- **Partnerships** — by name, legal name, description, industry, primary contact
- **Vehicles (fleet)** — by nickname, make, model, VIN, license plate —
  scope-filtered for assigned drivers
- **Bids** — by title, solicitation number, agency (permission-gated)
- **Tasks** — by title, description — results deep-link to parent project or client
- **Team members** — by name, email, jobTitle, department — links to `/team/{id}`
- **Intranet resources** — by title, description, content — only published items,
  permission-gated (fixes the Time Off bug where HR entries were invisible)

The Cmd-K palette (`quickSearch` in `src/actions/search.ts`) covers
employees, clients, projects, suppliers (incl. contact names), contracts,
quotes, tools, vehicles, bids, and intranet with the same permission +
scope gates. **Disciplinary reports are deliberately excluded from both search
surfaces** — search gates on module `canView`, which can't express the
HR-roles-minus-subject rule.

When you add a new module that has user-facing content, add it to this list,
to the search query, and to `quickSearch`.

## Where the Project entity appears (and how to link)

Every `project.name`, `task.project.name`, `cert.project.name`, etc. must link to
`/projects/{project.id}`.

| Location | Component | Linked? |
|---|---|---|
| Projects list page | `projects-page-client.tsx` | ✅ |
| Project detail (canonical) | `projects/[projectId]/page.tsx` | N/A (self) |
| Dashboard My Tasks widget | `dashboard/page.tsx` | ✅ |
| Dashboard widget file | `widget-my-tasks.tsx` | ✅ |
| Dashboard recent projects | `widget-recent-projects.tsx` | ✅ |
| Dashboard project status | `widget-project-status.tsx` | ✅ |
| Dashboard recent documents | `widget-recent-documents.tsx` | ✅ |
| Tasks page | `tasks/page.tsx` | ✅ |
| Team staffing matrix | `staffing-matrix.tsx` | ✅ |
| Team profile projects tab | `employee-detail-client.tsx` | ✅ |
| Team employee list grid | `employee-list.tsx` | ✅ |
| Client detail project list | `clients/[clientId]/page.tsx` | ✅ |
| Contract detail project link | `contracts/[contractId]/page.tsx` | ✅ |
| Search results | `search/page.tsx` | ✅ |
| Tool detail project list | `tools/[toolId]/tool-projects.tsx` | ✅ |
| My View "My projects" card | `my/page.tsx` | ✅ |
| My View all-projects overview (inline editable) | `my/my-projects-overview.tsx` | ✅ |

## Mutation audit for Project

| Action | File | Helper call | Notes |
|---|---|---|---|
| `createProject` | `projects.ts` | `revalidateProject(id, { clientId })` | Revalidates new client |
| `updateProject` | `projects.ts` | `revalidateProject(id, { clientId, previousClientId })` | Looks up previous client before update |
| `deleteProject` | `projects.ts` | `revalidateProject(id, { clientId })` | Revalidates client too |
| `addProjectMember` | `projects.ts` | `revalidatePath(project)` + `revalidateUser(userId)` | Member's team page shows projects |
| `removeProjectMember` | `projects.ts` | `revalidatePath(project)` + `revalidateUser(userId)` | Looks up member before delete |
| `createMilestone` / `toggleMilestone` / `deleteMilestone` | `projects.ts` | `revalidatePath(project)` | Scoped to the parent project |
| `addMilestoneAssignee` | `projects.ts` | Looks up milestone's project + `revalidateUser(userId)` | Both project + user profile refresh |
| `removeMilestoneAssignee` | `projects.ts` | Looks up before delete + revalidates both | |
| `linkToolToProject` | `projects.ts` | `revalidatePath(project)` | Only affects project detail |
| `createContract` | `contracts.ts` | `revalidatePath(contracts/client/project)` | If contract has projectId/clientId |
| `updateContract` | `contracts.ts` | Revalidates old + new project/client | Looks up previous before update |
| `deleteContract` | `contracts.ts` | `revalidatePath(contracts/client/project)` | If contract had projectId/clientId |
| `createDocument` / `deleteDocument` | `documents.ts` | `revalidatePath(/projects/{id})` | |
| `updateDocument` / `restoreDocumentVersion` | `documents.ts` | Revalidates both document page and parent project | |
| `createTask` / `updateTask` / `deleteTask` / `updateTaskStatus` | `tasks.ts` | `revalidateTask({ projectId, clientId, assigneeId, previousAssigneeId? })` | |
| `updateProjectStatusInline` / `updateProjectNotesInline` / `updateProjectOwnerInline` | `projects.ts` | `revalidateProject(id, { clientId })` | Narrow single-field saves from the /my overview table; same three-gate convention |
| `assignTaskProject` | `tasks.ts` | `revalidateTask({ old + new projectId/clientId, assigneeId })` | Files a task under a project; clientId is DERIVED from the project |
| `createContract` / `updateContract` / `deleteContract` / `linkContractToProject` / `unlinkContractFromProject` | `contracts.ts` | `revalidateContract(id, { clientId?, previousClientId?, projectId?, previousProjectId? })` | Centralized July 2026 — was piecemeal revalidatePath |
| `createClient` / `updateClient` / `deleteClient` | `clients.ts` | `revalidateClient(id)` | Cascades to `/projects` and `/team` via helper |

## Where the User entity appears (and how to link)

This is the reference for anyone adding a new component that touches Users.
Every `user.name`, `assignee.name`, `author.name`, etc. must link to `/team/{user.id}`.

| Location | Component | Linked? |
|---|---|---|
| Team page list | `employee-list.tsx` | ✅ |
| Team page org chart | `org-chart-tree.tsx` | ✅ (via `href` prop) |
| Team staffing matrix | `staffing-matrix.tsx` | ✅ |
| Project staffing section | `project-staffing-section.tsx` | ✅ |
| Employee profile (canonical) | `employee-detail-client.tsx` | N/A (self) |
| Admin users list | `admin/users/page.tsx` | ✅ |
| Admin user detail | `admin/users/[userId]/page.tsx` | ✅ (redirects to `/team/{id}`) |
| Project member section | `member-section.tsx` | ✅ |
| Project milestone assignees | `milestone-section.tsx` | ✅ |
| Project detail task assignees | `projects/[projectId]/page.tsx` | ✅ |
| Tasks page assignee | `tasks/page.tsx` | ✅ |
| Client detail account manager | `clients/[clientId]/page.tsx` | ✅ |
| Client detail task assignees | `clients/[clientId]/page.tsx` | ✅ |
| Certification responsible party | `certifications/[certId]/page.tsx` | ✅ |
| Certification list assignee | `certifications/page.tsx` | ✅ |
| Comment author | `comment-section.tsx` | ✅ |
| Dashboard activity log | `dashboard/page.tsx` | ✅ |

Any new place that displays a user should be added to this table with a ✅ and
the correct link.

## Mutation audit for User

| Action | File | Helper call | Notes |
|---|---|---|---|
| `createUser` | `admin.ts` | `revalidateUser(user.id, { managerId })` | Passes new manager |
| `updateUser` | `admin.ts` | `revalidateUser(id, { managerId, previousManagerId })` | Looks up previous manager before update |
| `deleteUser` | `admin.ts` | `revalidateUser(id, { managerId })` | Revalidates manager too |
| `toggleUserActive` | `admin.ts` | `revalidateUser(id, { managerId })` | Active state affects list filters |
| `saveModulePermissions` | `admin.ts` | `revalidateUser(userId)` | Permission display |
| `saveEntityPermission` | `admin.ts` | `revalidateUser(userId)` | Permission display |
| `deleteEntityPermission` | `admin.ts` | `revalidateUser(perm.userId)` | Looks up owner before delete |

## Module registry

The canonical list of modules lives in `src/lib/modules.ts`. Adding a new
module should be a one-line change there (or a handful of lines for the full
metadata). The registry is consumed by:

- **Sidebar** (`src/components/layout/sidebar.tsx` and `admin/sidebar/sidebar-editor.tsx`) via the re-exported `SYSTEM_MODULES`
- **Permissions gating** (`src/lib/permissions.ts` `getVisibleModules`) via `getPermissionedModules()`
- **Admin permission editor** (`admin/users/[userId]/module-permissions.tsx`) via `getPermissionedModules()` and `ALL_PERMISSION_FLAGS`
- **Employee permissions tab** (`team/[employeeId]/employee-detail-client.tsx`) same
- **Module permission save action** (`actions/admin.ts` `saveModulePermissions`) same

When you add a new module:
1. Add an entry to `MODULES` in `src/lib/modules.ts` with the key, label, href,
   icon, description, section, and whether it's permissioned
2. If it should be permission-gated, set `permissioned: true` and it will
   automatically appear in the admin permission UI and be enforced by
   `getVisibleModules()`
3. If it's an admin-only module, set `adminOnly: true`
4. No other files need to change. Sidebar, admin UI, and permissions will
   pick it up on next build.

### Permission flags

The full list of permission flags (`canView`, `canEdit`, `canCreate`,
`canDelete`, `canComment`, `canUpload`, `canManage`) lives as
`ALL_PERMISSION_FLAGS` in the same file, with human-readable labels in
`PERMISSION_FLAG_LABELS`. Don't hardcode flag names in UIs — import from there.

## Email infrastructure

All outbound email routes through `src/lib/email/`. There's one public API
(`sendFromTemplate()`) and a driver abstraction so adding a new provider is
a single-file change.

### Sending an email

```ts
import { sendFromTemplate } from "@/lib/email";

await sendFromTemplate(
  "welcome",
  { name: user.name, loginUrl: "https://opshub.local/login" },
  { to: user.email, entityType: "user", entityId: user.id }
);
```

The audit context (`entityType`, `entityId`) is optional but recommended — it
makes the `/admin/emails` log searchable by entity later.

### Adding a template

1. Add a typed `EmailTemplate<YourData>` function to `src/lib/email/templates.ts`
2. Register it in the `TEMPLATES` map and `TemplateDataMap` interface
3. Call `sendFromTemplate("your-key", data, { to: ... })` from anywhere

### Adding a provider

1. Create `src/lib/email/resend-driver.ts` (or postmark/ses/etc.) exporting
   an `EmailDriver` with a `send()` that returns `EmailSendResult`
2. Add it to the `DRIVERS` map in `src/lib/email/drivers.ts`
3. Set `EMAIL_DRIVER=resend` in env (plus any provider-specific secrets)
4. Done — the log table records which driver handled each send

### Default behavior

If `EMAIL_DRIVER` is unset or points to an unregistered driver, the `log`
driver is used. It writes to the `EmailLog` table and logs to stdout but
does **not** actually send anything. This is the safe default for dev and
staging so no email accidentally goes to real addresses.

### Admin page

`/admin/emails` shows the 100 most recent log rows, sent/failed counts, the
active driver, and a "Send test email" button that sends the `test` template
to the signed-in admin. Useful for verifying the pipeline without touching
customer-facing templates.

## File storage infrastructure

All file uploads route through `src/lib/storage/`. Same pattern as the email
layer: public API, driver interface, driver registry, default local driver.

### Uploading a file

```ts
import { uploadFile } from "@/lib/storage";

const file = await uploadFile({
  content: buffer,
  filename: "logo.png",
  contentType: "image/png",
  uploadedById: user.id,
  visibility: "public",          // or "private"
  // Optional legacy FKs so existing entity pages find the file
  projectId: "proj_abc",
});

// file.url === "/api/files/{file.id}" — use this in <img src> / <a href>
```

### Serving files

`GET /api/files/{id}` looks up the `File` row, reads the bytes through
whichever driver stored them, and streams back with correct `Content-Type`
and `Content-Disposition`. Public files are readable without auth; private
files require a signed-in session. Per-entity permission checks can be
added to the route handler when a specific feature needs them.

### Drivers

- **local** (default) — writes to `.storage/files/` at the project root (or
  `STORAGE_LOCAL_DIR` if set). Safe for dev and self-hosted. Directory is
  gitignored so uploads never get committed.
- **s3 / drive / postmark / …** — add a driver file exporting a
  `StorageDriver` and register it in `src/lib/storage/drivers.ts`. Set
  `STORAGE_DRIVER=<name>` in env to switch. No call-site changes needed.

### File model

Extended in session 6 with three new columns on the existing `File` model
(added via migration `20260412000000_add_file_storage_fields`):

- `storageDriver` — which driver stored the bytes (nullable for legacy rows)
- `storageKey` — driver-specific key, unique per driver (nullable)
- `visibility` — `"public"` or `"private"` (default private)

Legacy `File` rows with just a `url` column continue to work — the route
handler only serves files with `storageDriver` set, and other code paths
can keep reading `file.url` directly.

### Admin surface

> **Doc-drift note (R12):** earlier revisions of this document described
> an `/admin/files` admin page, a `files` module-registry entry, and an
> employee-profile Files tab (`src/actions/employee-files.ts`,
> `employee-files-tab.tsx`). None of those shipped — the storage layer
> exists and is consumed by branding uploads, the workflow portal, and
> `/api/files/{id}` serving (with per-entity authz via
> `src/lib/file-authz.ts`), but there is currently no admin file browser
> and no per-employee file UI. The server-action upload reference
> (`uploadFileFromForm` in `src/actions/files.ts`) is ADMIN-gated and
> not wired to any page. If you build these features, restore the spec
> from git history (R6 era) and re-document here.

## Notifications infrastructure

All in-app notifications route through `src/lib/notifications/`. One helper
(`notify()`) creates rows in the `Notification` table and, optionally, fires
a matching email through the email layer from session 5.

### Sending a notification

```ts
import { notify } from "@/lib/notifications";

await notify({
  recipientId: task.assigneeId,
  type: "task-assigned",
  title: "You were assigned a task",
  body: task.title,
  href: `/projects/${task.projectId}`,
  entityType: "task",
  entityId: task.id,
  actorId: currentUser.id,
  // Optional — also sends an email to the recipient
  email: {
    templateKey: "notification",
    data: {
      recipientName: assignee.name,
      heading: "You were assigned a task",
      body: task.title,
      cta: { label: "Open task", url: absoluteUrl(`/projects/${task.projectId}`) },
    },
  },
});
```

Broadcasting to many recipients is done by passing an array to
`recipientId`. Each recipient gets their own `Notification` row (so per-user
read state works) and one email. Duplicates are silently deduplicated.

### Notification types

The set of known types lives as `NotificationType` in
`src/lib/notifications/types.ts` with human-readable labels in
`NOTIFICATION_TYPE_LABELS`. Types are stored as strings so new ones don't
need a migration — but adding them to the union gives TypeScript checking
at every call site.

Current types:
- `task-assigned`, `task-completed`, `task-due-soon`
- `mention`
- `assignment-created`, `assignment-removed`
- `project-updated`
- `comment-added`
- `milestone-assigned`
- `certification-expiring`
- `vehicle-maintenance-due`, `bid-due-soon`
- `system`, `test`

### User-facing UI

- **Top-nav bell** — `NotificationBell` component in
  `src/components/layout/notification-bell.tsx`. Shows unread count,
  dropdown with recent 10, mark-read/delete buttons, polls every 60s
  while the tab is visible. Gets initial state from the server layout
  so first paint has data.
- **`/notifications` page** — full list with All / Unread filters,
  mark-all-read, per-item mark-read and delete. Clicking a notification
  with an `href` marks it read and navigates.

### Admin UI

`/admin/notifications` shows every notification across every user, with:
- Total unread/read counts
- Breakdown by type
- Last 100 rows with recipient and actor linked to `/team/{id}`
- A **Send test** button with an "also send email" checkbox so admins
  can verify both the in-app and email paths end-to-end.

### How mutations should use notify()

When a feature mutation affects a user (task assignment, mention in a
comment, milestone deadline approaching, etc.), call `notify()` from the
server action after the DB write completes. Example pattern:

```ts
const task = await db.task.update({ where: { id }, data: {...} });
if (task.assigneeId && task.assigneeId !== previousAssigneeId) {
  await notify({
    recipientId: task.assigneeId,
    type: "task-assigned",
    title: "You were assigned a task",
    body: task.title,
    href: `/tasks#${task.id}`,
    actorId: currentUser.id,
    entityType: "task",
    entityId: task.id,
  });
}
```

### Where notify() is currently called

Live wiring as of the notification rollout. Each call site is wrapped in
a try/catch and skips self-actions (don't notify yourself for things you
just did).

| Trigger | File | Type | Email? |
|---|---|---|---|
| `createUser` (welcome email only — no in-app row) | `actions/admin.ts` | n/a — direct `sendFromTemplate("welcome", …)` | yes |
| `createAssignment` | `actions/assignments.ts` | `assignment-created` | yes |
| `quickAssign` | `actions/assignments.ts` | `assignment-created` | yes |
| `removeAssignment` | `actions/assignments.ts` | `assignment-removed` | no — too awkward via email |
| `addProjectMember` | `actions/projects.ts` | `project-updated` | no |
| `addMilestoneAssignee` | `actions/projects.ts` | `milestone-assigned` | no |
| `createTask` (with assigneeId) | `actions/tasks.ts` | `task-assigned` | yes |
| `updateTask` (assigneeId changed) | `actions/tasks.ts` | `task-assigned` | yes |

Adding more notify call sites is the natural way to fill out the bell.
Likely future additions: comment mentions (needs `@user` parsing first),
contract renewal warnings (needs a scheduled job), certification expiry
warnings (same), and onboarding workflow steps (needs the workflow
engine from a later session).

## Scheduled jobs infrastructure

Recurring background tasks live in `src/lib/jobs/`. Same shape as the
email and storage layers: definitions in a registry, single `runJob()`
entry point, admin viewer with run history.

### Adding a new job

```ts
// src/lib/jobs/jobs/my-job.ts
import type { JobDefinition } from "../types";

export const myJob: JobDefinition = {
  key: "my-job",
  name: "My job",
  description: "What this job does",
  schedule: "Daily",
  async handler(ctx) {
    // ...do work...
    return { output: "Summary string", processed: 5 };
  },
};
```

Then register it:

```ts
// src/lib/jobs/registry.ts
import { myJob } from "./jobs/my-job";

export const JOBS: JobDefinition[] = [
  // ...existing jobs...
  myJob,
];
```

The admin page `/admin/jobs` and the cron endpoint pick it up
automatically. Handlers should be **idempotent** — they may run more
than once in a window if cron retries or admins manually trigger.

### Triggering jobs

Three ways:

1. **External cron** — `POST /api/jobs/run` with the `x-cron-secret`
   header set to `CRON_SECRET`. Add `?job=KEY` to run a single job, or
   omit it to run every registered job sequentially. Compatible with
   Vercel Cron, GitHub Actions schedules, OS cron + curl, etc.

2. **Manual via admin UI** — `/admin/jobs` shows every registered job
   with a "Run now" button. Manual runs are recorded with
   `triggeredBy = user.id` so they're distinguishable from cron runs
   in the history.

3. **In-process from another action** — `import { runJob } from
   "@/lib/jobs"` and call directly. Used when a job needs to fire
   in response to a user action (rare).

### Concurrency

The runner has a built-in concurrency guard: if a job is currently
running (status="running" within the last hour), the next call returns
`status: "skipped"` instead of starting a duplicate. Manual admin
triggers bypass this with `force: true` so a stuck job can be re-run.

### Built-in starter jobs

| Key | Purpose | Schedule |
|---|---|---|
| `contract-expiry-check` | Notifies account managers when contracts are within 30 days of end/renewal | Daily |
| `certification-expiry-check` | Notifies responsible parties when certifications enter their renewal lead window | Daily |
| `cleanup-stale-notifications` | Deletes read notifications older than 60 days | Weekly |

The first two demonstrate the notify() integration pattern. The third
is pure DB maintenance.

### JobLog model

Every run lands in `JobLog` with `jobKey`, `status`, `startedAt`,
`finishedAt`, `durationMs`, `output`, `error`, `processed`,
`triggeredBy`. Indexed on `(jobKey, startedAt)` for the per-job last-run
lookup and on `startedAt` for the global recent-runs view.

### Production setup

1. Set `CRON_SECRET` in env to a long random string
2. Configure your cron provider to POST to `/api/jobs/run` on the
   schedules you need (typically: daily for expiry checks, weekly for
   cleanup). Vercel Cron syntax example:

   ```json
   {
     "crons": [
       { "path": "/api/jobs/run?job=contract-expiry-check", "schedule": "0 6 * * *" },
       { "path": "/api/jobs/run?job=certification-expiry-check", "schedule": "0 6 * * *" },
       { "path": "/api/jobs/run?job=cleanup-stale-notifications", "schedule": "0 3 * * 0" }
     ]
   }
   ```

   Vercel Cron will need to send the secret. For other providers,
   include the `x-cron-secret` header with the configured value.

## Branding & icons

Built on top of the file storage layer (session 6) and the existing
ThemeSetting key/value store. No schema migration was needed for branding
itself — just three new keys in `ThemeSetting`:

| Key | Type | Purpose |
|---|---|---|
| `branding.companyName` | string | Display name shown in sidebar/login. Falls back to "OpsHub". |
| `branding.companyLogoFileId` | File id | Public-visibility logo. Sidebar renders it instead of the company name text. |
| `branding.backgroundImageFileId` | File id | Public-visibility background image. Login page renders it behind a dark overlay. |

### Public API

```ts
import { getBranding } from "@/lib/branding";

const branding = await getBranding();
// {
//   companyName: "Acme Corp" | null,
//   companyLogoFileId: "file_..." | null,
//   companyLogoUrl: "/api/files/file_..." | null,
//   backgroundImageFileId: "file_..." | null,
//   backgroundImageUrl: "/api/files/file_..." | null,
// }
```

`getBranding()` verifies the file rows still exist before returning URLs,
so a stale ThemeSetting pointing at a deleted File reports as null
instead of producing a broken `<img src>`.

### Where branding is rendered

- **Sidebar** (`src/components/layout/sidebar.tsx`) — logo if set,
  otherwise company name text, otherwise "OpsHub". Pulled from the
  platform layout via `getBranding()`.
- **Login page** (`src/app/login/page.tsx`) — server component fetches
  branding and passes to a client `LoginForm`. The background image is
  rendered absolute behind a `bg-background/70` overlay so the card stays
  readable. Logo replaces the "OpsHub" text in the card header.
- **Admin theme editor** (`/admin/theme`) — `BrandingSection` component
  with company name input, logo uploader (with preview + remove), and
  background image uploader (with preview + remove). Uploads route
  through `uploadBrandingImage()` which uses the file storage layer
  with `visibility: "public"` and replaces any previous file in storage
  to avoid orphans.

### Server actions

Located in `src/actions/branding.ts`:

- `uploadBrandingImage(formData)` — accepts `file` + `target` (one of
  `companyLogoFileId` or `backgroundImageFileId`), uploads, replaces any
  previous file, updates the ThemeSetting key
- `clearBrandingImage(target)` — deletes the underlying file and clears
  the key
- `setCompanyName(name)` — updates or clears `branding.companyName`

All three are admin-only and call `revalidatePath("/", "layout")` so the
sidebar and login page pick up the change immediately.

### Page icon picker

The `SandboxPage` model gained an `icon` column (migration
`20260415000000_add_sandbox_page_icon`) storing a Lucide icon name as a
string. The `IconPicker` component in `src/components/ui/icon-picker.tsx`
provides:

- A button showing the current icon + name
- A popover with a grid of ~70 curated icons (documents, people, places,
  tools, status, etc.)
- A clear button
- A hidden `<input name="icon">` so it slots into any existing form

The `Icon` component from the same file renders an icon by name with a
fallback for unknown/null values — useful when displaying persisted icons
on detail or list pages.

```tsx
import { IconPicker, Icon } from "@/components/ui/icon-picker";

// In a form:
<IconPicker name="icon" value={page.icon} label="Page icon" />

// Rendering:
<Icon name={page.icon} className="h-4 w-4" />
```

The sandbox edit form uses the picker; the sandbox list page renders
the icon next to each page title via `<Icon>`. Adding more pages or
modules that want a custom icon is just two lines per place.

## CSV import workflow

Bulk-create records from CSV uploads. Same registry pattern as the email,
storage, jobs, and notification layers — definitions in a registry, single
commit() entry point per importer, admin wizard with auto-mapping, audit
log of every run.

### Adding a new importer

```ts
// src/lib/importers/importers/clients.ts
import type { ImporterDefinition } from "../types";

export const clientsImporter: ImporterDefinition = {
  key: "clients",
  name: "Clients",
  description: "Bulk-create client records from a CSV.",
  module: "clients",
  fields: [
    { key: "name", label: "Name", required: true, aliases: ["company name"] },
    { key: "industry", label: "Industry", required: false },
    // ...
  ],
  async commit(rows, ctx) {
    // Validate, dedupe, write, return ImportResult
  },
};
```

Then register it in `src/lib/importers/registry.ts`. The admin wizard at
`/admin/import` picks it up automatically.

### Wizard flow

1. **Pick importer** at `/admin/import`
2. **Upload CSV** (max 10MB)
3. **Preview + map** — first 20 rows + auto-mapped form, user can override
4. **Commit** — runs the importer's commit handler, persists ImportLog
5. **Result** — imported / skipped / failed counts + per-row errors

The mapping form is pre-populated by `autoMapHeaders()` which matches CSV
headers against each importer field's key, label, and aliases
case-insensitively. Aliases let an importer accept common header
variations (e.g. "Email" / "email address" / "work email") without
forcing the user to manually map every column.

### CSV parser

`src/lib/importers/csv-parser.ts` is a small dependency-free parser that
handles quoted fields with embedded commas, newlines, and escaped quotes,
plus LF/CRLF/CR line endings and trimmed headers. Doesn't support custom
delimiters or comment lines. Public API is a single `parseCsv()` function
so swapping in papaparse later is a one-file change.

### Built-in importers

| Key | Target | Required | Notes |
|---|---|---|---|
| `users` | User table | name, email | Resolves managerEmail in a second pass so manager + reports can be in the same file |

The users importer demonstrates the patterns to copy: required field
validation, case-insensitive duplicate detection against existing rows
AND prior rows in the same file, enum validation, boolean parsing with
multiple accepted forms, cross-row resolution, activity logging on
every successful row.

### ImportLog model

Every commit run records `importerKey`, `filename`, `rowCount`,
`imported`, `skipped`, `errors` (JSON of `{row, status, message}`),
`triggeredBy`, `createdAt`. Indexed on `(importerKey, createdAt)` for
the per-importer history view and on `createdAt` for the global recent
list. Visible at `/admin/import` (last 20 runs).

### Server actions

`src/actions/import.ts`:

- `previewImport(formData)` — parses the file, returns headers + auto
  mapping + first 20 rows. Does NOT write any data.
- `commitImport(formData)` — re-parses, applies the user mapping, runs
  the importer's commit handler, persists ImportLog, revalidates the
  layout so newly-imported records show up everywhere

Both are admin-only, file size capped at 10MB.

## @mentions in comments

Comments support @mention autocomplete. The author types `@` in the
compose box, picks an employee from the dropdown, and the mention is
stored as `@[Display Name](userId)` in the comment text. On save, the
action notifies each mentioned user in-app and by email.

### Storage format

Mentions are embedded in plain text — no separate Mention table. The
format is `@[Name](cuid)` where the display name is what the author
saw at compose time, and the cuid is the target user's id. This
survives user renames (the link still works) while keeping old mention
display text stable.

The tokenizer lives in `src/lib/mentions.ts` and exposes:

- `parseMentions(text)` — positions and names/ids of every token
- `extractMentionedUserIds(text)` — unique user ids only (used for
  notification fan-out)
- `stripMentionFormatting(text)` — `@[Alice](u1)` → `@Alice` for places
  that show comment excerpts without full rendering (activity log,
  recent-comments widget)
- `segmentMentions(text)` — splits into alternating text/mention
  segments for React rendering
- `detectMentionTrigger(value, cursor)` — the autocomplete hook uses
  this to know when the user is mid-mention
- `formatMentionToken(userId, name)` — builds the canonical token

### Compose UI

`src/components/shared/mention-textarea.tsx` is a plain textarea that
layers an autocomplete dropdown on top. It calls the server action
`searchMentionableUsers(query)` (in `src/actions/comments.ts`) as the
user types. Arrow keys navigate, Enter/Tab accept, Escape closes.

The compose field writes the raw `@[Name](id)` format into a hidden
input that rides along with the form submission — existing callers of
`addComment` needed no changes beyond swapping their `<Textarea>` for
`<MentionTextarea>`.

### Render path

`CommentSection` uses `segmentMentions` to split the raw content and
renders each mention as a `<Link href="/team/{id}">@Name</Link>`. Text
segments pass through untouched so `whitespace-pre-wrap` still works.

### Notification fan-out

`addComment` extracts mentioned user ids, drops the author and any
inactive / no-login users, resolves the comment's host entity to a
name and href, then calls `notify()` with the full list as the
`recipientId` array. Each recipient gets their own in-app notification
row and (if emails are configured) their own email using the
`notification` template. The notification type is `"mention"`.

## Reports

Reports are named, read-only queries that produce a structured table
and can be viewed, downloaded as CSV, or emailed. Same registry
pattern as the email / jobs / notifications / importers layers.

### Adding a new report

```ts
// src/lib/reports/reports/my-report.ts
import { db } from "@/lib/db";
import type { ReportDefinition } from "../types";

export const myReport: ReportDefinition = {
  key: "my-report",
  name: "My report",
  description: "What this report answers.",
  module: "projects",
  schedulable: true,
  async run() {
    const rows = await db.something.findMany({ ... });
    return {
      summary: `${rows.length} items match`,
      columns: [
        { key: "name", label: "Name" },
        { key: "count", label: "Count", align: "right" },
      ],
      rows,
      emptyMessage: "Nothing to report.",
    };
  },
};
```

Then register it in `src/lib/reports/registry.ts` and it appears
automatically in the admin `/admin/reports` list, grouped by the
`module` field.

### Rendering

`src/lib/reports/format.ts` provides three renderers that work on any
`ReportOutput`:

- `renderCsv(output)` — RFC 4180 CSV with CRLF endings and proper
  quote escaping for Excel compatibility
- `renderHtml(output)` — inline-styled HTML table suitable for email
  bodies (no `<style>` tags, since email clients strip them)
- `renderText(output)` — summary + bullet list plain-text fallback

All three use the `format` callback on a column if provided, otherwise
default formatting handles Dates, booleans, and nulls sensibly.

### Download + email flow

- **CSV download** — `GET /api/reports/{key}/csv` (admin-only) runs the
  report and streams a CSV attachment with a dated filename
- **On-demand email** — `emailReportAction(key, recipients)` renders
  HTML + text, sends one email per recipient via the `report` template,
  and logs each send to the email log. Accepts a mix of user ids
  (resolved against the user table) and raw email addresses
- **Scheduled digest** — the `daily-reports-digest` job in
  `src/lib/jobs/jobs/` runs every `schedulable: true` report and
  emails a combined digest to all login-capable admins. Register it
  with the cron endpoint to receive it daily

### Built-in reports

| Key | What it answers |
|---|---|
| `contracts-expiring` | Contracts with end or renewal date in next 60 days |
| `certifications-expiring` | Certifications lapsing within 90 days with renewal cost |
| `team-utilization` | Total active FTE per employee + assigned projects |
| `project-status` | Active portfolio with milestone + task progress |
| `activity-audit` | ActivityLog events in last 7 days grouped by user |

## Write-gate convention (R12)

Every mutation on a scoped entity (project, client, contract, tool,
certification — the types in `lib/scope.ts` `ScopeEntityType`) must run
**three** checks, in order:

1. `requireAuth()` — never raw `auth()`: the JWT caches the sign-in
   role; requireAuth re-reads the current DB role.
2. `resolveModulePerms(user.id, user.role, module)` — the module-level
   flag matching the operation (canEdit / canDelete / canCreate).
3. `assertManageEntity(user.id, user.role, entityType, entityId)` from
   `@/lib/entity-authz` — the entity-scope gate. Module flags alone are
   NOT enough: role defaults give every CONTRIBUTOR module-level
   canEdit, and without the scope gate they can mutate any entity
   org-wide by POSTing the action directly.

Sub-entities (milestones, contacts, terms, checklist items, documents,
attachments) gate on their **parent's** id — look the row up first
(`findFirst` with `deletedAt: null` where the model is soft-deletable),
return `{ error: "Not found" }` when missing, then gate.

Multi-step writes go in `db.$transaction`. Role values being written
are bounded by the actor's own rank (see `USER_ROLE_RANK` in
`actions/admin.ts` and `ROLE_RANK` in `actions/projects.ts`).

## My View (`/my`)

The personal landing page (post-login redirect target; `/` also lands
here). Registered as the non-permissioned `my` module in
`src/lib/modules.ts` — every authenticated user can open it; everything
on it is scoped per-user by the queries themselves:

- **My projects** — owned (`Project.ownerId`) ∪ member ∪ actively assigned.
- **My tasks** — open tasks assigned to the viewer, due-date order, with
  the shared TaskCheckbox and a one-line quick-add (assignee = viewer).
- **My tasks** — ONE list (`my-tasks-card.tsx`): OpsHub and
  Google-synced tasks together, soonest due first. Synced rows carry a
  small calendar-check mark; any task without a project files onto one
  inline via `assignTaskProject`; the Google connect / sync-now /
  disconnect controls live in the card header. (The separate "Google
  Tasks inbox" card is gone — Google is plumbing, not a place.)
- **All projects overview** — the spreadsheet replacement. Inline status
  select, click-to-edit notes, owner picker (org-wide roles only).
  Backed by `updateProject*Inline` actions in `actions/projects.ts`.

`Project.ownerId` and `Project.notes` exist for this page (migration
`20260701220000`). `revalidateProject` / `revalidateTask` /
`revalidateAssignment` all invalidate `/my`.

## Google Tasks integration

Per-user two-way sync with the Google Tasks API. Pieces:

- **Model** — `GoogleTasksIntegration` (one row per connected user):
  refresh token, cached access token + expiry, mirrored `tasklistId`
  ("OpsHub" list, created on first sync), last-sync bookkeeping.
- **OAuth** — `/api/integrations/google-tasks/connect` → Google consent
  (scope `auth/tasks`, offline + prompt=consent, CSRF state cookie) →
  `/callback` stores tokens and runs a first sync. Reuses the SSO OAuth
  client; the redirect URI must be added in the Google console (see
  `.env.example`).
- **Sync engine** — `src/lib/google-tasks/sync.ts`. Pull: every task in
  EVERY list on the account (the default "My Tasks" list included —
  the original design only read a dedicated "OpsHub" list it created,
  which is why nothing synced) becomes an OpsHub Task with
  `sourceType="google_tasks"` and `sourceId="<tasklistId>:<taskId>"`
  (composite — task ids are only unique per list; legacy bare ids are
  migrated on first match), assigned to the connected user; Google
  deletions soft-delete. Push: edits/completions of those SAME tasks
  patch back to the originating list. OpsHub-native tasks are NOT
  mirrored automatically; `pushNewTaskToGoogle()` (targets the
  account's `@default` list) exists for explicit opt-in flows.
  Conflicts: last-write-wins per task; a pull in the same run
  suppresses its own echo push.
- **Scheduling** — `google-tasks-sync` job (no webhooks upstream, so we
  poll). Rides the hourly all-jobs cron; add a dedicated 5-minute
  `?job=google-tasks-sync` entry for snappier sync. "Sync now" on /my
  posts to `/api/integrations/google-tasks/sync`.

## Role model (July 2026 rework)

Three presented roles — see `src/lib/roles.ts` and `getRoleDefaults()`
in `src/lib/permissions.ts`:

- **Admin** (ADMIN) — everything, including `/admin`.
- **Manager** (MANAGER) — org-wide operational data, no `/admin`.
- **Field** (CONTRIBUTOR; legacy VIEWER = read-only variant) —
  deny-by-default allow-list: tasks (full), scoped projects/clients/
  tools (view + comment/upload), team + intranet view. NO quotes,
  contracts, suppliers, subcontractors, partnerships, workflows, or
  certifications unless an explicit ModulePermission row or entity
  grant says so. Contract scope no longer fans out from project
  assignments for this tier.

Quotes additionally have per-quote ownership gates
(`src/lib/quotes/access.ts`): non-org-wide roles only ever see/export/
edit quotes they created or are assigned to — enforced in the list
page, detail/edit pages, PDF/DOCX routes, and every quote action.

Legacy DEVELOPER (admin-without-/admin) and GUEST are hidden from role
pickers but keep working; role auto-promotion (`lib/auto-role.ts`) was
removed — assignment-driven scope grants made it redundant.

## List views: cards/table toggle + group-by (Phase 3)

Every module list page shares one view system:

- **`ViewOptionsBar`** (`src/components/shared/view-options-bar.tsx`) —
  URL-param driven (`?view=` / `?groupBy=`), same navigation idiom as
  CertFilters. The FIRST view option is the default and is stored as the
  absence of the param, so plain sidebar links stay clean.
- **`groupRows()`** (`src/lib/group-rows.ts`) — shared bucketing:
  alphabetical groups, null/blank keys in a trailing "Not set" bucket,
  row order preserved within groups.
- **`GroupSection`** (`src/components/shared/group-section.tsx`) —
  collapsible `<details>` wrapper for group headers (zero client JS).
- **`lib/effective-status.ts`** — date-derived display status for
  certifications (`certBucket`) and contracts
  (`effectiveContractStatus`). Views must never trust the stored
  EXPIRING_SOON / EXPIRED enum values (they're only as fresh as the
  daily jobs); manual lifecycle states (DRAFT, TERMINATED, SUSPENDED,
  REVOKED, …) pass through.

Rollout: certifications (group by state / jurisdiction level / status /
type / engagement / client / assignee), suppliers (location / category /
status — `Supplier.location` added for this), clients (status /
industry / account manager), subcontractors (status / type /
compliance), partnerships (type / tier / status), tools (category /
type), projects (tree default + flat table grouped by client / status /
owner / offering), contracts (tree default + flat table grouped by
client / status / type). Tasks and team keep their existing bespoke
view systems; quotes is already a sortable table.

When adding a module list page: parse `view`/`groupBy` from
searchParams with a closed GROUP_OPTIONS list, write `renderCards` /
`renderTable` helpers, and compose with `groupRows` + `GroupSection`
exactly like `suppliers/page.tsx` (the smallest reference
implementation).

## July 2026 feedback batch

Migration `20260707000000_feedback_batch_suppliers_certs_disciplinary_fleet`
carries every schema change below.

### Supplier contacts, receipts, categories

- **`SupplierContact`** — many contacts per supplier, each with name,
  title, one email, one phone, isPrimary (setting one primary unsets
  the others), and notes. Additional emails/phones for the same person
  are modeled as additional contact rows (e.g. "Jane — office" /
  "Jane — cell"), not extra columns. CRUD in `actions/suppliers.ts`,
  rendered by `suppliers/[supplierId]/supplier-contact-section.tsx`.
  The legacy single contactName/Email/Phone columns (plus new
  `contactTitle`) remain as the "quick contact" on the supplier itself.
- **Receipts** — `uploadSupplierReceipt` / `deleteSupplierReceipt`
  store `File` rows with `supplierId` + `category: "receipt"`
  (private visibility, magic-byte sniffing, SVG blocked; size cap =
  `MAX_RECEIPT_UPLOAD_BYTES` in `lib/upload-limits.ts`, checked
  client-side too because the server-action body limit rejects bigger
  uploads before the action runs). Listed and uploaded from the
  supplier detail page (`supplier-receipts.tsx`); served via
  `/api/files/{id}` with the existing supplier-module authz in
  `lib/file-authz.ts`. `File` has an `@@index([supplierId, category])`
  for this query.
- **Categories** — the category select
  (`suppliers/supplier-category-select.tsx`) offers
  DEFAULT_CATEGORIES ∪ every distinct category already in the DB, plus
  an "+ Add new category…" option that reveals a free-text input.
  Every write path — the create/update forms AND the CSV importer —
  normalizes to snake_case via `normalizeSupplierCategory()`
  (`lib/supplier-categories.ts`) so grouping stays stable.

### Certification "renewal submitted"

`Certification.renewalSubmittedAt` records that the renewal paperwork
is filed and we're waiting on the authority. While set:

- `certBucket()` (`lib/effective-status.ts`) returns `"renewing"` —
  shown as a "Renewal Submitted" badge and its own stat chip/filter on
  the certifications list.
- The `certification-expiry-check` job skips the cert (no more
  "expires in 15 days" nagging while waiting), and the
  `certifications-expiring` report excludes it the same way.
- **Backstop:** once `expirationDate` actually passes, `"expired"`
  wins over `"renewing"` — a stalled renewal can't hide an expired
  cert. Lists show it as Expired again and the sign-off card flags
  "the certification has since expired — chase the renewal."
- Toggled from the cert detail sign-off card
  (`setRenewalSubmitted` in `actions/certifications.ts`,
  ADMIN/MANAGER + entity gate). Signing off a completed renewal
  clears it automatically, re-arming normal expiry tracking for the
  next cycle.

### Disciplinary action reports

HR paper trail replacing the Google Spreadsheet template.

- **Model** — `DisciplinaryReport`: employee, issuedBy, actionType
  (VERBAL_WARNING → TERMINATION enum), incidentDate, description,
  actionTaken, improvementPlan, witnesses, followUpDate,
  acknowledgedAt, notes, soft-delete. The employee FK is
  `onDelete: Restrict` — hard-deleting a user can never destroy the
  paper trail (deleteUser's P2003 catch says "deactivate instead";
  merge-users reassigns the rows).
- **Access** — ADMIN/MANAGER only (`isHrRole` in `lib/disciplinary.ts`,
  enforced by `requireHrRole` in `actions/disciplinary.ts`); delete is
  ADMIN-only. **The report's subject is always excluded**, even with an
  HR role: the tab is hidden and the data not fetched on their own
  profile, every action rejects `viewer.id === employeeId`
  (create/update/acknowledge/delete), and the PDF route 403s. The
  acknowledgement toggle is activity-logged (it stands in for the
  employee's signature). Employees do NOT see their own reports in-app —
  the PDF is the employee-facing artifact.
- **Activity-log hygiene** — disciplinary log entries store only the
  action-type label (never the employee name or incident text), the
  soft-delete registry labels reports as "Action (date)" via
  `formatLabel` (never the description), and every user-facing
  ActivityLog query spreads in `activityVisibilityWhere(role)`
  (`lib/activity.ts`) so `disciplinary-report` rows never reach non-HR
  viewers (Recent Activity widget, dashboard feed, widget-builder
  activity source). Admin-only surfaces (/admin/activity + CSV) show
  everything.
- **PDF export** — `GET /api/team/disciplinary/{reportId}/pdf`
  renders a signed-signature-line LETTER document
  (`lib/disciplinary/pdf.tsx`, @react-pdf/renderer) for printing /
  handing to the employee. Action-type labels live in
  `lib/disciplinary.ts` (kept out of the "use server" file). Calendar
  dates on the PDF render via `formatCalendarDate` (UTC-pinned).

### Fleet module

Company vehicles + maintenance, registered as the permissioned `fleet`
module (Car icon; ADMIN/MANAGER by default, grantable to field users
via ModulePermission like any other module). Fleet is also a **scoped
module**: `scope.vehicleIds` (assigned vehicles + entity grants) gives
assigned drivers view access to their own vehicles — the list page
filters to the scope set and the detail page gates with
`canViewEntity(scope, "vehicle", id)`, so the maintenance
notification's link works for the driver it's sent to.

- **Models** — `Vehicle` (nickname, make/model/year, unique VIN,
  licensePlate, status ACTIVE/IN_SHOP/RETIRED/SOLD, assignedTo,
  currentMileage, rolling nextServiceDate/nextServiceMileage,
  maintenanceNotifiedFor dedupe stamp, notes, soft-delete) and
  `VehicleMaintenanceRecord` (serviceDate, serviceType, odometer,
  cost, vendor, notes, nextDueDate/nextDueMileage).
- **Pages** — `/fleet` list (due-service stat chips with `?due=`
  filters; cards/table views grouped by status / make / assignee via
  the shared view kit) and `/fleet/{vehicleId}` detail (spec card,
  service badges, lifetime maintenance cost, history table +
  log-maintenance dialog).
- **Rolling schedule** — `addMaintenanceRecord` writes the record and
  updates the vehicle in one transaction: odometer only moves
  forward, and — **only when the record is the vehicle's most recent
  service** — `nextDueDate`/`nextDueMileage` roll the schedule forward
  and `maintenanceNotifiedFor` clears so the next window re-notifies.
  Backfilling an older record never wipes or rewinds the live
  schedule. Editing the vehicle's `nextServiceDate` directly also
  re-arms the notification.
- **Job** — `vehicle-maintenance-check` (daily): vehicles
  ACTIVE/IN_SHOP with `nextServiceDate` within
  `MAINTENANCE_DUE_WINDOW_DAYS` (14) or overdue notify admins,
  managers, and the assigned driver (`vehicle-maintenance-due` type;
  one notify per recipient so each email greets the person by name),
  deduped per service date via `maintenanceNotifiedFor`.
- **Helpers** — `lib/fleet.ts`: `vehicleLabel()` (nickname or "year
  make model") and `maintenanceDueState()` (overdue / due-soon /
  scheduled / none; RETIRED and SOLD vehicles never nag).
- Soft-delete recovery + purge cover `vehicle` and
  `disciplinary-report`; `merge-users-fk.ts` reassigns
  `Vehicle.assignedToId`, `DisciplinaryReport.employeeId`, and
  `DisciplinaryReport.issuedById`.

## Bid pipeline (July 2026)

Business development in one permissioned module (`bids`, Manager+ by
default — bid values are financial data). Migration
`20260709000000_bid_pipeline`.

- **`BidPortal`** (`/bids/portals`) — registry of the procurement /
  bidding sites we're registered on: name, URL, jurisdiction, the
  account identifier used there (never a password), registration
  renewal date (flagged red when past), active flag, notes. Lives
  inside the bids module rather than intranet resources because
  portals are structured pipeline data: every opportunity records its
  source portal, so "which registrations actually produce work" falls
  out of the data.
- **`BidOpportunity`** (`/bids`, detail `/bids/{id}`) — the pipeline
  item: title, solicitation #, agency, deep link, estimated value,
  response due date, portal/client/owner links, notes. Stages:
  IDENTIFIED → PREPARING → SUBMITTED → WON / LOST (Not Awarded) /
  NO_BID / STALE. Stage bookkeeping is automatic: → SUBMITTED stamps
  `submittedAt`, → any outcome stamps `decidedAt`, reopening clears it.
- **Views** — default "Pipeline" view renders stage sections in
  pipeline order with per-stage counts + dollar totals (the kanban
  read); "Table" is the flat list with group-by portal/owner/client/
  agency. Stat chips: open pipeline (count + value), due ≤ 7 days,
  overdue, awaiting decision, won — the due chips filter the list.
- **Deadline job** — `bid-due-check` (daily): open pre-submission bids
  due within `BID_DUE_WINDOW_DAYS` (7) or overdue notify the owner +
  admins/managers per-recipient (`bid-due-soon` type), deduped per
  dueDate via `dueNotifiedFor` (a new date re-arms it). SUBMITTED bids
  quiet for 60+ days get a "waiting Nd — check on this" hint in the
  UI (`bidWaitingDays`), nudging them toward STALE or a follow-up.
- **Convert to project** — on a bid detail, "Convert to project"
  creates a PLANNING project (name prefilled from the bid, client
  required), links it via `BidOpportunity.projectId`, and stamps the
  bid WON — the pipeline→delivery hand-off. Requires create rights on
  BOTH the bids and projects modules.
- **Wiring** — soft-delete recovery (`bid`), merge-users reassigns
  `ownerId`, global search + Cmd-K palette buckets, status-badge
  variants for all stages, sidebar under Delivery next to Quotes.
- Helpers in `lib/bids.ts` (`bidDueState`, `bidWaitingDays`, stage
  vocabulary) with tests.

## How to extend this document

When you add a new module or feature:

1. Does it display an existing entity (User, Project, Client, etc.)?
   - Add a row to that entity's display table
   - Make sure the display is wrapped in `<Link>` to the canonical page
2. Does it introduce a new entity type?
   - Add a row to the Entity → Canonical Page → Helper table
   - Add a new `revalidate<Entity>()` helper in `@/lib/revalidate-entity`
   - Document the paths it revalidates
3. Does it add a mutation?
   - The mutation should call the appropriate helper(s)
   - Add a row to the mutation audit table for the affected entity
