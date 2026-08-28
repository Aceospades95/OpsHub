# OpsHub Enhancement & Architecture Review — July 2026

Response to the nine-part enhancement request (task emails, quote builder,
default views, scheduled jobs, notification engine, vehicle maintenance,
imports, work logs, reliability audit). This document is the blueprint;
the accompanying commit ships the items marked **✅ shipped**. Everything
else is designed here and sequenced in the phased roadmap at the end.

The through-line of the whole review: **OpsHub already has the right
skeletons** — a jobs registry with history and enable/cadence overrides, a
single `notify()`/`sendEmail()` choke point that audits every send, a
declarative importer registry, a key/value settings store, a workflow
engine with DB-editable email templates. What's missing is not
infrastructure but **configurability and explainability layered onto those
choke points**. That's good news: "make everything configurable" is mostly
additive work on existing seams, not rewrites.

---

## 1. Task emails — diagnosed, two real causes ✅ shipped

Both a deployment-lag issue and a genuine bug:

1. **The /tasks page simply didn't render the link yet.** The email chip
   shipped to *My View* only; the /tasks list, by-project view, and task
   drawer never got it. Fixed in the previous commit on this branch
   (`ea5f123`) — synced rows on /tasks now show the Google mark and an
   "Email" chip in both views, and the drawer shows "Open the linked
   email". If the deployed image predates that commit, the chip appears
   after the next deploy.
2. **Old tasks could never backfill the link (bug).** Incremental syncs
   only fetch tasks Google reports as *changed* (`updatedMin`), so any
   task pulled before the `sourceLink` field existed would keep a null
   link forever unless someone edited it in Google. Fixed: a one-time
   **full pull** runs on each account's next sync
   (`GoogleTasksIntegration.fullPulledAt` marker, migration included) and
   the sync now refreshes link metadata even when the task content hasn't
   changed. Re-running a backfill later (if another field is added) is
   "set fullPulledAt to null".

Also note: only tasks that actually carry a Gmail/Docs link in Google get
a chip — Google only attaches one when the task was created from Gmail
(or Docs), so most hand-typed tasks legitimately have none.

## 2. Quote builder ✅ shipped

**In-editor document actions.** The editor header now has
**Download PDF · Preview · Print · Email quote** next to Save. Each
auto-saves first when there are unsaved edits (the PDF always renders
persisted data, so exporting a dirty form would otherwise produce a stale
document — the header shows "Unsaved changes" until saved). Print uses a
hidden frame so you never leave the editor; Preview opens the PDF inline
in a tab.

**Email quote** finally connects the dormant send/track plumbing that was
in the schema from day one but never wired (`publicToken`, `sentAt`,
`firstViewedAt`, the `VIEWED` status, `QuoteEvent`):

- Sends a branded email (new `quote-sent` template) with a tokenized
  public PDF link — the client needs no account; possession of the
  crypto-random token is the credential (share-link trust model).
- New route `GET /api/public/quotes/[token]/pdf`; the first open stamps
  `firstViewedAt` and moves SENT → VIEWED, every open logs a client-actor
  `downloaded` QuoteEvent — so you can see *whether the client opened it*.
- Sending moves DRAFT/REVISED → SENT (locks editing; revisions remain the
  change path), stamps `sentAt`, logs a `sent` event.
