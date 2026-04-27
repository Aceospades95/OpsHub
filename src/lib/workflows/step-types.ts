/**
 * Step-type schemas for the workflow engine.
 *
 * Each WorkflowStep stores its type-specific configuration as a JSON blob
 * in the `config` column. This file is the source of truth for the shape
 * of those blobs. The template editor reads from here to render the
 * correct config form per step type, the seed script writes config blobs
 * that match these shapes, and the Phase 4 execution engine will read
 * from here to dispatch steps to their handlers.
 *
 * Adding a new step type:
 *   1. Add it to the WorkflowStepType enum in prisma/schema.prisma
 *   2. Add the matching `Config` interface here
 *   3. Add it to STEP_TYPE_DEFINITIONS with metadata + an empty default
 *   4. Phase 4: add a handler in src/lib/workflows/handlers/<step>.ts
 */

import { z } from "zod";
import type { WorkflowStepType } from "@prisma/client";

// ─── Config shapes ─────────────────────────────────────────────────────

/** send_email — fires an email through the user-editable
 *  WorkflowEmailTemplate registry, with `{{var}}` substitution. */
export interface SendEmailConfig {
  /** "subject" delivers to the workflow's subject (employee/candidate);
   *  the role keys deliver to the user holding that role on the subject. */
  toRecipient: "subject" | "manager" | "hr" | "it" | "owner" | "custom";
  /** Required when toRecipient="custom" — a literal email address. */
  customEmail?: string;
  /** FK to WorkflowEmailTemplate. */
  emailTemplateId: string;
  /** Optional override that wins over the template's subject/body. */
  subjectOverride?: string;
  bodyOverride?: string;
}

export interface AssignTaskToSubjectConfig {
  title: string;
  description?: string;
  dueOffsetDays: number;
}

export interface AssignTaskToUserConfig {
  /** "specific_user" needs assigneeUserId; the role keys resolve at
   *  execution time against the subject. */
  assignee: "specific_user" | "manager" | "hr" | "it" | "owner";
  assigneeUserId?: string;
  title: string;
  description?: string;
  dueOffsetDays: number;
}

export interface RequestDocumentConfig {
  documentName: string;
  description?: string;
  required: boolean;
}

export interface RequestSignatureConfig {
  /** The text the subject must read and sign. Stored verbatim on the
   *  WorkflowSignature row at sign-time so later edits don't change
   *  what was signed. */
  documentText: string;
  required: boolean;
}

export interface RequestFormConfig {
  /** JSON schema describing the form: an array of fields with
   *  type/label/required/options. The portal renders this directly. */
  fields: FormField[];
}

export interface FormField {
  key: string;
  label: string;
  type: "text" | "textarea" | "number" | "date" | "select" | "checkbox";
  required: boolean;
  options?: { label: string; value: string }[];
  helpText?: string;
}

export interface WaitConfig {
  delayDays: number;
}

export interface ConditionalBranchConfig {
  /** A simple expression evaluated against the instance context. The
   *  Phase 4 evaluator supports `subject.field === "value"` shape only;
   *  anything fancier should be a separate step type. */
  condition: string;
  ifTrueStepId?: string;
  ifFalseStepId?: string;
}

export interface ApprovalConfig {
  approver: "specific_user" | "manager" | "hr" | "it" | "owner";
  approverUserId?: string;
  prompt: string;
}

export interface ProvisionAccessConfig {
  /** Display name of the system being provisioned ("Google Workspace",
   *  "Slack", etc.). The Phase 4 handler creates a checklist task for
   *  IT — Phase 6 may add real API integrations. */
  system: string;
  notes?: string;
}

export type DeprovisionAccessConfig = ProvisionAccessConfig;

export interface ScheduleMeetingConfig {
  meetingTitle: string;
  /** Roles invited. The handler resolves them against the subject and
   *  either creates a Calendar event (when wired in Phase 6) or posts
   *  a "schedule this meeting" task. */
  attendees: ("subject" | "manager" | "hr" | "it" | "owner")[];
  durationMinutes: number;
  offsetDays: number;
}

