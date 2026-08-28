"use server";

import { db } from "@/lib/db";
import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import { logActivity } from "@/lib/activity";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { nameField } from "@/lib/validation";
import { parseCalendarDateString } from "@/lib/dates";
import {
  INTERACTION_KIND_LABELS,
  MAX_INTERACTION_NOTES_LENGTH,
  MAX_INTERACTION_SUMMARY_LENGTH,
  isInteractionKind,
} from "@/app/(platform)/contacts/[contactId]/interaction-kinds";

/**
 * Server actions for the contact interaction log (CRM phase 2): dated
 * touches — calls, emails, meetings, notes — on a Contact.
 *
 * Write gate: same as src/actions/contacts.ts — contacts span every
 * module, so writes use the clients module's canEdit as the single
 * "can maintain the rolodex" flag. On top of that, editing or deleting
 * an EXISTING interaction is restricted to its author (or an ADMIN):
 * interactions are one person's account of a conversation, not a
 * shared field.
 *
 * Deletes are HARD deletes on purpose — interactions are annotations,
 * and the CONTACT carries the recoverable lifecycle (soft delete /
 * restore). See the ContactInteraction schema note.
 */

const CONTACTS_WRITE_MODULE = "clients";

// ─── Validation ───────────────────────────────────────────────────

/**
 * Summary is a one-liner that also flows into activity-log details, so
 * it gets the nameField treatment (trim / required / cap / no HTML
 * chars). Notes are long-form free text — cap only, like contact notes.
 */
const interactionFieldsSchema = z.object({
  summary: nameField({ label: "Summary", max: MAX_INTERACTION_SUMMARY_LENGTH }),
  notes: z.string().max(MAX_INTERACTION_NOTES_LENGTH, "Notes are too long").optional(),
});

export interface InteractionInput {
  contactId: string;
  /** One of INTERACTION_KINDS — validated against the closed set. */
  kind: string;
  /** "YYYY-MM-DD" from the date input (or a full ISO timestamp). Blank = now. */
  occurredAt?: string;
  summary: string;
  notes?: string;
}

type ActionResult = {
  success?: boolean;
  error?: string;
  fieldErrors?: Record<string, string[]>;
};

/** Blank notes from a controlled textarea become undefined pre-parse. */
function normalizeFields(input: { summary: string; notes?: string }) {
  return {
    summary: input.summary,
    notes: input.notes?.trim() ? input.notes : undefined,
  };
}

/**
 * Parse the occurredAt form value. "YYYY-MM-DD" (what the date input
 * sends) goes through the house calendar-date helper so it lands at
 * UTC midnight; anything else falls back to `new Date(value)` for full
 * ISO timestamps. Blank returns null (the caller picks the default);
 * unparseable input returns a field error instead of silently becoming
 * "now".
 */
function parseOccurredAt(value: string | undefined): Date | null | { error: string } {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const calendar = parseCalendarDateString(trimmed);
  if (calendar) return calendar;
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return { error: "Enter a valid date" };
  return date;
}

/** Display label for a stored kind — tolerant of rows predating a set change. */
function kindLabel(kind: string): string {
  return isInteractionKind(kind) ? INTERACTION_KIND_LABELS[kind] : kind;
}

// ─── Actions ──────────────────────────────────────────────────────

