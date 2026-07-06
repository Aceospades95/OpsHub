# OpsHub Codebase Audit — July 2026 (Phase 1)

Requested scope: module/page inventory, data model map, cross-view duplication
and edit propagation, one-sided relationships, and the permission/access model —
with a solid/broken/redundant verdict and a recommended priority order.

Every load-bearing claim below was verified directly against the code on
`main` (as of PR #30, 2026-07-01) with `file:line` references. This is a
code-level audit — the production database was not accessible, so "unused"
means *unreachable or immature in code*; you'll need to confirm which modules
hold real data (open questions at the end).

**Health snapshot**

| Metric | Value |
|---|---|
| TypeScript source | ~80,500 lines (excl. tests) |
| Prisma models / enums | 68 / ~30 |
| Pages | ~75 (28 of them under `/admin`) |
| Server-action files | 43 (`src/actions/`) |
| Roles | 6 (`ADMIN, MANAGER, DEVELOPER, CONTRIBUTOR, VIEWER, GUEST`) |
| CSV importers | 20 · Dashboard widgets: 21 · Scheduled job types: 12+ |
| CI (`lint`, `lint:pii`, `test`, `build`) | ✅ green on `main` (run of 2026-07-01) |
| History | 321 commits since 2026-03-30; QA rounds A–K, hardening rounds R11–R13 |

The LOC distribution tells the over-scoping story at a glance: `admin/` 9.4k,
`team/` 5.1k, `workflows/` 4.1k (+ a 236 KB workflow engine in `lib/`), while
`dashboard/` — the page you land on every day — is 542 lines and has no
personal view at all.

---

## Implementation status (updated 2026-07-01, same branch)

The go-ahead came back "build it out". Shipped on this branch, in the
priority order proposed in §8:

| Item | Status |
|---|---|
| **P0 — financial exposure** | ✅ Quotes role-scoped everywhere (list, detail/edit, PDF/DOCX routes, all actions, embedded cards); contract values gated on the contracts module on the client page; contract scope no longer fans out from field-tier project assignments. |
| **P1 — role simplification** | ✅ Deny-by-default field tier via per-module `getRoleDefaults`; pickers collapsed to Admin / Manager / Field (`lib/roles.ts`); auto-promotion deleted. Enum collapse itself deferred (legacy DEVELOPER/VIEWER/GUEST still valid, hidden). |
| **P2 — My View** | ✅ `/my` personal landing page (now the post-login target): my projects, my tasks + quick-add, Google inbox, and an all-projects table with inline status/notes/owner editing. `Project.ownerId` + `Project.notes` added. |
| **P3 — integrity & de-siloing** | ✅ `revalidateContract` / `revalidateCertification` helpers wired into every mutation; Task.clientId now derived from the project; SupplierProject FK restored (with orphan cleanup); add-task from project/client pages. ❌ Deferred: ProjectMember↔Assignment merge, computed EXPIRING statuses (both need a data-migration plan). |
| **P4 — Google Tasks** | ✅ OAuth connect/callback/disconnect, two-way sync engine, `google-tasks-sync` job, /my inbox with project triage. Setup: add the callback redirect URI + enable the Tasks API in the Google console (`.env.example`), optionally add the 5-minute cron entry (`docs/deployment.md`). |
| **P5 — scope trim** | ⏸ Untouched pending the open-questions answers — field roles no longer see the over-scoped modules, which removes most of the day-to-day noise without deleting anything. |
| **Phase 3 — list views (post-merge request)** | ✅ Shared cards/table toggle + group-by across certifications (state/jurisdiction/status/type/engagement/client/assignee), suppliers (new `location` field; location/category/status), clients, subcontractors, partnerships, tools, and flat table views for projects and contracts. Display statuses for certs + contracts are now date-derived (`lib/effective-status.ts`) — closes the "stored EXPIRING/EXPIRED drift" deferred item at the view layer. |
| **Feedback batch (2026-07-07)** | ✅ Suppliers: free-text new-category input (normalized), multi-contact rolodex (`SupplierContact` — name/title/email/phone per row; extra emails/phones = extra rows), receipts uploads on the supplier page. Certifications: "renewal submitted" state (`renewalSubmittedAt`) mutes expiry nagging until sign-off, with its own badge/chip/filter. Team: disciplinary action reports (ADMIN/MANAGER-only tab, enum action types, acknowledgement tracking, printable PDF via `/api/team/disciplinary/{id}/pdf`) replacing the Google Spreadsheet template. New permissioned **Fleet** module: vehicles (make/model/year/VIN/plates/driver/mileage), maintenance history with rolling next-service schedule, due-soon/overdue visuals, and a daily `vehicle-maintenance-check` job notifying admins/managers + the assigned driver. Details in `docs/entity-map.md` §"July 2026 feedback batch". |
| **Review fixes (2026-07-08)** | ✅ Ten confirmed findings from the batch's adversarial code review, all fixed: disciplinary activity-log leak closed (safe labels + `activityVisibilityWhere` role filter on every user-facing ActivityLog query); report subjects fully self-excluded (tab, actions, PDF) with the acknowledgement toggle now audit-logged; `DisciplinaryReport.employeeId` FK Cascade→Restrict so deleting a user can't destroy the HR paper trail; cert "renewing" state gets an expired backstop (expired wins once the date passes; sign-off card flags stalled renewals; `certifications-expiring` report mirrors the job's `renewalSubmittedAt` filter); calendar dates UTC-pinned via `formatCalendarDate` on the disciplinary PDF/tab, fleet maintenance table, and job email; maintenance backfills no longer wipe/rewind the live service schedule; assigned drivers get scoped fleet view (`scope.vehicleIds`) so their notification links open; receipt uploads pre-check size client-side with try/finally (no more stuck spinner). Plus: vehicles + supplier contact names searchable in global search and the Cmd-K palette; supplier CSV importer normalizes categories; `File(supplierId, category)` index; recovery-bin labels via `formatLabel` (vehicles show `vehicleLabel()`, disciplinary reports show "Action (date)" — never the description). |

Corrections to this report discovered while implementing: quote creation
from client/project pages already existed (`QuotesCard` has a prefilled
New Quote button), so §5's quote row overstated the gap.

---

## 1. Executive summary

**What's solid.** The plumbing is genuinely good: deploy/boot hygiene, CI
gates, a consistent write-gate convention on mutations (R12), invite-token
auth, and a well-factored infra layer (email/storage/jobs/notifications
registries). The staffing/assignment system is the one relationship that works
from every side. Contract↔project linking was fixed from the project side in
PR #30.

**What's broken (for your goals).**
1. **The access model is opt-out, not opt-in.** Role defaults grant every
   VIEWER+ `canView` on *every* permissioned module, and every CONTRIBUTOR+
   `canEdit`/`canCreate` (`src/lib/permissions.ts:47-58`). A field tech with a
   default account can today open `/quotes` and see **every quote with
   totals** (the quotes list has no scope filter — `quotes/page.tsx:76`),
   download **any quote PDF/DOCX by id**, **create and edit quotes**, see
   **contract dollar values** on any client they're scoped into, and see
   **subcontractor rates**. Details in §6.
2. **No "My View".** The dashboard is one global layout stored in
   `ThemeSetting` (`page_layout_dashboard`), editable only by ADMIN/DEVELOPER,
   identical for every user (`src/actions/page-layout.ts:51-66`). There is no
   per-user layout, no "my projects" (the schema has **no project owner
   field**), and no inline editing on any list — the only status filter on
   the projects list is a filter, not an editor.
3. **Half the relationships are one-way.** Tasks, quotes, certifications, and
   account-manager links can only be set from the child entity's own page;
   project/client pages display them read-only (§5).
4. **Two entities have no revalidation helper** (Contract, Certification), so
   some edits go stale on client-side navigation, and the schema carries
   duplicated state that can genuinely disagree (Task.clientId vs its
   project's client; ProjectMember vs Assignment; a missing FK on
   SupplierProject). The 14 one-off repair scripts in `prisma/` are the
   receipts for past drift incidents (§3–4).

**What's redundant.** Roughly a third of the app is built for a 50–200-person
org: the workflow engine + portal + analytics, custom report builder, 20 CSV
importers, widget builder + sandbox page builder, theme preset system,
notifications admin, access-request workflow, and three near-identical
partner CRMs (suppliers / subcontractors / partnerships, each with its own
contacts table). None of it is *harmful* — but it's why the tool no longer
feels like yours.

**Recommended order** (details in §8): a small security patch on quotes and
financial fields first, then role simplification, then My View, then data
integrity / two-sided editing, then Google Tasks, then scope-trim as cleanup.

---

## 2. Module & page inventory

### 2.1 Daily-driver modules

| Module | Size | What it does | Verdict |
|---|---|---|---|
| Dashboard `/dashboard` | 542 LOC | Stats cards, My Tasks widget (with status checkbox), recent activity, projects overview. One global layout for all users, admin-editable only. | **Solid but not personal** — this is the My View gap. |
| Projects `/projects`, `/projects/[id]` | 3.8k | Client-grouped tree with parent/child projects, detail page with members, milestones, staffing, contracts card (link/unlink, PR #30), tools, subcontractors, partnerships, related projects, documents, quotes card. | **Solid.** Detail page is feature-dense; list has filter but no inline editing. |
| Tasks `/tasks` | 1.4k | Cross-project task list, by-status / by-project views, due filters, CSV export. Properly scope-filtered (`tasks/page.tsx:99`). | **Solid**, but tasks can only be created/edited here (§5). |
| Clients `/clients`, `/clients/[id]` | 961 | Client list + detail with projects, contracts (with values), tasks, contacts, quotes cards. | **Solid**, one financial-exposure issue (§6). |
| Contracts `/contracts`, `/contracts/[id]` | 892 | Client-grouped hierarchy tree (MSA→SOW→amendments), terms, detail page. Scope-filtered list (`contracts/page.tsx:51-55`). | **Solid.** |
| Team `/team`, `/team/[id]` | 5.1k | Org chart (d3), staffing matrix (client→project→role→FTE), employee profiles with edit (incl. manager), assignments. | **Solid but heavy** — the matrix went through ~15 fix-commits and is the most complex UI in the app. |
| Quotes `/quotes`, `[id]`, `/edit`, `/catalog`, `/templates` | 2.7k + `lib/quotes` | Block-based quote builder: line items, optional rows, discounts/tax, templates, catalog autocomplete, PDF/DOCX export, public send/accept flow with token + e-signature, revisions, project conversion. | **Solid feature-wise; broken access-wise** (§6). |

### 2.2 Secondary modules

| Module | Size | Verdict |
|---|---|---|
| Certifications | 2.4k | Solid; admin-only (`modules.ts:168`). Rich renewal engine: multi-tier reminders, checklists, renewal history, sign-off. Arguably over-built but you appear to use it. |
| Suppliers | 511 | Solid, small. One schema defect (§3.2-4). |
| Subcontractors | 1.3k | Solid. Compliance suite (W-9/MSA/NDA/insurance) + rates. Default-visible to field team (§6). |
| Partnerships | 1.1k | Solid code, questionable need — tier system (PLATINUM…), referral basis points, joint-marketing flags for a small IT shop. |
| Tools | 492 | Solid, small. Link-to-project one-sided (§5). |
| Intranet | 450 | Solid mini-CMS (categories, publish, pinning). |
| Search | 455 | Solid; permission- and scope-gated per module (R11-D). |
| Notifications `/notifications` + bell | 231 | Solid. |
| Workflows `/workflows/*` + portal | 4.1k pages + 236 KB lib + 922 portal | Full engine: 13 step types, 4 trigger types, timing rules, variable substitution, self-service portal with signatures, analytics page, per-minute tick job, watchdog. **Works, but it is the single largest over-scope item.** |

### 2.3 Admin surface (28 pages, 9.4k LOC)

Users & permissions (module × entity grids), user merge, access requests, SSO
domain allowlist, sidebar editor, theme editor (13 presets + branding),
widget builder, CSV import wizard (20 importers + history), activity audit,
reports (5 system + custom report builder + scheduled email digests), email
log, notifications admin, scheduled jobs, scheduled tasks, recovery bin
(soft-delete restore), PII scan.

**Flags:**

- **Half-built:** widget builder (`/admin/widgets`, custom `CustomWidget`
  JSON configs) and the sandbox page builder (`/sandbox`) — both functional
  skeletons that never became real features.
- **Unused / vestigial:** `/settings` (11-line redirect to `/admin`);
  `src/actions/files.ts:uploadFileFromForm` (admin-gated, wired to no page);
  the employee-files UI was removed but its storage plumbing remains
  (documented drift note in `docs/entity-map.md:297-307`); `/register` is a
  disabled stub that bounces to `/login`.
- **Over-engineered for a 2–10 person team** (sized): workflow engine
  (~240 KB lib), importer framework (20 entity importers, ~5.2k LOC),
  reports framework (system + custom builder + digests), widget system
  (21 widgets + builder + per-page drag/drop layout editor with templates),
  theme system, notifications admin, access-request workflow, PII scan,
  SSO admin UI, org chart (d3 + d3-org-chart deps). Individually defensible,
  collectively the reason the app stopped being fast for you.

### 2.4 History signals

The `prisma/` folder contains **14 one-off repair scripts** — three user-merge
variants, intranet dedupe, orphan-file cleanup, demo-data cleanups, quote-number
and slug backfills, slug→cuid migrations. Each one is a past data-integrity
incident. The git log shows the same churn (widget system added → reverted →
re-added; ProjectRole dropped → restored; ~15 staffing-matrix fix commits).

---

## 3. Data model

### 3.1 Core relationships (as implemented in `prisma/schema.prisma`)

```
Client 1 ──── * Project        Project.clientId (required)
Client 1 ──── * Contract       Contract.clientId (required)
Project 0..1 ─ * Contract      Contract.projectId (optional; hierarchy via parentContractId)
Client 1 ──── * Quote          Quote.clientId (required)
Project 0..1 ─ * Quote         Quote.projectId (optional; revisions via parentQuoteId)
Project 0..1 ─ * Task          Task.projectId (optional)
Client 0..1 ── * Task          Task.clientId (optional, independent of project!)
User 0..1 ──── * Task          Task.assigneeId
User * ──────── * Project      TWICE: ProjectMember AND Assignment
Assignment ──── Project? + Client? + ServiceOffering? + ProjectRole? + RoleDefinition? + FTE
Project 1 ──── * Milestone ─── * MilestoneAssignee ── User
Project * ──── * Tool / Supplier / Subcontractor / Partnership   (join tables)
Project * ──── * Project       ProjectRelation (related-projects, two-sided)
Certification ── Client? + assignee/POC/signed-off User refs (no Project link)
User.managerId → User          (org chart)
File / ExternalLink / Embed / Comment: polymorphic via one nullable FK per entity type
Workflows: Template → Steps → Instance → InstanceSteps (+ triggers, events, portal tokens)
```

### 3.2 Integrity issues (duplicated state that can drift)

1. **ProjectMember vs Assignment — person↔project is modeled twice**
   (`schema.prisma:633-644` and `:1197-1229`). The member section on the
   project page writes `ProjectMember`; the staffing matrix writes
   `Assignment`; permissions union *both* (`permissions.ts:224-265`). Nothing
   keeps them consistent — a person can be a member but not staffed, or
   staffed but not a member, and removing one doesn't touch the other.
2. **`Task.clientId` is independent of `Task.project.clientId`**
   (`schema.prisma:492-493`). A task can point at project A (client X) and
   client Y simultaneously; `createTask`/`updateTask` accept both fields
   without cross-validation. Client task lists can therefore disagree with
   project task lists.
3. **`Assignment.clientId` / `serviceOfferingId` / `roleDefinitionId` duplicate
   the project's own fields** (`schema.prisma:1200-1204`) — same disagreement
   class as tasks; the matrix groups by these, so a mismatched row files under
   the wrong client.
4. **`SupplierProject.projectId` has no FK relation** — the model has a
   `supplier` relation but only a bare string for the project
   (`schema.prisma:785-795`), and `Project` has no `suppliers` back-relation.
   No referential integrity, no cascade on project delete (orphan rows —
   plausibly why `cleanup-orphan-file-refs.ts`-style scripts exist), and you
   can't query a project's suppliers through Prisma includes.
5. **Derived statuses are stored**: `ContractStatus.EXPIRING_SOON/EXPIRED` and
   `CertificationStatus.EXPIRING_SOON/EXPIRED` are enum values persisted on
   the row, kept honest only by daily jobs. If cron isn't wired (it requires
   `CRON_SECRET` + an external scheduler), statuses silently diverge from
   the actual dates.
6. **Acknowledged legacy duplicates**: `Assignment.role` (freeform) vs
   `roleDefinition`; `Certification.renewalLeadDays` vs
   `reminderOffsetsDays[]`.
7. **Contact info duplicated by pattern**: Subcontractor and Partnership carry
   `primaryContact*` columns *and* a contacts table with `isPrimary` — two
   places for the same fact. (Also: three structurally identical contact
   tables — Client/Subcontractor/Partnership.)
8. **Quote totals are cached** (`subtotal`, `taxAmount`, `total`) — safe today
   because `persistQuoteWithItems` recomputes them in a transaction, but any
   future line-item mutation that bypasses it will rot the totals silently.

---

## 4. Same entity in multiple views — does editing propagate?

Mechanics: every platform page renders per-request on the server, so a hard
refresh is always correct. Staleness appears in **client-side navigation**
(Next.js router cache) when a mutation forgets to `revalidatePath` a view the
entity appears on. That is exactly the "edit here, not updated there"
symptom. The codebase's own convention (`docs/entity-map.md`) is centralized
`revalidate<Entity>()` helpers in `src/lib/revalidate-entity.ts`.

### 4.1 Coverage

**Covered by helpers (verified solid):** User, Project, Client, Assignment,
Task (tracks previous assignee), Quote (tracks previous client/project),
Subcontractor, Partnership, Comment, WorkflowTemplate/Instance/EmailTemplate.
Milestone assignee changes correctly revalidate both project and user profile
(`projects.ts:594-606`) — an earlier internal claim to the contrary was wrong.

**Not covered — piecemeal `revalidatePath` with verified gaps:**

| Entity | Gap | Evidence |
|---|---|---|
| **Contract** | No `revalidateContract()` helper. `linkContractToProject` / `unlinkContractFromProject` revalidate the contract detail and the affected project pages but **not the `/contracts` list and not the client detail page** — both of which render contract info. Create/update/delete cover client+project pages but each action hand-rolls its own path list. | `contracts.ts:84-87, 154-164, 248-251, 281-282` |
| **Certification** | No helper; updates/sign-offs revalidate only `/certifications` + its own detail. Low blast radius (module is admin-only and certs don't render on client pages), but it diverges from the convention and will bite the moment certs are surfaced anywhere else. | `certifications.ts` (update/sign-off paths) |
| **Tool / Supplier / Document** | No helpers; raw paths. e.g. renaming a tool doesn't refresh project pages that list it. | `tools.ts`, `suppliers.ts`, `documents.ts` |

### 4.2 Client-side state copies (low risk, for completeness)

- The layout editor holds cards/gap in `useState` and persists via server
  action (`page-layout-client.tsx:81-91`) — admin-only surface, acceptable.
- "Recently viewed" snapshots entity names into `localStorage`
  (`lib/recently-viewed.ts`) — a rename shows stale text in that widget until
  revisit. Cosmetic.
- Standard mutate→`router.refresh()` used elsewhere (e.g. dashboard task
  checkbox) is correct.

**Bottom line:** the drift you feel day-to-day is less about Next.js caching
and more about §3.2 (real duplicated state) plus §5 (you can't even make the
edit from the page you're on).

---

## 5. Relationships that only work from one side

Verified per relationship (UI affordance + server action, both directions).
Corrections to my own sub-audit are already applied: `updateProject` **does**
allow changing the client (`projects.ts:198,268-272`), and the manager field
**is** editable (employee profile `employee-detail-client.tsx:322`; admin user
form with cycle check `admin.ts:454-503`).

| Relationship | From child/owning side | From the other side | Verdict |
|---|---|---|---|
| Contract ↔ Project | Contract form sets/changes project (`contracts.ts:118`) | Project page: link existing / unlink card (PR #30, `project-contracts-card.tsx`) | ✅ **Two-sided** (recently fixed) |
| Employee ↔ Project (Assignment) | Employee profile quick-assign | Staffing matrix + project staffing section | ✅ **Two-sided** |
| Project ↔ Project (related) | Either project's detail card | same | ✅ **Two-sided** |
| User ↔ Manager | Employee profile edit + admin form | Org chart displays only | ✅ Adequate |
| Project ↔ Client | Project create/edit form | Client page: read-only list (link to filtered `/projects`) | ⚠️ One-sided (acceptable, but "new project" from client page is a cheap win) |
| **Task → Project / Client / Assignee** | Only on `/tasks` (create + edit) | **No create/edit from project page, client page, team profile, or dashboard** (status checkbox only) | ❌ **One-sided — worst daily offender** |
| **Quote → Client / Project** | Only in quote form | Client/project pages show read-only `QuotesCard` | ❌ One-sided |
| Client → Account manager | Client form only | Team profile doesn't list/manage managed clients | ❌ One-sided |
| Certification → Client / Assignee / POC | Cert form only | Nothing on client page or team profile | ❌ One-sided |
| Tool ↔ Project | — | Project page add-tool button only; tool detail lists projects read-only | ❌ One-sided (project side) |
| Supplier ↔ Project | — | Project side only (`suppliers.ts:103-146`) | ❌ One-sided |
| Subcontractor ↔ Project | — | Project side only | ❌ One-sided |
| Partnership ↔ Project | — | Project side only | ❌ One-sided |
| User ↔ Project (ProjectMember) | — | Project member section only; nothing from team profile | ❌ One-sided (and duplicates Assignment, §3.2-1) |

Pattern: **project detail is the only "hub" page with two-way affordances;
everything else edits from the child's own module.** Your contract example was
the tip of it — tasks and quotes are the ones that cost you the most clicks.

---

## 6. Permission & access model

### 6.1 How it works today

Six roles ranked 0–4 (`permissions.ts:18-25`); defaults derive purely from
rank (`getRoleDefaults`, `permissions.ts:47-58`):

| Flag | VIEWER (1) | CONTRIBUTOR (2) | MANAGER/DEVELOPER (3) | ADMIN (4) |
|---|---|---|---|---|
| canView | ✅ | ✅ | ✅ | ✅ |
| canEdit / canCreate / canComment / canUpload | — | ✅ | ✅ | ✅ |
| canDelete | — | — | ✅ | ✅ |
| canManage | — | — | — | ✅ |

Layered on top: per-user **ModulePermission** rows override defaults per
module (15 modules × 7 flags); per-user **EntityPermission** rows grant
specific entities; **assignment-based scope** (`lib/scope.ts`) computes
visible project/client/contract/tool/cert id-sets and auto-grants `canView`
when non-empty (`permissions.ts:139-146`); **auto-role-promotion** bumps
users on assignment (`User.promotedFromRole`); plus an **access-request**
approval workflow, a sidebar that hides empty modules, and ADMIN-only pages.
DEVELOPER = ADMIN for data (org-wide manage, `lib/scope.ts`), just without
`/admin` pages. That's ~920 LOC of authz machinery and, in practice, a
permission matrix nobody should have to administer.

**The structural problem for your requirement:** defaults are *allow*. A
field tech created as VIEWER or CONTRIBUTOR gets `canView` (and for
CONTRIBUTOR, `canEdit`/`canCreate`) on **every** non-admin module unless you
hand-create a deny row per user per module. Scoping (the thing that limits
users to "their" projects) only applies to the five entity-scoped modules —
`projects, clients, contracts, tools, certifications` (`permissions.ts:39-45`).
**Quotes, suppliers, subcontractors, partnerships, and workflows are not
scoped at all.**

### 6.2 What a default field-tech account can reach today (verified)

| # | Exposure | Evidence |
|---|---|---|
| 1 | **All quotes incl. totals** — `/quotes` list queries `where: { deletedAt: null }` with no scope filter; gate is module `canView`, default-true for VIEWER+ | `quotes/page.tsx:60-95` |
| 2 | **Any quote as PDF/DOCX by id** — module-perm check only, no per-quote check | `api/quotes/[quoteId]/pdf/route.ts:17-27`, `docx/route.ts:17-18` |
| 3 | **Create & edit quotes** — CONTRIBUTOR default `canCreate`/`canEdit` pass the only gate | `quotes.ts:193-195, 416-418` |
| 4 | **Quote catalog & templates incl. pricing** | `quotes/catalog/page.tsx:16-17`, `templates/page.tsx:15-16` |
| 5 | **Every contract value for any client in scope** — being assigned to *one* project of a client puts the client in scope, and the client page renders **all** its contracts with `value` | `clients/[clientId]/page.tsx:56, 176-188`; scope fan-out `lib/scope.ts` |
| 6 | **Contract detail incl. value** for contracts linked to their projects (scope auto-grant) | `contracts/[contractId]/page.tsx` value block; `scope.ts:162-168` |
| 7 | **Subcontractor rates** (`defaultRate`, per-engagement `contractValue`/`rate` on project pages) — module default-visible, unscoped | project page subcontractor card (`projects/[projectId]/page.tsx:563-581`); `schema.prisma:2069-2070, 2137-2140` |
| 8 | **Suppliers, partnerships (commercial terms incl. referral fees), workflows hub/instances** (onboarding/offboarding state about other employees) — all default-visible, unscoped | `modules.ts` (permissioned, not adminOnly); `workflows/page.tsx:17-19` |

**Correctly protected today:** `/admin/*` (ADMIN-only), certifications
(`adminOnly`), report CSV API (re-reads role, ADMIN-only —
`api/reports/[key]/csv/route.ts:23-30`), projects/tasks/clients/contracts
*lists* (scope-filtered), self-registration disabled, invite tokens hashed
+ single-use, portal tokens revocable (R13-D), middleware public-path
allowlist tight (`middleware.ts:39-52`). Also: there are **no salary fields**
anywhere, and certification `renewalCost` sits behind the admin-only module.

### 6.3 Verdict

The R12 *write*-gate convention is real and mostly consistently applied — the
gap is **read scoping on financial modules + allow-by-default role math**.
Fixing the defaults fixes eight exposures at once. The machinery (6 roles ×
7 flags × 15 modules + entity rows + auto-promotion + access requests) is
far more than a 2-role shop needs and is itself a source of these bugs.

---

## 7. Solid / Broken / Redundant

**Solid** — keep and build on:
- Deploy/boot/CI hygiene; green test suite (~35 test files on the risky lib code).
- `revalidate-entity` convention (12 entities covered) + `entity-map.md` discipline.
- Assignment/staffing system (two-sided), contract↔project linking (post-PR #30).
- Quote builder feature set; certification renewal engine; soft-delete + recovery bin.
- Infra registries (email drivers, storage drivers, jobs, notifications) — genuinely good bones, including for the Google Tasks work.

**Broken** — fix (ordered in §8):
- Quotes unscoped (list, exports, create/edit) + allow-by-default role defaults; contract values via client page; subcontractor rates exposure. *(Access)*
- No personal dashboard, no project owner, no inline editing, global-only layouts. *(My View)*
- One-sided editing for tasks, quotes, certs, account manager, tools/suppliers/subs/partnerships. *(De-siloing)*
- No Contract/Certification revalidation helpers; ProjectMember↔Assignment duality; `Task.clientId` drift; `SupplierProject` missing FK; stored derived statuses. *(Integrity)*

**Redundant** — candidates to hide/archive/simplify (confirm usage first):
- Workflow engine + portal + analytics (unless onboarding flows are live).
- Custom report builder + scheduled digests; widget builder; sandbox pages.
- 15+ of the 20 CSV importers; theme preset system; notifications admin; access-request workflow; PII scan.
- Partnerships module (or fold into a single "external orgs" concept with suppliers/subcontractors — three parallel CRMs today).
- DEVELOPER and GUEST roles; EntityPermission layer (assignment-based scope already covers the real use case).

---

## 8. Recommended priority order (Phase 2 proposal)

Awaiting your go-ahead; each area gets a concrete plan before implementation.

**P0 — Stop the financial exposure (small, do first).**
Scope quotes (list + PDF/DOCX routes + templates/catalog) to org-wide roles
only; flip role defaults for quotes/contracts-values/subcontractor-rates from
allow to deny; hide contract `value` on the client page behind contracts
module perm. ~1 day of diffs, removes exposures #1–8 in §6.2 even before the
role model changes.

**P1 — Access control simplification (your area 2).**
Collapse to 2–3 roles: **Owner** (you, full access incl. admin), **Field**
(scoped: own assignments, their projects' tasks/docs/tools — no contracts,
quotes, financial fields, workflows, admin), optional **Office/Manager**
later. Mechanically: make VIEWER/CONTRIBUTOR defaults deny-by-default outside
the scoped modules, delete auto-promotion + EntityPermission complexity,
migrate existing users, keep assignment-based scope as the single source of
"what field techs see". This *removes* code (~900 LOC authz shrinks).

**P2 — My View (your area 1, biggest daily value).**
- Add `Project.ownerId` (+ optional `Project.notes` text field for your
  running notes) — today "my projects" is not expressible.
- New `/my` page (make it the post-login landing): my active projects
  (owner ∪ assigned), my open tasks (due-date sorted, quick status toggle —
  the action already exists), and an **all-projects inline editor**: one row
  per project, status dropdown + notes cell editable in place via
  `updateProject`, no drill-in. Per-user layout is unnecessary if the page is
  purpose-built — skip the layout-editor machinery entirely.
- Success criterion: the spreadsheet urge dies.

**P3 — Data integrity & de-siloing (your area 3).**
- Add `revalidateContract()` / `revalidateCertification()` helpers; migrate the
  piecemeal calls (closes §4.1 gaps).
- Two-sided editing: "Add task" on project/client/My View (project pre-filled);
  "New quote" from client/project; assign account manager from team profile;
  link project→tool/supplier/subcontractor from those detail pages. Reuse the
  `project-contracts-card` pattern from PR #30 everywhere.
- Merge `ProjectMember` into `Assignment` (data migration + drop model);
  derive `Task.clientId` from the project when set (one-time backfill +
  validation); add the missing `SupplierProject` FK; compute
  EXPIRING_SOON/EXPIRED from dates at read time instead of storing them.

**P4 — Google Tasks integration (your area 4). Feasible, and the hooks exist.**
- **Auth:** you already sign in with Google; the `Account` model already has
  `refresh_token`/`access_token`/`scope` columns, currently unused
  (`schema.prisma:427-446`). Add incremental consent for
  `https://www.googleapis.com/auth/tasks` and store the refresh token there.
- **Sync:** Google Tasks has no webhooks — poll with `updatedMin` via the
  existing jobs runner (a `google-tasks-sync` job on the minute-level cron
  that already drives `workflows-tick`). `Task.sourceType`/`sourceId` columns
  already exist for external attribution — store the Google task id there.
- **Model:** one "OpsHub" Google tasklist (or one list per active project —
  proposal will cover both; per-project lists give you categorization from
  Google's side, a single list + triage-inbox in My View is simpler).
  Two-way: quick-add in Google → appears in My View inbox for one-click
  project assignment; complete on either side propagates; last-write-wins on
  conflicts by `updated` timestamp.
- Caveats for the plan: token refresh failure handling (job surfaces auth
  errors to you), API quota is a non-issue at your volume, and recurring
  Google tasks flatten to single OpsHub tasks.

**P5 — Scope trim (ongoing, after the above).**
Hide-don't-delete first: remove sidebar entries / gate behind Owner for the
redundant list in §7, watch for a month, then delete code + models in a
second pass. Deleting the workflow engine alone removes ~240 KB of lib code,
5 pages, 10 models, and the per-minute cron requirement — *if* you're not
running onboarding flows.

### Open questions before Phase 2 starts

1. Which modules hold real data you rely on: partnerships? subcontractors?
   suppliers? certifications? workflows/onboarding? sandbox pages? custom
   reports/widgets? CSV importers beyond the initial load?
2. Roles: is anyone besides you ADMIN or DEVELOPER today? Do any field techs
   legitimately need quote visibility (e.g. a lead who scopes jobs)?
3. My View: is "projects I own" the right default filter, or "all active
   projects" with mine pinned on top?
4. Google Tasks: single shared list or per-project lists? Should completing
   a task in OpsHub complete it in Google (full two-way), or is
   Google→OpsHub one-way enough to start?
