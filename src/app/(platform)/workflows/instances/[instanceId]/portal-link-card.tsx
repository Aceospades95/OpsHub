"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Ban, Copy, RefreshCw } from "lucide-react";
import { format } from "date-fns";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useConfirm } from "@/components/shared/use-confirm";
import {
  revokePortalToken,
  reissuePortalToken,
} from "@/actions/workflow-instances";

interface PortalLinkCardProps {
  instanceId: string;
  /** Absolute portal URL, or null when no token has been minted yet. */
  portalUrl: string | null;
  /** True when the subject's token has been revoked. */
  revoked: boolean;
  expiresAt: Date | null;
}

/**
 * Admin-side surface for the subject's portal link. The token is keyed
 * by subject — not by instance — so revoking here kills the link for
 * every workflow instance this subject has; reissuing mints a fresh
 * one (and the old link stays dead).
 *
 * Only rendered for users who can drive instances (manage rights, or
 * MANAGER with edit) — the server actions enforce the same gate.
 */
export function PortalLinkCard({
  instanceId,
  portalUrl,
  revoked,
  expiresAt,
}: PortalLinkCardProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { confirm, ConfirmDialog } = useConfirm();

  const expired = !!expiresAt && expiresAt.getTime() < Date.now();
  const active = !!portalUrl && !revoked;

  async function handleCopy() {
    if (!portalUrl) return;
    try {
      await navigator.clipboard.writeText(portalUrl);
      toast.success("Portal link copied");
    } catch {
      // Clipboard API unavailable — user can still select + copy.
      toast.error("Couldn't copy — select the link text instead");
    }
  }

  async function handleRevoke() {
    const ok = await confirm({
      title: "Revoke this portal link?",
      message:
        "The subject's link stops working immediately — across all of their workflow instances. Reissue afterwards to hand them a new one.",
      confirmLabel: "Revoke link",
      cancelLabel: "Keep link",
    });
    if (!ok) return;
    startTransition(async () => {
      const res = await revokePortalToken(instanceId);
      if ("error" in res && res.error) {
        toast.error(res.error);
        return;
      }
      toast.success("Portal link revoked");
      router.refresh();
    });
  }

  async function handleReissue() {
    // Reissuing over a still-working link kills the old one — make
    // sure that's intentional. Minting over a revoked/missing token
    // breaks nothing, so no dialog there.
    if (active) {
      const ok = await confirm({
        title: "Reissue the portal link?",
        message:
          "A new link will be minted and the current one stops working immediately. You'll need to send the subject the new link.",
        confirmLabel: "Reissue link",
        variant: "default",
      });
      if (!ok) return;
    }
    startTransition(async () => {
      const res = await reissuePortalToken(instanceId);
      if ("error" in res && res.error) {
        toast.error(res.error);
        return;
      }
      const newUrl = "portalUrl" in res ? res.portalUrl : null;
      toast.success("New portal link issued", {
        action: newUrl
          ? {
              label: "Copy",
              onClick: () => {
                void navigator.clipboard.writeText(newUrl).catch(() => {});
              },
            }
          : undefined,
      });
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>Portal link</CardTitle>
          {revoked ? (
            <Badge variant="destructive">Revoked</Badge>
          ) : expired ? (
            <Badge variant="secondary">Expired</Badge>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {portalUrl ? (
          <>
            <div className="flex items-start gap-1.5">
              <p
                className={`font-mono text-xs break-all rounded border border-border bg-muted/30 p-2 flex-1 ${
                  revoked ? "line-through text-muted-foreground" : ""
                }`}
              >
                {portalUrl}
              </p>
              {!revoked && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 shrink-0"
                  onClick={handleCopy}
                  title="Copy portal link"
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {revoked
                ? "This link has been revoked and no longer works. Reissue to mint a new one."
                : expiresAt
                  ? `${expired ? "Expired" : "Expires"} ${format(expiresAt, "MMM d, yyyy")}. The same link covers all of this subject's workflows.`
                  : "The same link covers all of this subject's workflows."}
            </p>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            No portal link has been issued for this subject yet.
          </p>
        )}
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={handleReissue}
            disabled={pending}
          >
            <RefreshCw className="h-3 w-3 mr-1" />
            {pending ? "Working…" : "Reissue link"}
          </Button>
          {active && (
            <Button
              type="button"
              size="sm"
              variant="destructive"
              onClick={handleRevoke}
              disabled={pending}
            >
              <Ban className="h-3 w-3 mr-1" />
              {pending ? "Working…" : "Revoke link"}
            </Button>
          )}
        </div>
        <ConfirmDialog />
      </CardContent>
    </Card>
  );
}
