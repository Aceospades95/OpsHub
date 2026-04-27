"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { updateCandidateStage } from "@/actions/candidates";
import type { CandidateStage } from "@prisma/client";

const STAGE_OPTIONS: { value: CandidateStage; label: string }[] = [
  { value: "APPLIED", label: "Applied" },
  { value: "PHONE_SCREEN", label: "Phone screen" },
  { value: "TECHNICAL_INTERVIEW", label: "Technical interview" },
  { value: "OFFER", label: "Offer extended" },
  { value: "OFFER_ACCEPTED", label: "Offer accepted" },
  { value: "HIRED", label: "Hired" },
  { value: "REJECTED", label: "Rejected" },
  { value: "WITHDRAWN", label: "Withdrawn" },
];

export function StageSelector({
  candidateId,
  stage,
  canEdit,
}: {
  candidateId: string;
  stage: CandidateStage;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!canEdit) {
    return (
      <span className="text-xs uppercase tracking-wide text-muted-foreground">
        Stage: {stage.toLowerCase().replace(/_/g, " ")}
      </span>
    );
  }

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value as CandidateStage;
    setError(null);
    startTransition(async () => {
      const res = await updateCandidateStage(candidateId, next);
      if ("error" in res && res.error) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <select
        value={stage}
        onChange={handleChange}
        disabled={pending}
        className="h-8 rounded border border-input bg-background px-2 text-xs"
      >
        {STAGE_OPTIONS.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