export async function logInteraction(
  input: InteractionInput
): Promise<ActionResult & { interactionId?: string }> {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, CONTACTS_WRITE_MODULE);
  if (!perms.canEdit) return { error: "Permission denied" };

  if (!isInteractionKind(input.kind)) return { error: "Unknown interaction kind" };

  const parsed = interactionFieldsSchema.safeParse(normalizeFields(input));
  if (!parsed.success) {
    return { error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const occurredAt = parseOccurredAt(input.occurredAt);
  if (occurredAt && "error" in occurredAt) {
    return { error: "Invalid input", fieldErrors: { occurredAt: [occurredAt.error] } };
  }

  // Existence + soft-delete guard — same reasoning as updateContact:
  // no new annotations on a contact that's in the recycle bin.
  const contact = await db.contact.findFirst({
    where: { id: input.contactId, deletedAt: null },
    select: { id: true, name: true },
  });
  if (!contact) return { error: "Not found" };

  const interaction = await db.contactInteraction.create({
    data: {
      contactId: contact.id,
      kind: input.kind,
      occurredAt: occurredAt ?? new Date(),
      summary: parsed.data.summary,
      notes: parsed.data.notes ?? null,
      createdById: user.id,
    },
  });
  await logActivity(
    "logged-interaction",
    "contact",
    contact.id,
    user.id,
    `${INTERACTION_KIND_LABELS[input.kind]}: ${parsed.data.summary}`
  );
  revalidatePath(`/contacts/${contact.id}`);
  revalidatePath("/contacts"); // the list page's "Last touch" column
  return { success: true, interactionId: interaction.id };
}

export async function updateInteraction(
  id: string,
  patch: { kind: string; occurredAt?: string; summary: string; notes?: string }
): Promise<ActionResult> {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, CONTACTS_WRITE_MODULE);
  if (!perms.canEdit) return { error: "Permission denied" };

  const interaction = await db.contactInteraction.findUnique({
    where: { id },
    select: {
      id: true,
      contactId: true,
      createdById: true,
      contact: { select: { deletedAt: true } },
    },
  });
  if (!interaction) return { error: "Not found" };
  // Stale-form guard, same as updateContact: annotations on a deleted
  // contact aren't editable — restore the contact first.
  if (interaction.contact.deletedAt) return { error: "Not found" };

  // Author-or-ADMIN only. createdById is null once the author's account
  // is deleted (FK SetNull) — those rows stay admin-editable only.
  if (interaction.createdById !== user.id && user.role !== "ADMIN") {
    return { error: "Permission denied" };
  }

  if (!isInteractionKind(patch.kind)) return { error: "Unknown interaction kind" };

  const parsed = interactionFieldsSchema.safeParse(normalizeFields(patch));
  if (!parsed.success) {
    return { error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const occurredAt = parseOccurredAt(patch.occurredAt);
  if (occurredAt && "error" in occurredAt) {
    return { error: "Invalid input", fieldErrors: { occurredAt: [occurredAt.error] } };
  }

  await db.contactInteraction.update({
    where: { id },
    data: {
      kind: patch.kind,
      // A blank date on an edit keeps the logged date — resetting an
      // old touch to "now" would silently rewrite the timeline.
      ...(occurredAt ? { occurredAt } : {}),
      summary: parsed.data.summary,
      notes: parsed.data.notes ?? null,
    },
  });
  await logActivity(
    "updated-interaction",
    "contact",
    interaction.contactId,
    user.id,
    `${INTERACTION_KIND_LABELS[patch.kind]}: ${parsed.data.summary}`
  );
  revalidatePath(`/contacts/${interaction.contactId}`);
  revalidatePath("/contacts");
  return { success: true };
}

export async function deleteInteraction(id: string): Promise<ActionResult> {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, CONTACTS_WRITE_MODULE);
  if (!perms.canEdit) return { error: "Permission denied" };

  // Look up first — a stale double-submit would otherwise throw P2025
  // (→ 500), and the row carries what the activity detail needs.
  const interaction = await db.contactInteraction.findUnique({
    where: { id },
    select: { id: true, contactId: true, createdById: true, kind: true, summary: true },
  });
  if (!interaction) return { error: "Not found" };

  if (interaction.createdById !== user.id && user.role !== "ADMIN") {
    return { error: "Permission denied" };
  }

  // Hard delete on purpose — see the module doc comment.
  await db.contactInteraction.delete({ where: { id } });
  await logActivity(
    "deleted-interaction",
    "contact",
    interaction.contactId,
    user.id,
    `${kindLabel(interaction.kind)}: ${interaction.summary}`
  );
  revalidatePath(`/contacts/${interaction.contactId}`);
  revalidatePath("/contacts");
  return { success: true };
}
