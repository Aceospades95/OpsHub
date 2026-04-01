"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateTaskStatus } from "@/actions/tasks";
import { CheckSquare, Square } from "lucide-react";

interface DashboardTaskCheckboxProps {
  taskId: string;
  status: string;
}

export function DashboardTaskCheckbox({ taskId, status }: DashboardTaskCheckboxProps) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleToggle = async () => {
    setLoading(true);
    const newStatus = status === "DONE" ? "TODO" : "DONE";
    await updateTaskStatus(taskId, newStatus);
    router.refresh();
    setLoading(false);
  };

  return (
    <button
      onClick={handleToggle}
      disabled={loading}
      className="shrink-0 hover:opacity-70 transition-opacity disabled:opacity-50"
    >
      {status === "DONE" ? (
        <CheckSquare className="h-4 w-4 text-primary" />
      ) : (
        <Square className="h-4 w-4 text-muted-foreground" />
      )}
    </button>
  );
}