- Available in the editor and on the quote detail menu ("Email to
  client"); the recipient prefills from the client's primary contact.

**PDF redesign.** Full rewrite of the renderer: accent header band +
embedded company logo (actual logo bytes through the storage driver — the
old code declared a logo field and never rendered it), document meta grid
(Prepared for / Prepared by / Quote no. / Valid until), a real line-item
table (accent header row, zebra striping, right-aligned numerics), tinted
totals card, titled Assumptions/Terms sections, and a fixed footer with
`Page X of Y` on every page.

**Branding is configurable, not coded.** New "Document accent color"
setting in /admin/theme (stored in the same `branding.*` key/value
namespace as the name/logo) themes the PDF; the default is the Wynndalco
green (`#166534`). The renderer derives all tints from that one hex, and
`QuoteDocument` is a pure component of (data, theme) — a future template
picker is "another component + a selector", not a rewrite. Multiple
templates and per-quote template choice are Phase C if wanted.

## 3. Default list views ✅ shipped

Every module with a view toggle now **defaults to Table** — projects,
contracts (were Tree-first), certifications, suppliers, clients,
subcontractors, partnerships, tools, fleet (were Cards-first). Two
deliberate exceptions:

- **Bids keeps Pipeline as the default** — it's a stage board, not a card
  grid; the table is one click away and the choice is remembered.
- **Quotes and Team are already tables** (no toggle to flip).

**The last choice is remembered per module** (new `resolveViewPreference`
helper + a per-module cookie written by the shared toggle): explicit
`?view=` URL always wins (links stay shareable), then your remembered
choice, then the table default. Cookie over DB on purpose — zero schema,
survives refreshes and deploys; it's a per-device display preference like
theme. If you later want it to roam across devices, the helper is the one
place to swap in a DB read.

## 4. Scheduled jobs — the mystery explained, and the framework upgraded

### Why "9 checked, 0 reminders" was CORRECT (and still terrible UX)

Your certifications page counts **statuses**; the job checks **who needs a
reminder today**. The job's scope is: not deleted, not stored-EXPIRED,
**expiration date in the future** (≤400d out), and **no renewal already
submitted**. From your page numbers (14 Active / 1 Expiring / 3 Expired /
7 Pending):

- the **3 Expired** are excluded — reminders are *pre-expiry* nudges; an
  expired cert is past reminding (the cert page and the expired-backstop
  handle those),
- most of the **7 Pending** have no expiration date yet — nothing to
  count down toward,
- renewals already submitted are muted until sign-off (by design — you
  asked for that in the June batch),
- leaving **9 in scope**. Each of those then fires only when it *crosses*
  one of its configured reminder offsets (per-cert `reminderOffsetsDays`,
  default 90d) **and that offset hasn't already fired this cycle**
  (`firedReminderOffsets` dedupe). Your "1 Expiring Soon" cert's offsets
  had already fired on earlier daily runs; the other 8 haven't reached
  their first offset yet. Hence 0 sends — correct, and completely opaque.

### What shipped ✅

- **Self-explaining runs.** The certification and vehicle jobs now emit a
  per-item ledger in the run output, e.g.
  `· NIST CSF Assessor: expires in 210d — waiting; next reminder fires at
  90d out (offsets: 90/30/7)` /
  `· IL Contractor License: expires in 12d — all reminders already sent
  this cycle (sign-off re-arms them)` /
  `→ CJIS Cert: expires in 29d — sent the 30-day reminder to Garry
  Collins, Jake Wright`, plus a summary of what was *out of scope and
  why* ("Not checked: 7 with no expiration date, 3 already expired, 1
  with a renewal already submitted"). The next "why did nothing send?"
  answers itself from /admin/jobs history.
- **Dry-run / preview mode.** `ctx.dryRun` in the job contract + a
  **Preview** button in /admin/jobs for jobs that declare support
  (certification + vehicle checks so far): evaluates everything, prints
  the would-do ledger, sends and writes nothing. Dry runs are recorded as
  `skipped` so they can never satisfy (and suppress) the day's real run,
  and they bypass the "already ran today" gate so previews always work.
  The runner refuses to dry-run jobs that haven't declared support, so a
  handler can never execute for real under a "preview" label.

### What already existed (more than was visible)

Enable/disable per job, cadence override (hourly/daily/weekly/monthly/
manual-only), manual run, full execution history with durations and
output, concurrency guard, crashed-run reaper — all in /admin/jobs. Your
"rigid" impression was accurate anyway, because *what each job does* was
invisible and untunable.

### Jobs v2 design (Phase B) — config over code

Rather than a generic SQL-editing workflow builder (which becomes a
second programming language with no type checker and real injection/
authz risk), the plan is **typed, per-job parameters** + the notification
engine (§5) for everything about the messages:

- `JobConfig.params Json?` — each JobDefinition declares a typed schema
  for its knobs; /admin/jobs/[jobKey] renders a form from it. Cert check:
  default offsets, horizon. Vehicle check: due window, escalation
  thresholds. Bid check: due window. Digests: which reports.
- Recipients/subject/body move OUT of job code into notification rules
  (§5) — jobs *emit typed events*; rules decide who hears about them and
  how.
- Add `nextRunAt` display (computed from cadence + last completed) and a
  per-job "Explain scope" panel (the dry-run button already covers this).
- Retry-with-backoff on failure and failure alerting (a job that fails N
  consecutive runs notifies admins — currently failures just sit in
  history).
- Your custom automations continue to live in **Scheduled Tasks** (email
  a report / broadcast / purge on a schedule) — that's already a small
  workflow builder, and it gains new task types as needed.

## 5. Email & notification engine — inventory done, design set

A full sweep found **23 distinct send sites**. The good news: every one
already flows through two choke points (`notify()` for in-app +
templated mail, `sendEmail()` for raw mail), every send is audited in
`EmailLog`, and 5 sites (scheduled tasks, workflow steps) are *already*
fully admin-configurable with DB-stored templates. The other 18 hardcode
recipients and subject/body strings at the call site, and there is no
per-user or per-type preference layer anywhere.

**Design (Phase B): a `NotificationRule` table keyed by notification
type** — the registry the 18 code-driven sites route through:

```
NotificationRule {
  typeKey        String  @unique   // "certification-expiring", "task-assigned", …
  enabled        Boolean            // kill switch per type
  channelInApp   Boolean
  channelEmail   Boolean
  subjectTemplate String?           // {{variables}} — null = code default
  bodyTemplate    String?
  recipientMode  String             // "default" | "roles" | "explicit" | "both"
  recipientRoles String[]           // e.g. ["ADMIN","MANAGER"]
  extraRecipients String[]          // user ids and/or raw emails
  ccAddresses    String[]
  bccAddresses   String[]
  digest         String?            // null | "daily" | "weekly" — batch instead of instant
  throttleHours  Int?               // suppress repeats per entity within N hours
}
```

- `notify()` consults the rule before sending: enabled? channels? merge
  rule recipients with the code-supplied ones; apply subject/body
  templates over a typed variable map each type declares (the existing
  `WorkflowEmailTemplate` `{{var}}` substitution is reused).
- An **/admin/notifications → "Rules" tab** lists every registered type
  with its trigger description, variables, current recipients, and a
  test-send button. Unknown/missing rule = today's behavior (code
  defaults), so rollout is incremental and nothing breaks.
- Per-user preferences (mute type X, digest-instead-of-instant) hang off
  the same layer later without touching call sites.
- Escalation paths (remind → N days silent → escalate to manager + CC
  list) are modeled as **rule chains** used by the work-log and vehicle
  systems below — one mechanism, three consumers.

This turn also shipped the groundwork cleanups the sweep flagged: the
dead `welcome` template and never-emitted `task-completed` /
`task-due-soon` / `comment-added` types are documented as such (removal
in Phase B), and the new `quote-sent` template joined the registry.

## 6. Vehicle maintenance — spreadsheet decoded, module extension designed

Your workbook is more sophisticated than the current fleet module in one
important way: **per-service-type schedules**. The "Service Overview"
sheet tracks, per vehicle *per service type* (Oil Change / Tire Rotation
/ Inspection…), a recommended frequency in **months AND miles**, last
service date/mileage, and estimated current mileage — due is computed
from whichever bound hits first. OpsHub currently has a single
`nextServiceDate` per vehicle.

**Phase B design** (schema + flows):

- `VehicleServiceSchedule { vehicleId, serviceType, everyMonths?,
  everyMiles?, lastServiceDate?, lastServiceMileage? }` — one row per
  vehicle×service-type, seeded from your sheet by the importer.
- `Vehicle.currentMileage` + `mileageUpdatedAt`, updated by every
  maintenance submission (and an optional monthly "odometer check-in"
  prompt to drivers); estimated mileage extrapolates like your sheet.
- **Technician submission flow** = the Google Form, in-app: drivers
  (already scoped to see their vehicle) get a "Log maintenance" form —
  vehicle (prefilled), service type(s), date, mileage, cost, vendor,
  notes, receipt/photo uploads (fleet receipts upload path already
  exists). Submitting updates the matching schedule rows and re-arms
  reminders. Registration expiry joins as a schedule type (your fleet
  sheet tracks it; OpsHub doesn't yet).
- **Reminders/escalation through the notification engine**: due-soon →
  driver; overdue N days → + supervisor; overdue M days → + management CC
  list (your "People" sheet's driver→manager mapping becomes data on the
  vehicle/driver, the thresholds live in the vehicle job's params).
- **Importer**: `vehicle-maintenance` importer maps your "Maintenance
  Log" sheet (Timestamp / License Plate / Date / Mileage / Type / Cost /
  Notes / Driver / Receipt) to maintenance rows matched by plate, and
  "Vehicle Fleet Overview" upserts vehicles (plate/VIN as match keys,
  Project link by name, registration expiry). Historical rows import
  once; the form replaces the sheet going forward.

The vehicle job's new dry-run/ledger output (shipped) already gives you
the visibility piece for the current single-date model.

## 7. Data imports — audited; enterprise upgrade designed

The audit covered all 20 importers. Materially: most already match
existing records (each has a hardcoded match key) and support
create-vs-upsert — but two importers (**employees, clients**) ignore the
mode toggle and always update; there's **no preview/dry-run**; upsert
**overwrites every mapped column** (a blank CSV cell wipes existing
data); silently-dropped foreign keys and enum coercions report as clean
"imported"; there's no transaction (a mid-file crash leaves partial
writes, sometimes unaudited); and the result blob miscounts updated rows
as "errors" (a clean upsert run shows a warning icon).

**Phase B design, in priority order:**

1. **Dry-run preview** (the biggest single win): run the exact commit
   path with writes disabled, and show create/update/skip/fail per row —
   plus before→after diffs for updates — before anything commits. The
   importer contract already returns per-row results, so this is
   threading a `dryRun` flag through `commit()` exactly like the jobs
   framework just did.
2. **Modes**: `create-only | update-only | upsert | skip-duplicates`,
   honored by *every* importer (fix users/clients), plus **"only fill
   blanks, never overwrite non-empty"** as a merge option.
3. **Warning status** for soft failures (dropped FK, coerced enum) so
   "imported with 3 warnings" is visible and exportable.
4. **Row-results download** (full CSV of every row's outcome — fix and
   re-upload failed rows), `ImportLog.failed` column, un-pollute the
   errors blob, fix the dead pagination on the audit page.
5. Chunked transactions (per-100-row batches) so a crash can't leave
   half-written unaudited state.

## 8. Daily work logs & overtime — new module, designed from your sheet

Your workbook shows the real workflow: a form (Timestamp / Email / Name /
Work Date / Hours / Tickets-Sites / Notes), a roster with Active flags, a
run log of per-person reminders ("Reminder sent (1/5 days)") and Monday
escalations to a settings-driven list, frozen weekly snapshots with
frozen-vs-live deltas, and a rolling 4-week trend.

**Phase C module — `WorkLog` + `ScheduleException` + rules:**

- `WorkLog { userId, workDate (unique per user+date), hours, sites,
  notes, submittedAt }` — backfill window like today (missing days
  submittable until week's end); duplicate day = **update, not
  double-count** (fixes your double-submission problem at the data
  model).
- `ScheduleException { userId, date range, type: PTO | SICK | HOLIDAY |
  UNPAID | OTHER, approved }` + org holiday calendar — entered by
  managers or the employee, and **the reminder engine treats an
  excepted day as satisfied**. That single table kills the "sick/PTO
  people get nagged" class of noise. (If PTO later lives in a real HR
  system, this table becomes the sync target — the rules don't change.)
- Reminder rules (running on the jobs framework, messaging through the
  notification engine): daily reminder only for *missing, non-excepted,
  employed* workdays (roster = active employees with a start date before
  the day and no termination); weekly escalation Monday morning listing
  who's behind and by how many days, to a configurable recipient list;
  per-person streak counting like your "(1/5 days)" run log. New hires
  start owing logs from their start date; terminated employees drop out
  automatically — statuses OpsHub already tracks.
- **Overtime lens**: weekly rollup per person (hours vs expected,
  >40h flagged), an `approvedOvertime` marker on a week (manager action)
  so approved vs unapproved OT is visually distinct, frozen Monday
  snapshots (a `WorkLogWeekSnapshot` table) preserving the
  "frozen vs live delta" audit trick from your sheet, and a 4-week trend
  report in the reports registry.
- **Importer** for the 500+ historical form responses (match on
  email+date, the Config sheet maps to users by email).

## 9. Reliability audit — 16 findings, 2 fixed now, the rest sequenced

A full write→read trace of every settings surface, all 15 jobs, 4
workflow trigger types, the widget catalog, reports, scheduled tasks, and
the notification registry. **The core is solid** — theme/branding, SSO
allowlist, sidebar editor, permissions/access-requests, jobs admin,
scheduled tasks, reports (system + custom builder), page layouts/widgets
(bar one), Google Tasks settings, comments/mentions all verified
connected end-to-end. The findings:

| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | Recovery bin promises "auto-purge after 30 days" with a live countdown, but nothing ever purges (the purge task type existed in code and wasn't offered by the scheduled-task UI) | High | **✅ fixed** — "Purge old recovery-bin items" is now a creatable scheduled task with a retention setting; create one to make the countdown real |
| 2 | Per-user "Custom Pages" permission grid saves rows nothing reads — granted users still can't see the page | High | Phase B: honor the rows in the sandbox gate + sidebar, or drop the grid |
| 3 | Workflow steps offer "HR / IT / Workflow owner" recipients with no role mapping behind them — configured steps fail or stall silently | High | Phase B: hide the options until a role-mapping setting exists (and add an approver fallback) |
| 4 | "Embed / iFrame" widget in the catalog is a config-less placeholder card | High | **✅ fixed** — delisted from the catalog like the other placeholder widgets |
| 5 | Cadence override dropdown shows for 3 jobs that never consult a cadence gate (they run every tick regardless) | Med | Phase B: gate them or hide the select |
| 6 | Offboarding "on scheduled date" trigger can never fire for UI-managed employees (no termination-date field in any form) | Med | Phase B: add the field to the employee form |
| 7 | "On new User created" onboarding trigger skips CSV-imported and Google-JIT users | Med | Phase B: fire from those paths |
| 8 | STAGE_CHANGE trigger type is accepted + labeled but nothing fires it | Med | Phase B: remove from the action enum until built |
| 9 | Sandbox "Layout" select (default/wide/full) changes only a badge | Med | Phase B: apply or drop |
| 10 | Retired placeholder widgets still render "coming soon" copy in old layouts | Med | Phase B: render a "retired widget" card |
| 11 | Welcome-email org default helper has no UI writer (harmless; per-user toggle works) | Low | Phase B/C |
| 12 | Deactivating a custom report doesn't stop existing scheduled emails of it | Low | Phase B |
| 13 | "Unpublish" custom widget only hides it from the catalog, not from placed layouts | Low | Phase B |
| 14 | Two widget descriptions oversell ("KPI with trend" has no trend; "Bookmarks" aren't configurable) | Low | Phase B copy fix |
| 15 | Three notification types registered but never emitted (`task-due-soon` would be genuinely useful to build) | Low | Phase B |
| 16 | Dead `uploadFileFromForm` action (no call sites) | Low | Phase B delete |

Also fixed under this heading (found during the quote work): the PDF
renderer's logo support was declared-but-never-rendered, and the entire
quote send/track schema (`publicToken`, `sentAt`, `firstViewedAt`,
`VIEWED`, QuoteEvent `sent/downloaded`) was dormant — both are now live
(§2).

---

## The cohesive design, in one picture

```
                    ┌──────────────────────────────────────┐
   typed events     │   NOTIFICATION ENGINE (Phase B)       │   channels
   from anywhere ──▶│   NotificationRule per type:          │──▶ in-app
                    │   enabled · recipients · templates    │──▶ email (+CC/BCC)
   jobs · actions   │   digest · throttle · escalation      │──▶ (SMS later)
   workflows        └──────────────────────────────────────┘
                                   ▲
        ┌──────────────────────────┼──────────────────────────┐
        │ JOBS FRAMEWORK (v2)      │ RULES DATA                │
        │ registry + history       │ ScheduleException (PTO…)  │
        │ enable/cadence (today)   │ VehicleServiceSchedule    │
        │ dry-run + ledger (today) │ reminder offsets (today)  │
        │ typed params (Phase B)   │ escalation thresholds     │
        └──────────────────────────┴──────────────────────────┘
```

Every automation request in this review — cert reminders, vehicle
escalations, work-log nagging, bid deadlines — is the same three-layer
shape: a **job** that evaluates typed **rules data** and emits events
through the **notification engine**. Build the layers once, and each new
automation is configuration plus a small evaluator, not a bespoke email
pipeline. That is the "minimize future development" architecture.

## Phased roadmap

**Phase A — ✅ shipped in this commit**
Task-email backfill fix · quote editor document actions · email-quote +
public tokenized PDF + engagement tracking · branded/themable PDF ·
table-first defaults with remembered preference · jobs dry-run +
self-explaining runs (cert + vehicle) · recovery-bin purge task creatable
· embed-widget delisting.

**Phase B — the configurability core — ✅ shipped 2026-07-11**
All four workstreams landed (commits `86b2463`, `6fded5f`, `e33d16d`, +
the import-framework commit):

- *Notification engine*: `NotificationRule` consulted by `notify()` on
  every send — per-type enable, in-app/email channel toggles, recipients
  added by role/user/external address, email subject+body `{{variable}}`
  overrides, per-entity throttling; emails personalized per recipient
  inside the engine; type registry + "Delivery rules" admin section at
  /admin/notifications with per-type test sends. Dead never-emitted
  types removed (#15).
- *Jobs v2*: `JobConfig.params` + `paramsSchema` → admin-editable typed
  settings per job (bid window; fleet due windows + escalation
  thresholds); 3-consecutive-failure admin alerting (`job-failing`
  through the engine); cadence overrides now real for the every-tick
  jobs (#5).
- *Imports v2*: true dry-run preview (transaction-rollback of the real
  commit path) with per-row create/update/skip/fail/warning outcomes;
  four modes incl. fill-blanks honored by ALL importers (users/clients
  mode bug fixed); warning status for dropped FKs/coerced enums;
  ImportLog failed/warnings counters, clean errors blob, working cursor
  pagination, row-results CSV export; onboarding triggers now fire for
  imported + Google-JIT users (#7). New importers: `vehicles`,
  `vehicle-service-schedules`, `vehicle-maintenance` (fleet spreadsheet
  → OpsHub, with schedule re-arm + odometer roll-forward).
- *Fleet v2*: `VehicleServiceSchedule` (months AND miles, due =
  first-tripping bound) with CRUD + computed status on the vehicle page;
  driver "Log maintenance" submissions (records + schedule re-arm +
  mileage + office ping); registration expiry tracking; maintenance job
  v2 with per-schedule ledger, tunable windows, and weekly manager
  escalations (`vehicle-maintenance-overdue` — put management on that
  type's delivery rule for the CC list).
- *Reliability findings*: #2, #3, #6, #8–#10, #12–#14, #16 all fixed
  (see the findings table above — every row now ✅ except the Phase C
  items noted).

**Phase C — new module + polish — ✅ shipped 2026-07-12**
- *Work Logs module* (`/work-logs` + `/work-logs/team`): one row per
  person per day (duplicate submissions update, never double-count),
  current + previous ISO week back-fill window, PTO/sick/holiday
  `ScheduleException`s (org-wide when no user set) that reminders treat
  as satisfied, roster windows (created/terminated dates) so new hires
  and departed staff never pollute the list, weekly totals with >40h
  flagged red until a manager marks the week's overtime approved,
  frozen Monday snapshots with live deltas, `work-log-reminders` job
  (dry-runnable, self-explaining ledger, graceDays param, Monday
  escalation + snapshot catch-up), historical importer for the Google
  Form responses, and a 4-week `work-logs-weekly` report.
- *Per-user notification preferences* on /notifications — mute any type
  per channel; the engine honors mutes after rule expansion.
- *Vehicle receipts/photos* attach to vehicles (drivers can upload for
  their own vehicle), "Update mileage" quick action, notes visible in
  the fleet list.
- *QA sweep of every custom-builder surface* — the report-preview
  wrapping bug plus a set of genuinely broken builder controls fixed
  (relation sorts that errored saved reports, untyped widget filter
  values, blanked status boards, impossible enum multi-filters); one
  consistent data-table treatment across all preview/result tables.

**Phase D — full control over the built-ins — ✅ shipped 2026-07-16**

- *Work-log enrollment roster* (follow-up to the launch incident where
  the reminder job emailed everyone in the company): work-log reminders
  are now **opt-in per person**. `User.workLogRequired` (default off) +
  `workLogRequiredSince` gate the roster everywhere — the job, the team
  matrix, and the weekly report; enrollment is managed on
  /work-logs/team ("Who submits work logs"), enrollment date is the
  first counted day, and the job ledger leads with the enrolled count
  so an empty roster is visible, not silent.
- *Discoverability cross-links*: every job page now shows "Who gets
  notified — and how to change it" chips linking its notification types
  to /admin/notifications, and the Reports page signposts that job
  emails are configured under Delivery rules + Jobs → Settings — the
  three config surfaces (what/when = Jobs, who/how = Delivery rules,
  data = Reports) explain each other.
- *Editable built-in reports* (`ReportOverride`): every system report
  can now be customized from its page — rename, rewrite the
  description, relabel / hide / reorder columns, cap displayed rows, or
  hide the report entirely. Same override pattern as the rest of the
  platform: the code keeps the query, a DB row owns the presentation,
  absence of the row IS the stock state, and "Reset to defaults"
  deletes it. Applied inside `runReport()` — the single choke point —
  so the admin preview, CSV download, emailed reports, scheduled
  sends, and the daily digest all see the same customized shape
  (hidden columns are stripped from row data too, so a CSV can't leak
  them). Hidden reports drop out of the reports list (collapsed
  recoverable group), the scheduled-task picker (existing tasks keep
  their selection, marked "(hidden)"), and the daily digest; existing
  scheduled sends skip them with a logged warning, mirroring
  deactivated custom reports. Guard rails: an override that would hide
  every column is ignored for visibility, lookup failures degrade to
  stock behavior, and unknown column keys are ignored — the overrides
  layer can never take a report down. "Duplicate as custom report" on
  system report pages deep-links the custom builder pre-set to the
  same entity for admins who want full column/filter control beyond
  presentation.
- *Permutation test blitz*: table-driven suites over every
  configurable system added in this cycle — the notification engine
  (rules × channels × recipient expansion × mutes × throttle ×
  templates), the report-override matrix (labels × hidden × order ×
  caps × malformed config), the jobs framework (statuses × dry-run ×
  disabled × concurrency × failure streaks × params merging × cadence
  gates), importer modes (4 modes × existing/new/in-file dupes ×
  fill-blanks field semantics), work-log rules (enrollment ×
  exceptions × termination × ISO-week edges) and fleet schedule
  boundary states.

**Phase E — polish batch — ✅ shipped 2026-07-17**
- *task-due-reminders job*: open tasks due within a tunable lead window
  (or overdue) remind the assignee — creator when unassigned — once per
  due date (`Task.dueNotifiedFor` re-arms on reschedule, mirroring
  bids); wired through the `task-due-soon` delivery rule.
- *Daily email digest*: per-user opt-in on /notifications → Preferences.
  While on, `notify()` writes the in-app row but skips the immediate
  email; the `notification-email-digest` job sends one daily email
  listing the new items (`Notification.digestedAt` keeps it idempotent;
  enabling stamps the backlog so day one doesn't replay history).
- *Workflow "Specific user" pickers are real dropdowns* — the
  assign-task and approval steps had a raw "cuid of the target user"
  text input; they now list login-capable users by name (departed
  users' saved ids stay selectable, marked, so opening the editor never
  silently rewrites a step).
- *Custom-report builder Save lands on the report view* (it runs
  immediately) instead of the edit form.
- *Engine hygiene*: no-login placeholder users no longer accumulate
  in-app rows they can never read.
- *Paper-cut sweep* (agent-assisted, whole-app): the one remaining
  native `window.confirm` (report Reset) moved to the styled confirm
  dialog; two `alert()` error paths became toasts (quote templates +
  catalog); mixed date formats on the team profile unified to
  `MMM d, yyyy`; supplier/subcontractor/partnership contact email +
  phone are now `mailto:`/`tel:` links (matching certifications); fleet
  maintenance + disciplinary delete/acknowledge buttons disable while
  their mutation is in flight; the orphaned `convertQuoteToInvoice`
  stub (a menu item that never existed) was deleted. The sweep's other
  ten categories — dead buttons, placeholder text, empty states,
  cross-links, confirm coverage, loading states, console leftovers,
  unreachable registry entries, copy consistency, icon aria-labels —
  came back clean.

**Phase F — Google Tasks list fidelity — ✅ shipped 2026-07-18**
Models Google's own structure (lists own tasks) natively instead of
flattening it:
- `GoogleTaskList` mirror (per user: list id, title, default flag),
  refreshed free on every sync from the tasklists fetch the pull
  already makes; `Task.googleListId` stamps each synced task with its
  list on create/update/key-migration/push-pin.
- *My View inbox*: a "Due date | By list" toggle (sticky per browser) —
  By list renders Google-app-style sections (default list first, then
  custom lists; OpsHub-native tasks as their own section); flat mode
  shows a small list chip on synced rows. /tasks rows carry the same
  chip.
- *Send-to-Google destination picker*: the "also add to Google Tasks"
  option in both task dialogs offers YOUR lists (from the mirror);
  assigning to someone else always targets their default list so
  their personal list names stay private (server-enforced).
- *Deleted-list cleanup*: a list removed in Google now mirror-deletes —
  its tasks move to the recovery bin and the mirror row drops —
  instead of leaving orphaned open to-dos.
- Mocked-API sync suite covers the multi-list pull, mirror upsert,
  orphan cleanup, legacy-key stamping, and destination fallback.
Deliberate boundaries: Google Tasks has no webhooks (polling cadence
stays user-tunable); Chat/Docs-assigned tasks remain read-only
(Google 403s writes); OpsHub-native tasks still don't auto-copy into
personal Google accounts — the explicit push is the bridge.

Remaining backlog (small): quote template variants; Google subtask
hierarchy + manual "My order" (phase two of list fidelity, if wanted).

Phase B before C is deliberate: the work-log module's entire value is its
*rules-aware reminders*, which want the notification engine to exist
first — building it on today's hardcoded pattern would recreate the
Google Sheet's problems inside OpsHub.

## Phase G — CRM layer & data hygiene (Aug 2026) ✅ shipped

Driven by the field-usage notes ("what would actually make this usable"):
the system's records now describe *relationships and deadlines*, not just
rows.

- **Unified Contacts** (`/contacts`): one rolodex (`Contact` +
  polymorphic `ContactLink`) replacing four per-org contact tables.
  Links attach people to clients, suppliers, subcontractors,
  partnerships, **bids, projects, and contracts**, each carrying
  multi-select role tags (Executive Sponsor / Procurement / Technical /
  Billing/AP / Field Ops / Scheduling + free text) and a departed flag
  that strikes the person through, surfaces their notes (mailbox
  redirects), and drops them from pickers. Migration backfilled and
  email-deduped the legacy tables; those are now frozen read-only.
  Contacts joined global search, quick-search, soft-delete recovery,
  and the admin merge tool.
- **Renewal Radar** (`/radar` + dashboard card): one screen answering
  "what lapses in N days" across contracts, certifications,
  subcontractor insurance, partnership agreements, fleet
  service/registration, and bid deadlines, plus a data-gaps strip
  (clients with no account manager, WON bids never linked to a
  project/contract, projects missing dates or offering).
- **Bid outcomes**: submitted/decided dates, loss reason, incumbent,
  delivery-project and won-bid→contract links (with a nudge when a WON
  bid has neither), evidence links, and a 30-day staleness flag with
  one-click Mark stale / Revive.
- **Duplicate defense in depth**: importer guardrails (normalized-name
  skip in create mode), the same guard on the project create/edit
  forms, an admin **merge tool** on the project page (dry-run preview →
  one-transaction FK walk over every child table → keeper fill-blanks →
  source to recovery bin), and a `possible-duplicates` admin report
  sweeping projects, clients, certifications, and contacts. The DB
  unique index on (client, normalized name) is deferred until the
  existing duplicates are merged.
- **Derived status everywhere**: certification/contract status is
  date-derived at render on every surface (detail pages, reports,
  widgets — not just the list), the day-math truncation that mislabeled
  "expires tomorrow" as expired is fixed, and the daily cert job now
  writes the stored enum back to EXPIRED once the date passes, with
  ledger lines.
- **Module visibility** (`/admin/modules`): any sidebar module can be
  hidden until it's populated — the empty-nav problem is now a setting,
  not a code change.

## Phase H — measured UX pass (Aug 2026) ✅ shipped

A pixel-measured audit of the running app traced ~30 rendering defects
across eight pages to one stylesheet line and a handful of local
causes. All fixed and re-measured live:

- **Root cause**: `word-break: break-word` on body let any squeezed
  flex child break inside words ("Tasks" → "Task/s", VINs and dates
  shattered) and — worse — let tables collapse below their content
  width so their own `overflow-x` scrollbars never engaged. Now
  `word-break: normal` + `overflow-wrap: break-word` (long tokens
  still break only when they alone overflow), with an opt-in
  `.break-anywhere` utility.
- Pinch-zoom restored on mobile (`maximum-scale=1` removed — WCAG
  1.4.4); page headers wrap instead of crushing the title under heavy
  toolbars; the fixed Edit-Layout pill gets scroll clearance; flow
  pages render their wide/narrow split 7/5 so the narrow column
  clears the ~320px card-header threshold.
- **Org chart legible by default**: compact layout ON, fit-to-view
  clamped at 0.5 scale (d3-org-chart has no lower zoom bound — the
  old default fitted a 3,447px tree into 822px at scale 0.107), SVG
  height synced to the container (was window-sized, pushing the tree
  ~250px down).
- **Work Logs**: the week grid owns the full content width (Friday was
  clipped behind a horizontal scroll); "Log a day" moved to a header
  button + dialog; the KPI strip collapses to one line when all zero.
- **Tables**: enum acronyms render correctly (MSA, not "Msa");
  columns empty across every visible row auto-hide (contracts,
  subcontractors, partnerships, projects "Access"); single-project
  client groups flatten to plain rows and per-group New Project
  buttons are gone; the preferred-subcontractor star has a tooltip.
- **Controls**: Create Task defaults to MEDIUM priority (was silently
  HIGH); the Google-Tasks checkbox is a real touch target; Intranet/
  Tools empty states carry the create button and zero-state controls
  hide; Quotes header links are buttons; the bid-pipeline KPI renders
  compact currency ($48.8M) via a tested `formatCurrency` option.
- ContactLinksCard: >8 people → inline filter + bounded scroll (a
  39-person client rendered a ~3,900px card).

Deliberately not done: an `xl:` breakpoint tier / raising the 1600px
content cap (revisit with real wide-screen usage), and per-row
density inside the shared TreeView (touches every tree in the app).
