"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronUp, Users } from "lucide-react";
import { setWorkLogEnrollment } from "@/actions/work-logs";
import { formatCalendarDate } from "@/lib/dates";

export interface EnrollmentRow {
  id: string;
  name: string;
  workLogRequired: boolean;
  /** ISO string or null. */
  workLogRequiredSince: string | null;
}

/**
 * The opt-in roster — who owes daily work logs (the old sheet's Config
 * tab). Only enrolled people are expected to submit, get reminders,
 * appear in the matrix, or count toward escalations. Everything else
 * about a non-enrolled person keeps working (they can even submit logs
 * voluntarily); they're just never nagged.
 */
export function EnrollmentManager({ people }: { people: EnrollmentRow[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const enrolledCount = people.filter((p) => p.workLogRequired).length;

  function toggle(userId: string, enrolled: boolean) {
    setError(null);
    startTransition(async () => {
      const res = await setWorkLogEnrollment(userId, enrolled);
      if (res && "error" in res && res.error) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <Card className="mb-6">
      <CardHeader className="pb-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center justify-between text-left"
          aria-expanded={open}
        >
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            <CardTitle className="text-sm">
              Who submits work logs ({enrolledCount} enrolled)
            </CardTitle>
          </div>
          {open ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
          )}
        </button>
        {enrolledCount === 0 && (
          <p className="text-xs text-warning mt-1">
            Nobody is enrolled — no reminders go out and the matrix stays
            empty until you check the technicians who owe daily logs.
          </p>
        )}
      </CardHeader>
      {open && (
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
            {people.map((p) => (
              <label
                key={p.id}
                className="flex items-center gap-2 rounded border border-border px-2.5 py-1.5 text-sm"
              >
                <input
                  type="checkbox"
                  checked={p.workLogRequired}
                  disabled={pending}
                  onChange={(e) => toggle(p.id, e.target.checked)}
                />
                <span className="truncate flex-1">{p.name}</span>
                {p.workLogRequired && p.workLogRequiredSince && (
                  <Badge variant="outline" className="text-[10px] shrink-0">
                    since {formatCalendarDate(p.workLogRequiredSince, "MMM d")}
                  </Badge>
                )}
              </label>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground mt-2">
            Enrolling starts the clock from today — earlier days are never
            counted as missing. Reminders, the matrix, escalations, and
            snapshots only ever cover enrolled people.
          </p>
          {error && <p className="text-xs text-destructive mt-2">{error}</p>}
        </CardContent>
      )}
    </Card>
  );
}
