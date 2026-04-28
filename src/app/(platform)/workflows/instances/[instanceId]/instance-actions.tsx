"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Pause,
  Play,
  X,
  PlayCircle,
  CheckCircle2,
  SkipForward,
  ThumbsUp,
  ThumbsDown,
  RefreshCw,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  pauseWorkflowInstance,
  resumeWorkflowInstance,
  cancelWorkflowInstance,
  startWorkflowInstance,
  tickWorkflowInstance,
  completeWorkflowInstanceStep,
  skipWorkflowInstanceStep,
  decideApprovalStep,
} from "@/actions/workflow-instances";

interface InstanceActionsProps {
  instanceId: string;
  status: string;
  canEdit: boolean;
}

export function InstanceActions({ instanceId, status, canEdit }: InstanceActionsProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!canEdit) return null;

  function run<T>(fn: () => Promise<T>) {
    setError(null);
    startTransition(async () => {
      const res = (await fn()) as { error?: string } | { success: true };
      if ("error" in res && res.error) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2">
      {status === "PENDING" && (
        <Button
          size="sm"
          onClick={() => run(() => startWorkflowInstance(instanceId))}
          disabled={pending}
        >
          <PlayCircle className="h-3 w-3 mr-1" />
          Start
        </Button>
      )}
      {status === "IN_PROGRESS" && (
        <>
          <Button
            size="sm"
            variant="outline"
            onClick={() => run(() => tickWorkflowInstance(instanceId))}
            disabled={pending}
            title="Run tick now (process due steps)"
          >
            <RefreshCw className="h-3 w-3 mr-1" />
            Tick
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => run(() => pauseWorkflowInstance(instanceId))}
            disabled={pending}
          >
            <Pause className="h-3 w-3 mr-1" />
            Pause
          </Button>
        </>
      )}
      {status === "PAUSED" && (
        <Button
          size="sm"
          onClick={() => run(() => resumeWorkflowInstance(instanceId))}
          disabled={pending}
        >
          <Play className="h-3 w-3 mr-1" />
          Resume
        </Button>
      )}
      {(status === "PENDING" ||
        status === "IN_PROGRESS" ||
        status === "PAUSED") && (
        <Button
          size="sm"
          variant="destructive"
          onClick={() => {
            if (!confirm("Cancel this workflow? Pending steps will be skipped."))
              return;
            run(() => cancelWorkflowInstance(instanceId));
          }}
          disabled={pending}
        >
          <X className="h-3 w-3 mr-1" />
          Cancel
        </Button>
      )}
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}

interface StepActionsProps {
  instanceStepId: string;
  status: string;
  stepType: string;
  canEdit: boolean;
}

export function StepActions({
  instanceStepId,
  status,
  stepType,
  canEdit,
}: StepActionsProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [approveOpen, setApproveOpen] = useState<"approve" | "reject" | null>(
    null
  );
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!canEdit) return null;

  const isTerminal =
    status === "COMPLETED" || status === "SKIPPED" || status === "CANCELLED";
  if (isTerminal) return null;

  function run<T>(fn: () => Promise<T>) {
    setError(null);
    startTransition(async () => {
      const res = (await fn()) as { error?: string } | { success: true };
      if ("error" in res && res.error) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  function handleApproveSubmit() {
    const decide = approveOpen === "approve";
    run(() => decideApprovalStep(instanceStepId, decide, notes.trim() || undefined));
    setApproveOpen(null);
    setNotes("");
  }

  // APPROVAL has its own pair of buttons; everything else gets the
  // generic Complete + Skip combo.
  if (stepType === "APPROVAL") {
    return (
      <div className="flex items-center gap-1.5">
        <Button
          size="sm"
          variant="outline"
          onClick={() => setApproveOpen("approve")}
          disabled={pending}
        >
          <ThumbsUp className="h-3 w-3 mr-1" />
          Approve
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setApproveOpen("reject")}
          disabled={pending}
        >
          <ThumbsDown className="h-3 w-3 mr-1" />
          Reject
        </Button>

        {approveOpen && (
          <Dialog
            open
            onClose={() => setApproveOpen(null)}
            title={
              approveOpen === "approve" ? "Approve this step" : "Reject this step"
            }
          >
            <div className="space-y-3">
              <Textarea
                label="Notes (optional)"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder={
                  approveOpen === "approve"
                    ? "Anything the next step needs to know"
                    : "Why are you rejecting?"
                }
              />
              {error && <p className="text-sm text-destructive">{error}</p>}
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => setApproveOpen(null)}
                  disabled={pending}
                >
                  Cancel
                </Button>
                <Button onClick={handleApproveSubmit} disabled={pending}>
                  {pending
                    ? "Saving…"
                    : approveOpen === "approve"
                      ? "Approve"
                      : "Reject"}
                </Button>
              </div>
            </div>
          </Dialog>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <Button
        size="sm"
        variant="outline"
        onClick={() => run(() => completeWorkflowInstanceStep(instanceStepId))}
        disabled={pending}
        title="Mark this step complete"
      >
        <CheckCircle2 className="h-3 w-3 mr-1" />
        Complete
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          const reason = prompt("Reason for skipping (optional):");
          if (reason === null) return;
          run(() =>
            skipWorkflowInstanceStep(instanceStepId, reason || undefined)
          );
        }}
        disabled={pending}
      >
        <SkipForward className="h-3 w-3 mr-1" />
        Skip
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
