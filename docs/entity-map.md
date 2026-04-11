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
- **Suppliers** — by name, notes (permission-gated)
- **Tasks** — by title, description — results deep-link to parent project or client
- **Team members** — by name, email, jobTitle, department — links to `/team/{id}`
- **Intranet resources** — by title, description, content — only published items,
  permission-gated (fixes the Time Off bug where HR entries were invisible)

When you add a new module that has user-facing content, add it to this list and
to the search query.

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
