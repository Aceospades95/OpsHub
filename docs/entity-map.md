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
