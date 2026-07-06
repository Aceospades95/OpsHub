"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useFormState } from "react-dom";
import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2, ShieldCheck, Undo2, Hourglass } from "lucide-react";
import Link from "next/link";
import { signOffCertification, revokeSignOff, setRenewalSubmitted } from "@/actions/certifications";

interface Props {
  cert: {
    id: string;
    signedOffAt: Date | null;
    signedOffBy: { id: string; name: string } | null;
    signOffNotes: string | null;
    renewalSubmittedAt: Date | null;
    expirationDate: Date | null;
  };
  canSignOff: boolean;
  canRevoke: boolean;
}

export function SignOffCard({ cert, canSignOff, canRevoke }: Props) {
  const [modalOpen, setModalOpen] = useState(false);
  const [signState, signAction] = useFormState(signOffCertification, null);
  const [revokeState, revokeAction] = useFormState(revokeSignOff, null);
  const [renewalState, renewalAction] = useFormState(setRenewalSubmitted, null);
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

  useEffect(() => {
    if (renewalState?.success) {
      router.refresh();
    }
  }, [renewalState, router]);

  const isSignedOff = !!cert.signedOffAt;
  const renewalSubmitted = !!cert.renewalSubmittedAt;
  // Backstop for stalled renewals: once the expiration passes, lists
  // show the cert as Expired again — flag it here too so whoever opens
  // the card knows the submitted renewal needs chasing, not waiting.
  const renewalStalled =
    renewalSubmitted &&
    !!cert.expirationDate &&
    new Date(cert.expirationDate).getTime() < Date.now();

  return (
    <Card className={`h-full ${isSignedOff ? "border-success/40" : ""}`}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4" />
          Sign-Off
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Renewal-in-progress toggle. While set: expiry reminders are
         *  muted and lists show "Renewal Submitted" instead of
         *  expiring/expired alarms. Sign-off clears it automatically. */}
        <div className="rounded-md border border-border bg-muted p-3">
          {renewalSubmitted ? (
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-start gap-2">
                <Hourglass className={`h-4 w-4 mt-0.5 ${renewalStalled ? "text-destructive" : "text-primary"}`} />
                <div>
                  <p className="text-sm font-medium">Renewal submitted</p>
                  <p className="text-xs text-muted-foreground">
                    {format(new Date(cert.renewalSubmittedAt!), "MMM d, yyyy")} — waiting on the
                    issuing body.{" "}
                    {renewalStalled
                      ? "The certification has since expired — chase the renewal."
                      : "Expiry reminders are paused."}
                  </p>
                </div>
              </div>
              {canSignOff && (
                <form action={renewalAction}>
                  <input type="hidden" name="id" value={cert.id} />
                  <input type="hidden" name="submitted" value="false" />
                  <Button type="submit" size="sm" variant="outline">
                    Clear
                  </Button>
                </form>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                Applied for the renewal and waiting? Mark it submitted to pause the
                expiry reminders until sign-off.
              </p>
              {canSignOff && (
                <form action={renewalAction}>
                  <input type="hidden" name="id" value={cert.id} />
                  <input type="hidden" name="submitted" value="true" />
                  <Button type="submit" size="sm" variant="outline" className="shrink-0">
                    <Hourglass className="h-3.5 w-3.5 mr-1" /> Renewal submitted
                  </Button>
                </form>
              )}
            </div>
          )}
          {renewalState?.error && (
            <p className="text-xs text-destructive mt-2">{renewalState.error}</p>
          )}
        </div>

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
