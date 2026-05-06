"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useFormState } from "react-dom";
import { Button } from "@/components/ui/button";
import { createUser } from "@/actions/admin";
import { Plus, Copy, Check } from "lucide-react";

const ROLES = ["GUEST", "VIEWER", "CONTRIBUTOR", "DEVELOPER", "MANAGER", "ADMIN"];

interface WorkflowTemplate {
  id: string;
  name: string;
  type: string;
}

interface Props {
  allUsers: { id: string; name: string }[];
  /** Active EMPLOYEE-subject workflow templates the admin can choose
   *  to fire against the new user (in addition to any auto-trigger
   *  templates that always fire on user create). */
  workflowTemplates: WorkflowTemplate[];
  /** Org-wide default for the "Send welcome email" checkbox.
   *  Configured at /admin/settings; the create dialog still lets the
   *  admin opt out for an individual user even when the default is on. */
  defaultSendWelcomeEmail: boolean;
}

export function UserCreateButton({ allUsers, workflowTemplates, defaultSendWelcomeEmail }: Props) {
  const [open, setOpen] = useState(false);
  const [hasLogin, setHasLogin] = useState(true);
  const [sendWelcomeEmail, setSendWelcomeEmail] = useState(defaultSendWelcomeEmail);
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<string[]>([]);
  const [state, action] = useFormState(createUser, null);
  const [copied, setCopied] = useState(false);
  const router = useRouter();

  // Same invite-URL passthrough as the team-page Add Employee dialog.
  // Hold the dialog open after success when an inviteUrl was issued,
  // so the admin can copy the link before closing.
  const successInviteUrl =
    state && "success" in state && state.success && "inviteUrl" in state
      ? state.inviteUrl ?? null
      : null;

  useEffect(() => {
    if (state && "success" in state && state.success && !successInviteUrl) {
      setOpen(false);
      setHasLogin(true);
      setSendWelcomeEmail(defaultSendWelcomeEmail);
      setSelectedTemplateIds([]);
      router.refresh();
    }
  }, [state, router, defaultSendWelcomeEmail, successInviteUrl]);

  function handleAckSuccess() {
    setOpen(false);
    setHasLogin(true);
    setSendWelcomeEmail(defaultSendWelcomeEmail);
    setSelectedTemplateIds([]);
    setCopied(false);
    router.refresh();
  }

  async function handleCopy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API unavailable — user can still copy by hand.
    }
  }

  function toggleTemplate(id: string) {
    setSelectedTemplateIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  return (
    <>
      <Button onClick={() => setOpen(true)} size="sm">
        <Plus className="h-4 w-4 mr-1" /> New User
      </Button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setOpen(false)}>
          <div className="bg-card rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold mb-4">Create User</h2>
            <form action={action} className="space-y-4">
              <div>
                <label className="text-sm font-medium">Full Name *</label>
                <input name="name" required className="w-full mt-1 px-3 py-2 text-sm border border-input rounded-md bg-background" />
              </div>

              <div className="flex items-center gap-2 p-3 rounded-md bg-muted">
                <input type="hidden" name="hasLoginAccess" value={hasLogin ? "true" : "false"} />
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={hasLogin} onChange={(e) => setHasLogin(e.target.checked)} className="accent-primary" />
                  Has login access
                </label>
                <span className="text-xs text-muted-foreground">Uncheck for tracked-only employees</span>
              </div>

              {hasLogin && (
                <div>
                  <label className="text-sm font-medium">Email *</label>
                  <input
                    name="email"
                    type="email"
                    className="w-full mt-1 px-3 py-2 text-sm border border-input rounded-md bg-background"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    The new user will receive a one-time link to set their own password.
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
                      ? "Emails the set-password link to the address above."
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
                    {allUsers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </div>
              </div>

              {/* Workflow runner — pick one or more workflows to fire
                  against this user once they're created. The action
                  posts the comma-joined ids in `workflowTemplateIds`
                  and spawns instances synchronously. Any template
                  that's already configured to auto-fire on user-create
                  via an ENTITY_CREATE trigger is de-duplicated server
                  side, so checking it here is a no-op rather than a
                  double-spawn. */}
              {workflowTemplates.length > 0 && (
                <div className="rounded-md border border-input p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium">
                      Send onboarding workflows
                    </label>
                    <span className="text-[10px] text-muted-foreground">
                      Optional · runs after the user is saved
                    </span>
                  </div>
                  <input
                    type="hidden"
                    name="workflowTemplateIds"
                    value={selectedTemplateIds.join(",")}
                  />
                  <div className="space-y-1.5 max-h-40 overflow-y-auto">
                    {workflowTemplates.map((t) => {
                      const checked = selectedTemplateIds.includes(t.id);
                      return (
                        <label
                          key={t.id}
                          className="flex items-start gap-2 text-sm cursor-pointer hover:bg-muted/50 rounded p-1"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleTemplate(t.id)}
                            className="mt-0.5 accent-primary"
                          />
                          <span className="min-w-0">
                            <span className="block">{t.name}</span>
                            <span className="block text-[10px] text-muted-foreground">
                              {t.type.toLowerCase()}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              {state?.error && <p className="text-sm text-destructive">{state.error}</p>}

              {successInviteUrl && (
                <div className="rounded border border-success/40 bg-success/10 p-3 text-sm space-y-2">
                  <p className="font-medium">Invite link</p>
                  <p className="text-xs text-muted-foreground">
                    {sendWelcomeEmail
                      ? "Email sent. Share the link manually if it doesn't arrive."
                      : "Email skipped. Copy the link and send it through your preferred channel."}
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
                    Link expires in 24 hours and can only be used once.
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
                    <Button type="submit">
                      Create User
                      {selectedTemplateIds.length > 0 && (
                        <span className="ml-1 text-xs opacity-80">
                          + run {selectedTemplateIds.length} workflow
                          {selectedTemplateIds.length === 1 ? "" : "s"}
                        </span>
                      )}
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
