"use client";

import { useEffect } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { setOvertimeApproved } from "@/actions/work-logs";

function ToggleButton({ approved }: { approved: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      size="sm"
      variant={approved ? "ghost" : "outline"}
      className="h-7 px-2 text-xs"
      disabled={pending}
    >
      {pending ? "…" : approved ? "Revoke" : "Approve OT"}
    </Button>
  );
}

/** Approve / revoke the >40h flag for one person-week (canManage only). */
export function ApproveOtButton({
  userId,
  weekKey,
  approved,
}: {
  userId: string;
  weekKey: string;
  approved: boolean;
}) {
  const [state, formAction] = useFormState(setOvertimeApproved, null);
  const router = useRouter();

  useEffect(() => {
    if (state?.success) router.refresh();
  }, [state, router]);

  return (
    <form action={formAction} className="inline-flex items-center gap-1">
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="weekKey" value={weekKey} />
      <input type="hidden" name="approved" value={approved ? "false" : "true"} />
      <ToggleButton approved={approved} />
      {state?.error && <span className="text-xs text-destructive">{state.error}</span>}
    </form>
  );
}
