/**
 * Default workflow templates seeded into the database.
 *
 * These exact three templates ship with OpsHub per the spec — they're
 * the working examples a new user sees the first time they open the
 * Workflows section. Each one is marked `isSeed: true` so the UI hides
 * delete; admins can edit content + archive but not remove identity.
 *
 * The seed runner (prisma/seed-workflow-defaults.ts) is idempotent: if
 * a template with the same `name` and `isSeed: true` already exists,
 * it's left alone. To force-refresh during development, archive the
 * existing copy and re-run — the seed will create a new row alongside.
 */

import type { WorkflowStepType, WorkflowTimingType, WorkflowType, WorkflowSubjectType } from "@prisma/client";

export interface SeedStep {
  name: string;
  stepType: WorkflowStepType;
  config: Record<string, unknown>;
  timingType: WorkflowTimingType;
  timingValue: number;
  isRequired: boolean;
}

export interface SeedTemplate {
  name: string;
  description: string;
  type: WorkflowType;
  subjectEntityType: WorkflowSubjectType;
  steps: SeedStep[];
}

export const DEFAULT_SEED_TEMPLATES: SeedTemplate[] = [
  {
    name: "Employee onboarding (default)",
    description:
      "Standard new-hire sequence — welcome email, document collection, IT provisioning, day-one orientation, and a 30/90-day feedback loop.",
    type: "ONBOARDING",
    subjectEntityType: "EMPLOYEE",
    steps: [
      {
        name: "Welcome email with portal link",
        stepType: "SEND_EMAIL",
        config: {
          toRecipient: "subject",
          emailTemplateId: "",
        },
        timingType: "DAYS_AFTER_START",
        timingValue: -7,
        isRequired: true,
      },
      {
        name: "Manager: set up workspace + equipment",
        stepType: "ASSIGN_TASK_TO_USER",
        config: {
          assignee: "manager",
          title: "Set up workspace and equipment for {{subject.fullName}}",
          description: "Order laptop, peripherals, and book a desk if applicable.",
          dueOffsetDays: -5,
        },
        timingType: "DAYS_AFTER_START",
        timingValue: -7,
        isRequired: true,
      },
      {
        name: "Sign offer letter / employment agreement",
        stepType: "REQUEST_SIGNATURE",
        config: {
          documentText:
            "Standard employment agreement — replace this with your company's actual offer letter text.",
          required: true,
        },
        timingType: "DAYS_AFTER_START",
        timingValue: -5,
        isRequired: true,
      },
      {
        name: "Upload W-4",
        stepType: "REQUEST_DOCUMENT",
        config: { documentName: "W-4", required: true },
        timingType: "DAYS_AFTER_START",
        timingValue: -5,
        isRequired: true,
      },
      {
        name: "Upload I-9",
        stepType: "REQUEST_DOCUMENT",
        config: { documentName: "I-9", required: true },
        timingType: "DAYS_AFTER_START",
        timingValue: -5,
        isRequired: true,
      },
      {
        name: "Upload direct deposit form",
        stepType: "REQUEST_DOCUMENT",
        config: { documentName: "Direct deposit form", required: true },
        timingType: "DAYS_AFTER_START",
        timingValue: -5,
        isRequired: true,
      },
      {
        name: "IT: provision Google Workspace",
        stepType: "PROVISION_ACCESS",
        config: { system: "Google Workspace" },
        timingType: "DAYS_AFTER_START",
        timingValue: -3,
        isRequired: true,
      },
      {
        name: "IT: provision Slack",
        stepType: "PROVISION_ACCESS",
        config: { system: "Slack" },
        timingType: "DAYS_AFTER_START",
        timingValue: -3,
        isRequired: true,
      },
      {
        name: "IT: provision 1Password",
        stepType: "PROVISION_ACCESS",
        config: { system: "1Password" },
        timingType: "DAYS_AFTER_START",
        timingValue: -3,
        isRequired: true,
      },
      {
        name: "First-day welcome email",
        stepType: "SEND_EMAIL",
        config: { toRecipient: "subject", emailTemplateId: "" },
        timingType: "DAYS_AFTER_START",
        timingValue: 0,
        isRequired: true,
      },
      {
        name: "Onboarding 1:1 with manager",
        stepType: "SCHEDULE_MEETING",
        config: {
          meetingTitle: "Onboarding 1:1",
          attendees: ["subject", "manager"],
          durationMinutes: 30,
          offsetDays: 0,
        },
        timingType: "DAYS_AFTER_START",
        timingValue: 0,
        isRequired: true,
      },
      {
        name: "First-day questionnaire",
        stepType: "REQUEST_FORM",
        config: {
          fields: [
            {
              key: "tools_needed",
              label: "Tools or software you need access to",
              type: "textarea",
              required: false,
            },
            {
              key: "shirt_size",
              label: "T-shirt size",
              type: "select",
              required: false,
              options: [
                { label: "XS", value: "XS" },
                { label: "S", value: "S" },
                { label: "M", value: "M" },
                { label: "L", value: "L" },
                { label: "XL", value: "XL" },
                { label: "XXL", value: "XXL" },
              ],
            },
            {
              key: "dietary_restrictions",
              label: "Dietary restrictions",
              type: "text",
              required: false,
            },
          ],
        },
        timingType: "DAYS_AFTER_START",
        timingValue: 1,
        isRequired: false,
      },
      {
        name: "Manager: week-1 check-in",
        stepType: "ASSIGN_TASK_TO_USER",
        config: {
          assignee: "manager",
          title: "Week 1 check-in with {{subject.fullName}}",
          dueOffsetDays: 7,
        },
        timingType: "DAYS_AFTER_START",
        timingValue: 7,
        isRequired: true,
      },
      {
        name: "30-day feedback survey",
        stepType: "REQUEST_FORM",
        config: {
          fields: [
            {
              key: "going_well",
              label: "What's going well?",
              type: "textarea",
              required: false,
            },
            {
              key: "blockers",
              label: "Anything getting in your way?",
              type: "textarea",
              required: false,
            },
          ],
        },
        timingType: "DAYS_AFTER_START",
        timingValue: 30,
        isRequired: false,
      },
      {
        name: "90-day review",
        stepType: "APPROVAL",
        config: {
          approver: "manager",
          prompt:
            "Approve {{subject.fullName}}'s 90-day milestone? Tick once the review meeting is complete.",
        },
        timingType: "DAYS_AFTER_START",
        timingValue: 90,
        isRequired: true,
      },
    ],
  },

  {
    name: "Employee offboarding (default)",
    description:
      "Standard departure sequence — knowledge transfer, equipment return, access deprovisioning, and final paperwork. Targets a termination_date.",
    type: "OFFBOARDING",
    subjectEntityType: "EMPLOYEE",
    steps: [
      {
        name: "HR: notification of offboarding",
        stepType: "SEND_EMAIL",
        config: { toRecipient: "hr", emailTemplateId: "" },
        timingType: "ON_ENTRY",
        timingValue: 0,
        isRequired: true,
      },
      {
        name: "Manager: knowledge transfer plan",
        stepType: "ASSIGN_TASK_TO_USER",
        config: {
          assignee: "manager",
          title: "Knowledge transfer plan for {{subject.fullName}}",
          description:
            "Document open work, ownership areas, and successors before access is removed.",
          dueOffsetDays: -7,
        },
        timingType: "ON_ENTRY",
        timingValue: 0,
        isRequired: true,
      },
      {
        name: "IT: schedule access removal",
        stepType: "ASSIGN_TASK_TO_USER",
        config: {
          assignee: "it",
          title: "Remove access on {{workflow.targetDate}}: Google, Slack, GitHub, 1Password, VPN",
          dueOffsetDays: 0,
        },
        timingType: "DAYS_BEFORE_TARGET",
        timingValue: 7,
        isRequired: true,
      },
      {
        name: "Return of company property checklist",
        stepType: "REQUEST_DOCUMENT",
        config: {
          documentName: "Property return form",
          description:
            "Photo or scan confirming return of laptop, badge, and other company-owned items.",
          required: true,
        },
        timingType: "DAYS_BEFORE_TARGET",
        timingValue: 3,
        isRequired: true,
      },
      {
        name: "Manager: exit interview",
        stepType: "SCHEDULE_MEETING",
        config: {
          meetingTitle: "Exit interview",
          attendees: ["subject", "manager"],
          durationMinutes: 45,
          offsetDays: 0,
        },
        timingType: "DAYS_BEFORE_TARGET",
        timingValue: 1,
        isRequired: true,
      },
      {
        name: "Deprovision Google Workspace",
        stepType: "DEPROVISION_ACCESS",
        config: { system: "Google Workspace" },
        timingType: "DAYS_BEFORE_TARGET",
        timingValue: 0,
        isRequired: true,
      },
      {
        name: "Deprovision Slack",
        stepType: "DEPROVISION_ACCESS",
        config: { system: "Slack" },
        timingType: "DAYS_BEFORE_TARGET",
        timingValue: 0,
        isRequired: true,
      },
      {
        name: "Deprovision GitHub",
        stepType: "DEPROVISION_ACCESS",
        config: { system: "GitHub" },
        timingType: "DAYS_BEFORE_TARGET",
        timingValue: 0,
        isRequired: true,
      },
      {
        name: "Deprovision 1Password",
        stepType: "DEPROVISION_ACCESS",
        config: { system: "1Password" },
        timingType: "DAYS_BEFORE_TARGET",
        timingValue: 0,
        isRequired: true,
      },
      {
        name: "Deprovision VPN",
        stepType: "DEPROVISION_ACCESS",
        config: { system: "VPN" },
        timingType: "DAYS_BEFORE_TARGET",
        timingValue: 0,
        isRequired: true,
      },
      {
        name: "Final paperwork + benefits info email",
        stepType: "SEND_EMAIL",
        config: { toRecipient: "subject", emailTemplateId: "" },
        timingType: "DAYS_BEFORE_TARGET",
        timingValue: 0,
        isRequired: true,
      },
      {
        name: "HR: final paycheck and COBRA notification",
        stepType: "ASSIGN_TASK_TO_USER",
        config: {
          assignee: "hr",
          title:
            "Issue final paycheck and send COBRA notification to {{subject.fullName}}",
          dueOffsetDays: 1,
        },
        timingType: "DAYS_AFTER_START",
        timingValue: 1,
        isRequired: true,
      },
    ],
  },

];
