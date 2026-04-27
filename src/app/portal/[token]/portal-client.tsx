"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  Circle,
  FileUp,
  PenTool,
  ListChecks,
  CheckSquare,
} from "lucide-react";

import { DocumentUploadCard } from "./document-upload-card";
import { SignatureCard } from "./signature-card";
import { FormCard } from "./form-card";
import { TaskCompletionCard } from "./task-completion-card";

interface PortalSubject {
  subjectType: "EMPLOYEE" | "CANDIDATE" | "CUSTOM";
  subjectId: string;
  displayName: string;
  tokenId: string;
}

interface PendingItem {
  instanceStepId: string;
  instanceId: string;
  stepType: string;
  stepName: string;
  config: Record<string, unknown>;
  workflowName: string;
  scheduledFor: string | null;
  isRequired: boolean;
}

interface CompletedItem {
  instanceStepId: string;
  workflowName: string;
  stepName: string;
  stepType: string;
  completedAt: string;
}

interface SerializedView {
  subject: PortalSubject;
  pending: PendingItem[];
  completed: CompletedItem[];
  total: number;
}

interface Props {
  token: string;
  view: SerializedView;
}

const STEP_ICON: Record<string, typeof FileUp> = {
  REQUEST_DOCUMENT: FileUp,
  REQUEST_SIGNATURE: PenTool,
  REQUEST_FORM: ListChecks,
  ASSIGN_TASK_TO_SUBJECT: CheckSquare,
};

export function PortalClient({ token, view }: Props) {
  const router = useRouter();
  const [openItemId, setOpenItemId] = useState<string | null>(null);

  // Group by workflow so the subject sees "Onboarding" / "Offboarding"
  // headers when they're enrolled in more than one. Single-workflow
  // case still renders cleanly (one section).
  const groupedPending = useMemo(() => {
    const map = new Map<string, PendingItem[]>();
    for (const p of view.pending) {
      if (!map.has(p.workflowName)) map.set(p.workflowName, []);
      map.get(p.workflowName)!.push(p);
    }
    return Array.from(map.entries());
  }, [view.pending]);

  const completedCount = view.completed.length;
  const completionPct =
    view.total > 0
      ? Math.round((completedCount / view.total) * 100)
      : 0;
  const allDone = view.pending.length === 0;

  function refresh() {
    setOpenItemId(null);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <section className="rounded-lg bg-white shadow-sm border border-neutral-200 p-6">
        <p className="text-xs uppercase tracking-wide text-neutral-500">
          Welcome
        </p>
        <h1 className="text-2xl font-bold text-neutral-900 mt-1">
          Hi {view.subject.displayName.split(" ")[0]}
        </h1>
        <p className="text-sm text-neutral-600 mt-2">
          {allDone
            ? "You're all caught up. Thanks for taking care of these — your team has been notified."
            : "Here's what we need from you. Work through the items below at your own pace."}
        </p>

        <div className="mt-5">
          <div className="flex items-center justify-between text-xs text-neutral-500 mb-1">
            <span>
              {completedCount}/{view.total} steps complete
            </span>
            <span>{completionPct}%</span>
          </div>
          <div className="h-2 rounded-full bg-neutral-100 overflow-hidden">
            <div
              className="h-full bg-emerald-500 transition-all"
              style={{ width: `${completionPct}%` }}
            />
          </div>
        </div>
      </section>

      {groupedPending.length > 0 ? (
        groupedPending.map(([workflowName, items]) => (
          <section
            key={workflowName}
            className="rounded-lg bg-white shadow-sm border border-neutral-200 p-6"
          >
            <h2 className="text-base font-semibold text-neutral-900 mb-4">
              {workflowName}
            </h2>
            <ul className="space-y-2">
              {items.map((item) => {
                const Icon = STEP_ICON[item.stepType] ?? Circle;
                const isOpen = openItemId === item.instanceStepId;
                return (
                  <li
                    key={item.instanceStepId}
                    className="rounded border border-neutral-200 hover:border-neutral-300 transition-colors"
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setOpenItemId(isOpen ? null : item.instanceStepId)
                      }
                      className="w-full text-left p-3 flex items-start gap-3"
                    >
                      <Icon className="h-4 w-4 mt-0.5 text-neutral-500 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-neutral-900">
                          {item.stepName}
                          {item.isRequired && (
                            <span className="ml-2 text-[10px] uppercase tracking-wide text-rose-600">
                              required
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-neutral-500 mt-0.5">
                          {labelForType(item.stepType)}
                        </p>
                      </div>
                      <span className="text-xs text-neutral-400">
                        {isOpen ? "Close" : "Open"}
                      </span>
                    </button>
                    {isOpen && (
                      <div className="border-t border-neutral-200 p-4 bg-neutral-50">
                        <PortalItemBody
                          token={token}
                          item={item}
                          onComplete={refresh}
                          onCancel={() => setOpenItemId(null)}
                        />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      ) : (
        <section className="rounded-lg bg-emerald-50 border border-emerald-200 p-6 text-center">
          <CheckCircle2 className="h-10 w-10 mx-auto text-emerald-600 mb-2" />
          <p className="font-semibold text-emerald-900">You&apos;re all set</p>
          <p className="text-sm text-emerald-800 mt-1">
            Everything we needed from you is done. Your team has been
            notified — you can close this tab.
          </p>
        </section>
      )}

      {view.completed.length > 0 && (
        <section className="rounded-lg bg-white shadow-sm border border-neutral-200 p-6">
          <h2 className="text-base font-semibold text-neutral-900 mb-3">
            Recently completed
          </h2>
          <ul className="space-y-2">
            {view.completed.slice(0, 8).map((c) => (
              <li
                key={c.instanceStepId}
                className="flex items-center gap-3 text-sm text-neutral-600"
              >
                <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                <span className="flex-1 truncate">{c.stepName}</span>
                <span className="text-xs text-neutral-400">
                  {new Date(c.completedAt).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function labelForType(stepType: string): string {
  switch (stepType) {
    case "REQUEST_DOCUMENT":
      return "Upload a document";
    case "REQUEST_SIGNATURE":
      return "Sign an agreement";
    case "REQUEST_FORM":
      return "Fill out a form";
    case "ASSIGN_TASK_TO_SUBJECT":
      return "Task";
    default:
      return stepType.toLowerCase().replace(/_/g, " ");
  }
}

function PortalItemBody({
  token,
  item,
  onComplete,
  onCancel,
}: {
  token: string;
  item: PendingItem;
  onComplete: () => void;
  onCancel: () => void;
}) {
  switch (item.stepType) {
    case "REQUEST_DOCUMENT":
      return (
        <DocumentUploadCard
          token={token}
          item={item}
          onComplete={onComplete}
          onCancel={onCancel}
        />
      );
    case "REQUEST_SIGNATURE":
      return (
        <SignatureCard
          token={token}
          item={item}
          onComplete={onComplete}
          onCancel={onCancel}
        />
      );
    case "REQUEST_FORM":
      return (
        <FormCard
          token={token}
          item={item}
          onComplete={onComplete}
          onCancel={onCancel}
        />
      );
    case "ASSIGN_TASK_TO_SUBJECT":
      return (
        <TaskCompletionCard
          token={token}
          item={item}
          onComplete={onComplete}
          onCancel={onCancel}
        />
      );
    default:
      return (
        <p className="text-sm text-neutral-500">
          This step type can&apos;t be completed from the portal.
        </p>
      );
  }
}

export type { PendingItem };
