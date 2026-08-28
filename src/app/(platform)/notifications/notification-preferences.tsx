"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp } from "lucide-react";
import { setNotificationPref, setEmailDigestPref } from "@/actions/notifications";
import type { NotificationTypeInfo } from "@/lib/notifications/registry";

export interface MyPref {
  typeKey: string;
  muteInApp: boolean;
  muteEmail: boolean;
}

/**
 * Personal mute switches, honored by the notification engine per
 * channel after admin rules expand recipients — a mute always wins for
 * this user. Collapsed by default; the list is long and most people
 * touch it once.
 */
export function NotificationPreferences({
  types,
  prefs,
  emailDigest,
}: {
  types: NotificationTypeInfo[];
  prefs: MyPref[];
  /** Daily email digest mode (User.notificationEmailDigest). */
  emailDigest: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  // Optimistic mirror of the digest flag — the checkbox flips
  // immediately and rolls back if the save fails; the server prop
  // re-syncs it after router.refresh().
  const [digest, setDigest] = useState(emailDigest);
  useEffect(() => setDigest(emailDigest), [emailDigest]);
  const prefByType = new Map(prefs.map((p) => [p.typeKey, p]));
  const mutedCount = prefs.filter((p) => p.muteInApp || p.muteEmail).length;

  function toggle(typeKey: string, channel: "muteInApp" | "muteEmail", value: boolean) {
    const current = prefByType.get(typeKey) ?? {
      typeKey,
      muteInApp: false,
      muteEmail: false,
    };
    startTransition(async () => {
      await setNotificationPref(typeKey, {
        muteInApp: channel === "muteInApp" ? value : current.muteInApp,
        muteEmail: channel === "muteEmail" ? value : current.muteEmail,
      });
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
          <div>
            <CardTitle className="text-sm">Notification preferences</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              {mutedCount > 0
                ? `${mutedCount} type${mutedCount === 1 ? "" : "s"} muted — receive checkboxes below control YOUR copies only.`
                : "Choose which notifications reach you, per channel."}
            </p>
          </div>
          {open ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
          )}
        </button>
      </CardHeader>
      {open && (
        <CardContent>
          <label className="mb-4 flex items-start gap-2 rounded border border-border p-3 text-sm cursor-pointer hover:bg-muted/30">
            <input
              type="checkbox"
              checked={digest}
              disabled={pending}
              onChange={(e) => {
                const enabled = e.target.checked;
                setDigest(enabled);
                startTransition(async () => {
                  const res = await setEmailDigestPref(enabled);
                  if (!res.success) setDigest(!enabled);
                  router.refresh();
                });
              }}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium">Daily email digest</span>
              <span className="block text-xs text-muted-foreground">
                Instead of one email per event, get a single daily email
                listing your new notifications. The bell updates in real
                time either way, and the per-type checkboxes below still
                decide what reaches you at all.
              </span>
            </span>
          </label>
          <div className="grid grid-cols-[1fr_auto_auto] gap-x-6 gap-y-1.5 items-center">
            <span />
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              In-app
            </span>
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Email
            </span>
            {types.map((t) => {
              const p = prefByType.get(t.key);
              return (
                <Row
                  key={t.key}
                  info={t}
                  inApp={!p?.muteInApp}
                  email={!p?.muteEmail}
                  disabled={pending}
                  onChange={(channel, receive) =>
                    toggle(t.key, channel === "inApp" ? "muteInApp" : "muteEmail", !receive)
                  }
                />
              );
            })}
          </div>
          <div className="mt-3 flex items-center justify-between">
            <p className="text-[11px] text-muted-foreground">
              Unchecking mutes that channel for you only — org-wide routing
              stays whatever the admins configured.
            </p>
            {mutedCount > 0 && (
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    for (const p of prefs) {
                      if (p.muteInApp || p.muteEmail) {
                        await setNotificationPref(p.typeKey, {
                          muteInApp: false,
                          muteEmail: false,
                        });
                      }
                    }
                    router.refresh();
                  })
                }
              >
                Receive everything
              </Button>
            )}
          </div>
        </CardContent>
      )}
    </Card>
  );
}

function Row({
  info,
  inApp,
  email,
  disabled,
  onChange,
}: {
  info: NotificationTypeInfo;
  inApp: boolean;
  email: boolean;
  disabled: boolean;
  onChange: (channel: "inApp" | "email", receive: boolean) => void;
}) {
  return (
    <>
      <div className="min-w-0 py-0.5">
        <p className="text-sm">{info.label}</p>
        <p className="text-[11px] text-muted-foreground truncate" title={info.trigger}>
          {info.trigger}
        </p>
      </div>
      <input
        type="checkbox"
        checked={inApp}
        disabled={disabled}
        onChange={(e) => onChange("inApp", e.target.checked)}
        aria-label={`Receive ${info.label} in-app`}
        className="justify-self-center"
      />
      <input
        type="checkbox"
        checked={email}
        disabled={disabled}
        onChange={(e) => onChange("email", e.target.checked)}
        aria-label={`Receive ${info.label} by email`}
        className="justify-self-center"
      />
    </>
  );
}
