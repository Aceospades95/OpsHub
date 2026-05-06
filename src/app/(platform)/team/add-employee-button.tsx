"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useFormState } from "react-dom";
import { createUser } from "@/actions/admin";
import { Button } from "@/components/ui/button";
import { UserPlus, Copy, Check } from "lucide-react";

const ROLES = ["VIEWER", "CONTRIBUTOR", "DEVELOPER", "MANAGER", "ADMIN"];

export function AddEmployeeButton({
  managers,
  defaultSendWelcomeEmail,
}: {
  managers: { id: string; name: string }[];
  /** Org-wide default for the "Send invite email" checkbox. */
  defaultSendWelcomeEmail: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [hasLogin, setHasLogin] = useState(true);
  const [sendWelcomeEmail, setSendWelcomeEmail] = useState(defaultSendWelcomeEmail);
  // After the server returns a duplicate-name warning, the admin can
  // resubmit with this flag true to override the guard and create the
  // second account anyway.
  const [confirmDuplicateName, setConfirmDuplicateName] = useState(false);
  const [state, action] = useFormState(createUser, null);
  const [copied, setCopied] = useState(false);
  const router = useRouter();

  // The success path now includes inviteUrl when one was issued. We
  // hold the dialog open on success so the admin can see + copy the
  // URL before closing — important when email delivery is unverified
  // or off, the admin can hand the link off out-of-band.
  const successInviteUrl =
    state && "success" in state && state.success && "inviteUrl" in state
      ? state.inviteUrl ?? null
      : null;

  useEffect(() => {
    if (state && "success" in state && state.success && !successInviteUrl) {
      // No invite URL to display — close immediately.
      setOpen(false);
      setHasLogin(true);
      setSendWelcomeEmail(defaultSendWelcomeEmail);
      setConfirmDuplicateName(false);
      router.refresh();
    }
  }, [state, router, defaultSendWelcomeEmail, successInviteUrl]);

  // When the admin acknowledges the invite-URL panel, refresh + close.
  function handleAckSuccess() {
    setOpen(false);
    setHasLogin(true);
    setSendWelcomeEmail(defaultSendWelcomeEmail);
    setConfirmDuplicateName(false);
    setCopied(false);
    router.refresh();
  }

  async function handleCopy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API unavailable — user can still select + copy
      // manually from the rendered URL.
    }
  }

  // Reset the override whenever the dialog reopens or the form gets
  // back a non-duplicate response — otherwise a stale toggle could
  // suppress the next legitimate dupe warning.
  useEffect(() => {
    if (!state) return;
    if (!("duplicateName" in state)) setConfirmDuplicateName(false);
  }, [state]);

  const duplicateWarning =
    state && "duplicateName" in state && state.duplicateName
      ? state.duplicateName
      : null;

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <UserPlus className="h-4 w-4 mr-1" /> Add Employee
      </Button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setOpen(false)}>
          <div className="bg-card rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold mb-4">Add Employee</h2>
            <form action={action} className="space-y-4">
              <div>
                <label className="text-sm font-medium">Full Name *</label>
                <input name="name" required className="w-full mt-1 px-3 py-2 text-sm border border-input rounded-md bg-background" />
              </div>

              {/* Login access toggle */}
              <div className="flex items-center gap-2 p-3 rounded-md bg-muted">
                <input type="hidden" name="hasLoginAccess" value={hasLogin ? "true" : "false"} />
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={hasLogin}
                    onChange={(e) => setHasLogin(e.target.checked)}
                    className="accent-primary"
                  />
                  Has login access
                </label>
                <span className="text-xs text-muted-foreground">Uncheck for employees who don&apos;t need a system account</span>
              </div>

              {/* Email — only shown for login users. Password isn't
               *  collected here anymore; the invitee picks their own
               *  via the /signup/[token] flow after we email the link. */}
              {hasLogin && (
                <div>
                  <label className="text-sm font-medium">Email *</label>
                  <input
                    name="email"
                    type="email"
                    className="w-full mt-1 px-3 py-2 text-sm border border-input rounded-md bg-background"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    The new employee will receive a one-time link to set their own password.
                  </p>
                </div>
              )}

              {hasLogin && (
                <div className="flex items-center gap-2 p-3 rounded-md bg-muted">
                  <input type="hidden" name="sendWelcomeEmail" value={sendWelcomeEmail ? "true" : "false"} />
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={sendWelcomeEmail}
                      onChange={(e) => setSendWelcomeEmail(e.target.checked)}
                      className="accent-primary"
                    />
                    Send invite email
                  </label>
                  <span className="text-xs text-muted-foreground">
                    {sendWelcomeEmail
                      ? "Sends a set-password link to the email above."
                      : "Skip the email; copy the invite link from the next screen."}
                  </span>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium">Job Title</label>
                  <input name="jobTitle" className="w-full mt-1 px-3 py-2 text-sm border border-input rounded-md bg-background" />
                </div>
                <div>
                  <label className="text-sm font-medium">System Role</label>
                  <select name="role" defaultValue="VIEWER" className="w-full mt-1 px-3 py-2 text-sm border border-input rounded-md bg-background">
                    {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium">Department</label>
                  <input name="department" className="w-full mt-1 px-3 py-2 text-sm border border-input rounded-md bg-background" />
                </div>
                <div>
                  <label className="text-sm font-medium">Location</label>
                  <input name="location" placeholder="e.g. New York, NY" className="w-full mt-1 px-3 py-2 text-sm border border-input rounded-md bg-background" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium">Phone</label>
                  <input name="phone" className="w-full mt-1 px-3 py-2 text-sm border border-input rounded-md bg-background" />
                </div>
                <div>
                  <label className="text-sm font-medium">Reports To</label>
                  <select name="managerId" className="w-full mt-1 px-3 py-2 text-sm border border-input rounded-md bg-background">
                    <option value="">None</option>
                    {managers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </div>
              </div>

              {duplicateWarning && (
                <div className="rounded border border-warning/40 bg-warning/10 p-3 text-sm space-y-2">
                  <p className="font-medium">
                    Possible duplicate employee
                  </p>
                  <p className="text-muted-foreground">
                    There&rsquo;s already an active employee named{" "}
                    <strong>{duplicateWarning.name}</strong>
                    {duplicateWarning.jobTitle ? ` (${duplicateWarning.jobTitle})` : ""}
                    {duplicateWarning.department ? ` in ${duplicateWarning.department}` : ""}.
                    If this is the same person, edit their record instead of creating
                    a second one.
                  </p>
                  <label className="flex items-start gap-2 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      checked={confirmDuplicateName}
                      onChange={(e) => setConfirmDuplicateName(e.target.checked)}
                      className="mt-0.5 accent-primary"
                    />
                    <span>
                      Yes, this is a different person — create another &ldquo;
                      {duplicateWarning.name}&rdquo; anyway.
                    </span>
                  </label>
                </div>
              )}
              <input
                type="hidden"
                name="confirmDuplicateName"
                value={confirmDuplicateName ? "true" : "false"}
              />

              {state?.error && !duplicateWarning && (
                <p className="text-sm text-destructive">{state.error}</p>
              )}

              {successInviteUrl && (
                <div className="rounded border border-success/40 bg-success/10 p-3 text-sm space-y-2">
                  <p className="font-medium">Invite link</p>
                  <p className="text-xs text-muted-foreground">
                    {sendWelcomeEmail
                      ? "Email sent. The link below is the same one — share it manually if the email doesn't arrive."
                      : "Email skipped. Copy this link and send it to the employee through your preferred channel."}
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 truncate rounded border border-border bg-background px-2 py-1.5 text-xs font-mono">
                      {successInviteUrl}
                    </code>
                    <button
                      type="button"
                      onClick={() => handleCopy(successInviteUrl)}
                      className="inline-flex items-center gap-1 rounded border border-border bg-background px-2 py-1.5 text-xs hover:bg-muted/40 transition-colors"
                    >
                      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                      {copied ? "Copied" : "Copy"}
                    </button>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Link expires in 24 hours and can only be used once. Re-send from the
                    user&rsquo;s admin profile if it expires.
                  </p>
                </div>
              )}

              <div className="flex justify-end gap-2">
                {successInviteUrl ? (
                  <Button type="button" onClick={handleAckSuccess}>
                    Done
                  </Button>
                ) : (
                  <>
                    <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                    <Button
                      type="submit"
                      disabled={!!duplicateWarning && !confirmDuplicateName}
                    >
                      {duplicateWarning && confirmDuplicateName
                        ? "Create anyway"
                        : "Create Employee"}
                    </Button>
                  </>
                )}
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