export interface SendReminderConfig {
  to: "subject" | "manager" | "hr" | "it" | "owner";
  emailTemplateId: string;
}

// ─── Discriminated union ───────────────────────────────────────────────

export type StepConfig =
  | { stepType: "SEND_EMAIL"; config: SendEmailConfig }
  | { stepType: "ASSIGN_TASK_TO_SUBJECT"; config: AssignTaskToSubjectConfig }
  | { stepType: "ASSIGN_TASK_TO_USER"; config: AssignTaskToUserConfig }
  | { stepType: "REQUEST_DOCUMENT"; config: RequestDocumentConfig }
  | { stepType: "REQUEST_SIGNATURE"; config: RequestSignatureConfig }
  | { stepType: "REQUEST_FORM"; config: RequestFormConfig }
  | { stepType: "WAIT"; config: WaitConfig }
  | { stepType: "CONDITIONAL_BRANCH"; config: ConditionalBranchConfig }
  | { stepType: "APPROVAL"; config: ApprovalConfig }
  | { stepType: "PROVISION_ACCESS"; config: ProvisionAccessConfig }
  | { stepType: "DEPROVISION_ACCESS"; config: DeprovisionAccessConfig }
  | { stepType: "SCHEDULE_MEETING"; config: ScheduleMeetingConfig }
  | { stepType: "SEND_REMINDER"; config: SendReminderConfig };

// ─── Zod validators ────────────────────────────────────────────────────
//
// Two passes. The "draft" schemas accept partially-filled configs so the
// template editor can save in-progress work — clicking "Send email" in
// the step picker should not error just because emailTemplateId is still
// blank. The runtime check (per-handler) catches missing fields when
// the engine actually tries to execute the step.
//
// Required-at-edit-time fields use `.optional()` (or no `.min(1)`); the
// handlers in src/lib/workflows/handlers/ assert presence with their
// own throw-on-missing checks so a half-finished step that escapes to
// production still fails loudly + shows up as FAILED in the timeline.

const recipientRoleSchema = z.enum([
  "subject",
  "manager",
  "hr",
  "it",
  "owner",
]);

export const stepConfigSchemas: Record<WorkflowStepType, z.ZodTypeAny> = {
  SEND_EMAIL: z.object({
    toRecipient: z.enum(["subject", "manager", "hr", "it", "owner", "custom"]),
    customEmail: z.string().email().optional().or(z.literal("")),
    emailTemplateId: z.string().optional(),
    subjectOverride: z.string().optional(),
    bodyOverride: z.string().optional(),
  }),
  ASSIGN_TASK_TO_SUBJECT: z.object({
    title: z.string().optional(),
    description: z.string().optional(),
    dueOffsetDays: z.number().int().optional(),
  }),
  ASSIGN_TASK_TO_USER: z.object({
    assignee: z.enum(["specific_user", "manager", "hr", "it", "owner"]),
    assigneeUserId: z.string().optional(),
    title: z.string().optional(),
    description: z.string().optional(),
    dueOffsetDays: z.number().int().optional(),
  }),
  REQUEST_DOCUMENT: z.object({
    documentName: z.string().optional(),
    description: z.string().optional(),
    required: z.boolean().optional(),
  }),
  REQUEST_SIGNATURE: z.object({
    documentText: z.string().optional(),
    required: z.boolean().optional(),
  }),
  REQUEST_FORM: z.object({
    fields: z.array(
      z.object({
        key: z.string().min(1),
        label: z.string().optional(),
        type: z.enum(["text", "textarea", "number", "date", "select", "checkbox"]),
        required: z.boolean().optional(),
        options: z
          .array(z.object({ label: z.string(), value: z.string() }))
          .optional(),
        helpText: z.string().optional(),
      })
    ),
  }),
  WAIT: z.object({
    delayDays: z.number().int().min(0),
  }),
  CONDITIONAL_BRANCH: z.object({
    condition: z.string().optional(),
    ifTrueStepId: z.string().optional(),
    ifFalseStepId: z.string().optional(),
  }),
  APPROVAL: z.object({
    approver: z.enum(["specific_user", "manager", "hr", "it", "owner"]),
    approverUserId: z.string().optional(),
    prompt: z.string().optional(),
  }),
  PROVISION_ACCESS: z.object({
    system: z.string().optional(),
    notes: z.string().optional(),
  }),
  DEPROVISION_ACCESS: z.object({
    system: z.string().optional(),
    notes: z.string().optional(),
  }),
  SCHEDULE_MEETING: z.object({
    meetingTitle: z.string().optional(),
    attendees: z.array(recipientRoleSchema).optional(),
    // Allow any duration when present so default config (30) is fine,
    // and skip the bounds check in draft mode.
    durationMinutes: z.number().int().optional(),
    offsetDays: z.number().int().optional(),
  }),
  SEND_REMINDER: z.object({
    to: recipientRoleSchema,
    emailTemplateId: z.string().optional(),
  }),
};

