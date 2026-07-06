"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createTask } from "@/actions/tasks";
import { Plus, Loader2 } from "lucide-react";

/**
 * One-line task capture for /my: title + optional project, assigned to
 * the current user, no dialog. Reuses the createTask server action.
 */
export function MyQuickAddTask({
  projects,
  assigneeId,
}: {
  projects: { id: string; name: string }[];
  assigneeId: string;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, setPending] = useState(false);
  const [, startTransition] = useTransition();

  async function handleSubmit(formData: FormData) {
    const title = String(formData.get("title") ?? "").trim();
    if (!title) return;
    setPending(true);
    const result = await createTask(null, formData);
    setPending(false);
    if (result && "error" in result && result.error) {
      toast.error(result.error);
      return;
    }
    formRef.current?.reset();
    startTransition(() => router.refresh());
  }

  return (
    <form ref={formRef} action={handleSubmit} className="flex items-center gap-2">
      <input type="hidden" name="assigneeId" value={assigneeId} />
      <input
        name="title"
        placeholder="Quick add a task…"
        required
        maxLength={500}
        className="flex-1 min-w-0 px-3 py-1.5 text-sm border border-input rounded-md bg-background"
        aria-label="New task title"
      />
      <select
        name="projectId"
        className="px-2 py-1.5 text-sm border border-input rounded-md bg-background max-w-[11rem]"
        aria-label="Project for new task"
        defaultValue=""
      >
        <option value="">No project</option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <button
        type="submit"
        disabled={pending}
        className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 shrink-0"
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
        Add
      </button>
    </form>
  );
}
