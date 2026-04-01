"use client";

import { useRouter } from "next/navigation";
import { LayoutGrid, GitFork } from "lucide-react";

interface ProjectViewToggleProps {
  currentView: string;
}

export function ProjectViewToggle({ currentView }: ProjectViewToggleProps) {
  const router = useRouter();

  return (
    <div className="flex items-center border border-border rounded overflow-hidden">
      <button
        onClick={() => router.push("/projects?view=cards")}
        className={`p-2 transition-colors ${
          currentView === "cards"
            ? "bg-primary text-primary-foreground"
            : "bg-card text-muted-foreground hover:bg-muted"
        }`}
        title="Card view"
      >
        <LayoutGrid className="h-4 w-4" />
      </button>
      <button
        onClick={() => router.push("/projects?view=tree")}
        className={`p-2 transition-colors ${
          currentView === "tree"
            ? "bg-primary text-primary-foreground"
            : "bg-card text-muted-foreground hover:bg-muted"
        }`}
        title="Tree view"
      >
        <GitFork className="h-4 w-4" />
      </button>
    </div>
  );
}
