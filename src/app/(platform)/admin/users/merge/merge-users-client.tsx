"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, Eye, Trash2, Check } from "lucide-react";
import { mergeUsers, type MergePreviewItem } from "@/actions/merge-users";

interface UserOption {
  id: string;
  name: string;
  email: string;
  role: string;
  jobTitle: string | null;
  isActive: boolean;
}

interface Props {
  users: UserOption[];
}

interface PreviewState {
  from: MergePreviewItem;
  to: MergePreviewItem;
  columnsToReassign: number;
  targetEmail: string | null;
}

export function MergeUsersClient({ users }: Props) {
  const router = useRouter();
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [targetEmail, setTargetEmail] = useState("");
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [committed, setCommitted] = useState(false);
  const [pending, startTransition] = useTransition();

  // Filter the keeper dropdown so the same row can't be picked on both
  // sides. Done in JS to keep the underlying option list stable.
  const userOptions = useMemo(
    () =>
      users.map((u) => ({
        id: u.id,
        label:
          `${u.name} (${u.email})` +
          (u.jobTitle ? ` — ${u.jobTitle}` : "") +
          (u.isActive ? "" : " — inactive"),
      })),
    [users]
  );
  const fromOptions = userOptions.filter((u) => u.id !== toId);
  const toOptions = userOptions.filter((u) => u.id !== fromId);

  function handlePreview() {
    setError(null);
    setCommitted(false);
    setPreview(null);
    if (!fromId || !toId) {
      setError("Pick both a source and a keeper before previewing.");
      return;
    }
    startTransition(async () => {
      const result = await mergeUsers({
        fromId,
        toId,
        targetEmail: targetEmail || null,
        dryRun: true,
      });
      if (!result.ok) {
        setError(result.error ?? "Preview failed");
        return;
      }
      setPreview(result.preview ?? null);
    });
  }

  function handleCommit() {
    if (!preview) return;
    if (
      !window.confirm(
        `Merge "${preview.from.name}" (${preview.from.email}) into "${preview.to.name}" (${preview.to.email})?\n\nThis cannot be undone.`
      )
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await mergeUsers({
        fromId,
        toId,
        targetEmail: targetEmail || null,
        dryRun: false,
      });
      if (!result.ok) {
        setError(result.error ?? "Merge failed");
        return;
      }
      setPreview(result.preview ?? null);
      setCommitted(true);
      router.refresh();
    });
  }

  function handleReset() {
    setFromId("");
    setToId("");
    setTargetEmail("");
    setPreview(null);
    setError(null);
    setCommitted(false);
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pick the rows</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Select
                label="Source (will be deleted)"
                value={fromId}
                onChange={(e) => setFromId(e.target.value)}
                placeholder="Select source user…"
                options={fromOptions.map((o) => ({ label: o.label, value: o.id }))}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Every FK pointing at this row gets re-aimed at the keeper before the row
                is deleted.
              </p>
            </div>
            <div>
              <Select
                label="Keeper (will be kept)"
                value={toId}
                onChange={(e) => setToId(e.target.value)}
                placeholder="Select keeper user…"
                options={toOptions.map((o) => ({ label: o.label, value: o.id }))}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Profile fields on this row are preserved as-is; the source&rsquo;s profile
                values are dropped.
              </p>
            </div>
          </div>
          <div>
            <Input
              label="Rename keeper email (optional)"
              type="email"
              value={targetEmail}
              onChange={(e) => setTargetEmail(e.target.value)}
              placeholder="e.g. user@example.com"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Applied AFTER the FK walk. Useful when the keeper happens to be the
              synthetic-email row but the canonical address lives on the source.
            </p>
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={handleReset} disabled={pending}>
              Reset
            </Button>
            <Button onClick={handlePreview} disabled={pending}>
              <Eye className="h-4 w-4 mr-1.5" />
              {pending && !preview ? "Previewing…" : "Preview merge"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {error && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="p-4 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      {preview && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              {committed ? (
                <>
                  <Check className="h-4 w-4 text-success" />
                  Merge complete
                </>
              ) : (
                "Preview"
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-4 items-center">
              <UserSummary user={preview.from} label="Source (deleted)" tone="destructive" />
              <ArrowRight className="h-5 w-5 text-muted-foreground hidden md:block" />
              <UserSummary user={preview.to} label="Keeper (kept)" tone="success" />
            </div>

            <div className="rounded border border-border bg-muted/30 p-3 text-sm space-y-1">
              <p>
                <strong>{preview.columnsToReassign}</strong> FK column(s) will be re-aimed
                from the source onto the keeper, plus four composite-unique tables
                handled per-row.
              </p>
              {preview.targetEmail && (
                <p>
                  Keeper email will be renamed to{" "}
                  <strong className="font-mono">{preview.targetEmail}</strong> after
                  the FK walk.
                </p>
              )}
              <p className="text-muted-foreground">
                Profile-level fields (department, jobTitle, location, phone) on the
                keeper are preserved as-is; the source&rsquo;s values are lost when its
                row is deleted.
              </p>
            </div>

            {!committed && (
              <div className="flex gap-2 justify-end">
                <Button
                  variant="destructive"
                  onClick={handleCommit}
                  disabled={pending}
                >
                  <Trash2 className="h-4 w-4 mr-1.5" />
                  {pending ? "Merging…" : "Commit merge"}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function UserSummary({
  user,
  label,
  tone,
}: {
  user: MergePreviewItem;
  label: string;
  tone: "destructive" | "success";
}) {
  const borderClass =
    tone === "destructive" ? "border-destructive/40" : "border-success/40";
  return (
    <div className={`rounded border ${borderClass} p-3 space-y-1`}>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="font-medium text-sm">{user.name}</p>
      <p className="text-xs text-muted-foreground font-mono break-all">
        {user.email}
      </p>
      <div className="flex flex-wrap gap-1 pt-1">
        <Badge variant="outline" className="text-[10px]">
          {user.role}
        </Badge>
        {user.jobTitle && (
          <Badge variant="outline" className="text-[10px]">
            {user.jobTitle}
          </Badge>
        )}
        {user.department && (
          <Badge variant="outline" className="text-[10px]">
            {user.department}
          </Badge>
        )}
        {!user.isActive && (
          <Badge variant="secondary" className="text-[10px]">
            inactive
          </Badge>
        )}
      </div>
      <p className="text-[10px] text-muted-foreground pt-1">
        {user.attachmentCount} attachment{user.attachmentCount === 1 ? "" : "s"}
      </p>
    </div>
  );
}
