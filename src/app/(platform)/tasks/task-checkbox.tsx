"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateTaskStatus } from "@/actions/tasks";
import { CheckSquare, Square, MinusSquare } from "lucide-react";

interface TaskCheckboxProps {
  taskId: string;
  status: string;
}

export function TaskCheckbox({ taskId, status }: TaskCheckboxProps) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleToggle = async () => {
    setLoading(true);
    const newStatus = status === "DONE" ? "TODO" : "DONE";
    await updateTaskStatus(taskId, newStatus);
    router.refresh();
    setLoading(false);
  };

  const isDone = status === "DONE";
  const isCancelled = status === "CANCELLED";

  if (isCancelled) {
    return <MinusSquare className="h-5 w-5 text-muted-foreground shrink-0" />;
  }

  return (
    <button
      onClick={handleToggle}
      disabled={loading}
      className="shrink-0 hover:opacity-70 transition-opacity disabled:opacity-50"
    >
      {isDone ? (
        <CheckSquare className="h-5 w-5 text-primary" />
      ) : (
        <Square className="h-5 w-5 text-muted-foreground" />
      )}
    </button>
  );
}
