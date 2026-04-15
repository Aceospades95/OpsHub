"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useFormState } from "react-dom";
import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2, ShieldCheck, Undo2 } from "lucide-react";
import Link from "next/link";
import { signOffCertification, revokeSignOff } from "@/actions/certifications";

interface Props {
  cert: {
    id: string;
    signedOffAt: Date | null;
    signedOffBy: { id: string; name: string } | null;
    signOffNotes: string | null;
  };
  canSignOff: boolean;
  canRevoke: boolean;
}

export function SignOffCard({ cert, canSignOff, canRevoke }: Props) {
  const [modalOpen, setModalOpen] = useState(false);
  const [signState, signAction] = useFormState(signOffCertification, null);
  const [revokeState, revokeAction] = useFormState(revokeSignOff, null);
  const router = useRouter();

  useEffect(() => {
    if (signState?.success) {
      setModalOpen(false);
      router.refresh();
    }
  }, [signState, router]);

  useEffect(() => {
    if (revokeState?.success) {
      router.refresh();
    }
  }, [revokeState, router]);

  const isSignedOff = !!cert.signedOffAt;

  return (
    <Card className={`h-full ${isSignedOff ? "border-success/40" : ""}`}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4" />
          Sign-Off
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {isSignedOff ? (
          <>
            <div className="flex items-start gap-2">
              <CheckCircle2 className="h-5 w-5 text-success mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-medium">
                  Signed off
                  {cert.signedOffBy && (
                    <>
                      {" by "}
                      <Link
                        href={`/team/${cert.signedOffBy.id}`}
                        className="text-primary hover:underline"
                      >
                        {cert.signedOffBy.name}
                      </Link>
                    </>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  {format(new Date(cert.signedOffAt!), "MMM d, yyyy · h:mm a")}
                </p>
              </div>
            </div>
            {cert.signOffNotes && (
              <div className="bg-muted rounded-md p-3 text-sm whitespace-pre-wrap">
                {cert.signOffNotes}
              </div>
            )}
            {canRevoke && (
              <form action={revokeAction}>
                <input type="hidden" name="id" value={cert.id} />
                <Button
                  type="submit"
                  size="sm"
                  variant="outline"
                  className="text-destructive"
                >
                  <Undo2 className="h-3.5 w-3.5 mr-1" /> Revoke sign-off
                </Button>
                {revokeState?.error && (
                  <p className="text-xs text-destructive mt-2">{revokeState.error}</p>
                )}
              </form>
            )}
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              This certification has not been signed off yet. Signing off stamps your
              name and time, appends a row to the renewal history, and resets
              reminders for the next cycle.
            </p>
            {canSignOff ? (
              <Button onClick={() => setModalOpen(true)} className="w-full">
                <CheckCircle2 className="h-4 w-4 mr-2" /> Mark as signed off
              </Button>
            ) : (
              <p className="text-xs text-muted-foreground italic">
                Only admins and managers can sign off.
              </p>
            )}
          </>
        )}
      </CardContent>

      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setModalOpen(false)}
        >
          <div
            className="bg-card rounded-lg shadow-xl w-full max-w-md p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold mb-2">Sign off certification</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Confirm that this certification is complete. Your name and the current
              timestamp will be recorded on the audit trail.
            </p>
            <form action={signAction} className="space-y-4">
              <input type="hidden" name="id" value={cert.id} />
              <div>
                <label className="text-sm font-medium">Notes (optional)</label>
                <textarea
                  name="notes"
                  rows={3}
                  className="w-full mt-1 px-3 py-2 text-sm border border-input rounded-md bg-background"
                  placeholder="e.g. received renewed certificate from the agency on X"
                />
              </div>
              {signState?.error && (
                <p className="text-sm text-destructive">{signState.error}</p>
              )}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit">
                  <CheckCircle2 className="h-4 w-4 mr-1" /> Confirm sign-off
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </Card>
  );
}