export function validateStepConfig(
  stepType: WorkflowStepType,
  config: unknown
): { ok: true; config: unknown } | { ok: false; error: string } {
  const schema = stepConfigSchemas[stepType];
  if (!schema) {
    return { ok: false, error: `Unknown step type: ${stepType}` };
  }
  const result = schema.safeParse(config);
  if (!result.success) {
    return { ok: false, error: result.error.issues.map((i) => i.message).join(", ") };
  }
  return { ok: true, config: result.data };
}

// ─── Editor metadata ───────────────────────────────────────────────────

export interface StepTypeDefinition {
  /** Step type key. */
  type: WorkflowStepType;
  /** Display label in the step picker. */
  label: string;
  /** One-line description used in the picker and help text. */
  description: string;
  /** Lucide icon name. */
  icon: string;
  /** Default config blob the editor seeds when adding this step. */
  defaultConfig: unknown;
}

export const STEP_TYPE_DEFINITIONS: StepTypeDefinition[] = [
  {
    type: "SEND_EMAIL",
    label: "Send email",
    description: "Send a templated email to the subject or a role-assigned user",
    icon: "Mail",
    defaultConfig: {
      toRecipient: "subject",
      emailTemplateId: "",
    } satisfies SendEmailConfig,
  },
  {
    type: "ASSIGN_TASK_TO_SUBJECT",
    label: "Task for subject",
    description: "Create a task on the subject's portal checklist",
    icon: "CheckSquare",
    defaultConfig: {
      title: "",
      dueOffsetDays: 0,
    } satisfies AssignTaskToSubjectConfig,
  },
  {
    type: "ASSIGN_TASK_TO_USER",
    label: "Task for team",
    description: "Create a task on a specific user or role's dashboard",
    icon: "UserCheck",
    defaultConfig: {
      assignee: "manager",
      title: "",
      dueOffsetDays: 0,
    } satisfies AssignTaskToUserConfig,
  },
  {
    type: "REQUEST_DOCUMENT",
    label: "Request document",
    description: "Subject uploads a file via the portal",
    icon: "FileUp",
    defaultConfig: {
      documentName: "",
      required: true,
    } satisfies RequestDocumentConfig,
  },
  {
    type: "REQUEST_SIGNATURE",
    label: "Request signature",
    description: "Subject e-signs an agreement on the portal",
    icon: "PenTool",
    defaultConfig: {
      documentText: "",
      required: true,
    } satisfies RequestSignatureConfig,
  },
  {
    type: "REQUEST_FORM",
    label: "Request form",
    description: "Subject fills out a structured form on the portal",
    icon: "ListChecks",
    defaultConfig: { fields: [] } satisfies RequestFormConfig,
  },
  {
    type: "WAIT",
    label: "Wait",
    description: "Pause the workflow for N days before the next step runs",
    icon: "Clock",
    defaultConfig: { delayDays: 1 } satisfies WaitConfig,
  },
  {
    type: "CONDITIONAL_BRANCH",
    label: "Conditional branch",
    description: "Skip steps based on a condition over subject data",
    icon: "GitBranch",
    defaultConfig: {
      condition: "",
    } satisfies ConditionalBranchConfig,
  },
  {
    type: "APPROVAL",
    label: "Approval gate",
    description: "Pause until a designated approver decides",
    icon: "ShieldCheck",
    defaultConfig: {
      approver: "manager",
      prompt: "",
    } satisfies ApprovalConfig,
  },
  {
    type: "PROVISION_ACCESS",
    label: "Provision access",
    description: "Track provisioning a system for the subject (IT checklist)",
    icon: "KeyRound",
    defaultConfig: {
      system: "",
    } satisfies ProvisionAccessConfig,
  },
  {
    type: "DEPROVISION_ACCESS",
    label: "Deprovision access",
    description: "Track removing a system's access from the subject",
    icon: "KeySquare",
    defaultConfig: {
      system: "",
    } satisfies DeprovisionAccessConfig,
  },
  {
    type: "SCHEDULE_MEETING",
    label: "Schedule meeting",
    description: "Create a calendar event with role-assigned attendees",
    icon: "Calendar",
    defaultConfig: {
      meetingTitle: "",
      attendees: ["subject", "manager"],
      durationMinutes: 30,
      offsetDays: 0,
    } satisfies ScheduleMeetingConfig,
  },
  {
    type: "SEND_REMINDER",
    label: "Send reminder",
    description: "Nudge a recipient about a pending step",
    icon: "BellRing",
    defaultConfig: {
      to: "subject",
      emailTemplateId: "",
    } satisfies SendReminderConfig,
  },
];

