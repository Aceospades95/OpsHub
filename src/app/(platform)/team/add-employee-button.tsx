"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useFormState } from "react-dom";
import { createUser } from "@/actions/admin";
import { Button } from "@/components/ui/button";
import { UserPlus } from "lucide-react";

const ROLES = ["VIEWER", "CONTRIBUTOR", "DEVELOPER", "MANAGER", "ADMIN"];

export function AddEmployeeButton({
  managers,
  defaultSendWelcomeEmail,
}: {
  managers: { id: string; name: string }[];
  /** Org-wide default for the "Send welcome email" checkbox. */
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
  const router = useRouter();

  useEffect(() => {
    if (state && "success" in state && state.success) {
      setOpen(false);
      setHasLogin(true);
      setSendWelcomeEmail(defaultSendWelcomeEmail);
      setConfirmDuplicateName(false);
      router.refresh();
    }
  }, [state, router, defaultSendWelcomeEmail]);

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

              {/* Email + Password — only shown for login users */}
              {hasLogin && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-sm font-medium">Email *</label>
                    <input name="email" type="email" className="w-full mt-1 px-3 py-2 text-sm border border-input rounded-md bg-background" />
                  </div>
                  <div>
                    <label className="text-sm font-medium">Password *</label>
                    <input name="password" type="password" minLength={6} className="w-full mt-1 px-3 py-2 text-sm border border-input rounded-md bg-background" />
                  </div>
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
                    Send welcome email
                  </label>
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

              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button
                  type="submit"
                  disabled={!!duplicateWarning && !confirmDuplicateName}
                >
                  {duplicateWarning && confirmDuplicateName
                    ? "Create anyway"
                    : "Create Employee"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
