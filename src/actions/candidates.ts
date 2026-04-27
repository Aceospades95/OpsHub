"use server";

import { db } from "@/lib/db";
import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import { logActivity } from "@/lib/activity";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { CandidateStage } from "@prisma/client";

const stageSchema = z.enum([
  "APPLIED",
  "PHONE_SCREEN",
  "TECHNICAL_INTERVIEW",
  "OFFER",
  "OFFER_ACCEPTED",
  "HIRED",
  "REJECTED",
  "WITHDRAWN",
]);

const candidateSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  email: z.string().email("Email must be valid"),
  phone: z.string().nullish(),
  position: z.string().nullish(),
  source: z.string().nullish(),
  resumeUrl: z.string().nullish(),
  notes: z.string().nullish(),
  stage: stageSchema.optional(),
});

function normalizeOptional(v: string | null | undefined): string | null {
  if (v == null) return null;
  const t = String(v).trim();
  return t.length === 0 ? null : t;
}

export async function createCandidate(input: z.infer<typeof candidateSchema>) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "candidates");
  if (!perms.canCreate) return { error: "Permission denied" } as const;

  const parsed = candidateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      error: "Invalid input",
      fieldErrors: parsed.error.flatten().fieldErrors,
    } as const;
  }

  const email = parsed.data.email.trim().toLowerCase();
  const existing = await db.candidate.findUnique({ where: { email } });
  if (existing) {
    return { error: "A candidate with this email already exists" } as const;
  }

  const created = await db.candidate.create({
    data: {
      firstName: parsed.data.firstName.trim(),
      lastName: parsed.data.lastName.trim(),
      email,
      phone: normalizeOptional(parsed.data.phone),
      position: normalizeOptional(parsed.data.position),
      source: normalizeOptional(parsed.data.source),
      resumeUrl: normalizeOptional(parsed.data.resumeUrl),
      notes: normalizeOptional(parsed.data.notes),
      stage: (parsed.data.stage ?? "APPLIED") as CandidateStage,
      createdById: user.id,
    },
  });

  await logActivity(
    "created",
    "candidate",
    created.id,
    user.id,
    `${created.firstName} ${created.lastName}`
  );

  // Fire ENTITY_CREATE workflow triggers — same pattern as createUser.
  // Errors here never block the create itself; isolated workflows
  // shouldn't be able to break candidate creation.
  try {
    const { fireEntityCreateTriggers } = await import("@/lib/workflows/triggers");
    await fireEntityCreateTriggers({
      entityType: "Candidate",
      entityId: created.id,
      createdById: user.id,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[candidates] workflow auto-trigger failed:", err);
  }

  revalidatePath("/candidates");
  return { success: true, id: created.id } as const;
}

export async function updateCandidateStage(
  id: string,
  stage: z.infer<typeof stageSchema>
) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "candidates");
  if (!perms.canEdit) return { error: "Permission denied" } as const;

  const parsed = stageSchema.safeParse(stage);
  if (!parsed.success) return { error: "Invalid stage" } as const;

  await db.candidate.update({
    where: { id },
    data: { stage: parsed.data as CandidateStage },
  });
  await logActivity("updated", "candidate", id, user.id, `stage→${stage}`);
  revalidatePath("/candidates");
  revalidatePath(`/candidates/${id}`);
  return { success: true } as const;
}

export async function deleteCandidate(id: string) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "candidates");
  if (!perms.canDelete) return { error: "Permission denied" } as const;

  const cand = await db.candidate.findUnique({
    where: { id },
    select: { id: true, firstName: true, lastName: true, convertedUserId: true },
  });
  if (!cand) return { error: "Candidate not found" } as const;
  if (cand.convertedUserId) {
    return {
      error: "Can't delete a candidate that's already been hired. Withdraw or reject instead.",
    } as const;
  }
  await db.candidate.delete({ where: { id } });
  await logActivity("deleted", "candidate", id, user.id, `${cand.firstName} ${cand.lastName}`);
  revalidatePath("/candidates");
  return { success: true } as const;
}