export function getStepTypeDefinition(
  type: WorkflowStepType
): StepTypeDefinition {
  const def = STEP_TYPE_DEFINITIONS.find((d) => d.type === type);
  if (!def) throw new Error(`Unknown step type: ${type}`);
  return def;
}

// ─── Variable substitution (used by step handlers + email rendering) ───

/**
 * Substitute `{{path.to.field}}` references in a string against an instance
 * context object. Missing paths render as the empty string so an outbound
 * email never leaks `{{undefined}}` to a recipient.
 *
 * Supports:
 *   {{subject.firstName}}      → context.subject?.firstName
 *   {{company.name}}           → context.company?.name
 *   {{workflow.startDate}}     → context.workflow?.startDate (formatted)
 *
 * Doesn't support function calls, conditionals, or expressions — that's
 * deliberate. Templates with logic should compose multiple steps instead.
 */
export function substituteVariables(
  input: string,
  context: Record<string, unknown>
): string {
  return input.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, path) => {
    const value = resolvePath(context, String(path).split("."));
    if (value == null) return "";
    if (value instanceof Date) return value.toLocaleDateString();
    return String(value);
  });
}

function resolvePath(obj: unknown, parts: string[]): unknown {
  let cursor: unknown = obj;
  for (const part of parts) {
    if (cursor && typeof cursor === "object" && part in cursor) {
      cursor = (cursor as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return cursor;
}

/** Suggested variable paths exposed in the email template editor's
 *  autocomplete. Workflows running against different subject types can
 *  filter this list — for now it covers all common cases. */
export const SUGGESTED_VARIABLES: { path: string; description: string }[] = [
  { path: "subject.firstName", description: "Subject's first name" },
  { path: "subject.lastName", description: "Subject's last name" },
  { path: "subject.fullName", description: "Subject's full name" },
  { path: "subject.email", description: "Subject's email address" },
  { path: "subject.jobTitle", description: "Subject's job title" },
  { path: "subject.department", description: "Subject's department" },
  { path: "subject.startDate", description: "Subject's start date" },
  { path: "manager.firstName", description: "Manager's first name" },
  { path: "manager.fullName", description: "Manager's full name" },
  { path: "manager.email", description: "Manager's email" },
  { path: "company.name", description: "Company name from branding" },
  { path: "workflow.name", description: "Workflow template name" },
  { path: "workflow.startDate", description: "Workflow start date" },
  { path: "workflow.targetDate", description: "Workflow target date" },
  { path: "portal.url", description: "Subject's portal link" },
];
