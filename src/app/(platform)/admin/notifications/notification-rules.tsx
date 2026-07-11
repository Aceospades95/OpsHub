"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Settings2, Send } from "lucide-react";
import {
  saveNotificationRule,
  resetNotificationRule,
  sendRuleTest,
} from "@/actions/notifications";
import type { NotificationTypeInfo } from "@/lib/notifications/registry";
import { TEMPLATE_VARIABLES } from "@/lib/notifications/registry";

export interface RuleRow {
  enabled: boolean;
  channelInApp: boolean;
  channelEmail: boolean;
  recipientRoles: string[];
  recipientUserIds: string[];
  extraEmails: string[];
  subjectTemplate: string | null;
  bodyTemplate: string | null;
  throttleHours: number | null;
}

/**
 * The engine's admin surface: one row per notification type showing its
 * trigger, default recipients, and the configured rule (if any), with a
 * configure dialog + per-type test send. No rule = stock behavior;
 * "Reset" deletes the rule and restores it.
 */
export function NotificationRules({
  types,
  rules,
  users,
  roles,
}: {
  types: NotificationTypeInfo[];
  /** typeKey → rule, only for types that have one. */
  rules: Record<string, RuleRow>;
  users: { id: string; name: string }[];
  roles: string[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<NotificationTypeInfo | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function summary(t: NotificationTypeInfo): { label: string; variant: "outline" | "secondary" | "destructive" }[] {
    const rule = rules[t.key];
    if (!rule) return [{ label: "Defaults", variant: "outline" }];
    const badges: { label: string; variant: "outline" | "secondary" | "destructive" }[] = [];
    if (!rule.enabled) return [{ label: "Disabled", variant: "destructive" }];
    if (!rule.channelInApp) badges.push({ label: "No in-app", variant: "secondary" });
    if (!rule.channelEmail) badges.push({ label: "No email", variant: "secondary" });
    const added = rule.recipientRoles.length + rule.recipientUserIds.length + rule.extraEmails.length;
    if (added > 0) badges.push({ label: `+${added} recipient${added === 1 ? "" : "s"}`, variant: "secondary" });
    if (rule.subjectTemplate || rule.bodyTemplate) badges.push({ label: "Custom copy", variant: "secondary" });
    if (rule.throttleHours) badges.push({ label: `Throttle ${rule.throttleHours}h`, variant: "secondary" });
    if (badges.length === 0) badges.push({ label: "Customized", variant: "secondary" });
    return badges;
  }

  function handleTest(typeKey: string) {
    setTestResult(null);
    startTransition(async () => {
      const res = await sendRuleTest(typeKey);
      setTestResult(
        res && "error" in res && res.error
          ? `Test failed: ${res.error}`
          : `Sample "${typeKey}" sent to you — check the bell (and email log).`
      );
      router.refresh();
      setTimeout(() => setTestResult(null), 6000);
    });
  }

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>Delivery rules</CardTitle>
        <p className="text-sm text-muted-foreground">
          Who hears about each event, on which channels, with what wording —
          without code changes. Types without a rule use their built-in
          behavior; &ldquo;Reset&rdquo; returns to it.
        </p>
      </CardHeader>
      <CardContent>
        {testResult && (
          <p className="text-xs mb-3 text-muted-foreground" role="status">
            {testResult}
          </p>
        )}
        <div className="space-y-1.5">
          {types.map((t) => (
            <div
              key={t.key}
              className="flex items-center gap-3 rounded border border-border px-3 py-2"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-medium">{t.label}</p>
                  {summary(t).map((b) => (
                    <Badge key={b.label} variant={b.variant} className="text-[10px]">
                      {b.label}
                    </Badge>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground truncate" title={t.trigger}>
                  {t.trigger} → {t.defaultRecipients}
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleTest(t.key)}
                className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted"
                title="Send a sample of this type to yourself"
                aria-label={`Test ${t.label}`}
              >
                <Send className="h-3.5 w-3.5" />
              </button>
              <Button size="sm" variant="outline" onClick={() => setEditing(t)}>
                <Settings2 className="h-3.5 w-3.5 mr-1.5" />
                Configure
              </Button>
            </div>
          ))}
        </div>
      </CardContent>

      {editing && (
        <RuleDialog
          type={editing}
          rule={rules[editing.key] ?? null}
          users={users}
          roles={roles}
          onClose={() => setEditing(null)}
        />
      )}
    </Card>
  );
}

function RuleDialog({
  type,
  rule,
  users,
  roles,
  onClose,
}: {
  type: NotificationTypeInfo;
  rule: RuleRow | null;
  users: { id: string; name: string }[];
  roles: string[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(rule?.enabled ?? true);
  const [channelInApp, setChannelInApp] = useState(rule?.channelInApp ?? true);
  const [channelEmail, setChannelEmail] = useState(rule?.channelEmail ?? true);
  const [selRoles, setSelRoles] = useState<string[]>(rule?.recipientRoles ?? []);
  const [selUsers, setSelUsers] = useState<string[]>(rule?.recipientUserIds ?? []);
  const [extraEmails, setExtraEmails] = useState((rule?.extraEmails ?? []).join(", "));
  const [subjectTemplate, setSubjectTemplate] = useState(rule?.subjectTemplate ?? "");
  const [bodyTemplate, setBodyTemplate] = useState(rule?.bodyTemplate ?? "");
  const [throttleHours, setThrottleHours] = useState(
    rule?.throttleHours ? String(rule.throttleHours) : ""
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle(list: string[], value: string, set: (v: string[]) => void) {
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  }

  function handleSave() {
    setError(null);
    startTransition(async () => {
      const res = await saveNotificationRule({
        typeKey: type.key,
        enabled,
        channelInApp,
        channelEmail,
        recipientRoles: selRoles,
        recipientUserIds: selUsers,
        extraEmails,
        subjectTemplate,
        bodyTemplate,
        throttleHours,
      });
      if (res && "error" in res && res.error) {
        setError(res.error);
        return;
      }
      onClose();
      router.refresh();
    });
  }

  function handleReset() {
    startTransition(async () => {
      await resetNotificationRule(type.key);
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog open onClose={onClose} title={`Delivery rule — ${type.label}`}>
      <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
        <p className="text-xs text-muted-foreground">
          Fires when: {type.trigger}. Default recipients: {type.defaultRecipients}.
        </p>

        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            Enabled
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={channelInApp}
              onChange={(e) => setChannelInApp(e.target.checked)}
              disabled={!enabled}
            />
            In-app
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={channelEmail}
              onChange={(e) => setChannelEmail(e.target.checked)}
              disabled={!enabled}
            />
            Email
          </label>
        </div>

        <div>
          <p className="text-xs font-medium mb-1.5">Also notify these roles</p>
          <div className="flex flex-wrap gap-2">
            {roles.map((r) => (
              <label key={r} className="flex items-center gap-1.5 text-xs border border-border rounded px-2 py-1">
                <input
                  type="checkbox"
                  checked={selRoles.includes(r)}
                  onChange={() => toggle(selRoles, r, setSelRoles)}
                />
                {r}
              </label>
            ))}
          </div>
        </div>

        <div>
          <p className="text-xs font-medium mb-1.5">Also notify these people</p>
          <div className="max-h-32 overflow-y-auto border border-border rounded p-2 grid grid-cols-2 gap-1">
            {users.map((u) => (
              <label key={u.id} className="flex items-center gap-1.5 text-xs">
                <input
                  type="checkbox"
                  checked={selUsers.includes(u.id)}
                  onChange={() => toggle(selUsers, u.id, setSelUsers)}
                />
                <span className="truncate">{u.name}</span>
              </label>
            ))}
          </div>
        </div>

        <Textarea
          label="Extra email addresses (each gets their own copy)"
          value={extraEmails}
          onChange={(e) => setExtraEmails(e.target.value)}
          rows={2}
          placeholder="ownership@wynndalco.com, fleet-vendor@example.com"
        />

        <div className="space-y-2">
          <Input
            label="Email subject override (optional)"
            value={subjectTemplate}
            onChange={(e) => setSubjectTemplate(e.target.value)}
            placeholder="Leave blank for the built-in subject"
          />
          <Textarea
            label="Email body override (optional)"
            value={bodyTemplate}
            onChange={(e) => setBodyTemplate(e.target.value)}
            rows={3}
            placeholder="Leave blank for the built-in body"
          />
          <p className="text-[11px] text-muted-foreground">
            Variables: {TEMPLATE_VARIABLES.map((v) => `{{${v}}}`).join(" · ")}
          </p>
        </div>

        <Input
          label="Throttle (hours) — suppress repeats for the same record"
          type="number"
          min="1"
          value={throttleHours}
          onChange={(e) => setThrottleHours(e.target.value)}
          placeholder="No throttle"
        />

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex justify-between gap-2 pt-1">
          <Button variant="outline" onClick={handleReset} disabled={pending || !rule}>
            Reset to defaults
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={pending}>
              {pending ? "Saving…" : "Save rule"}
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
