"use client";

import { useState } from "react";
import { OrgChartTree, buildOrgTree } from "@/components/shared/org-chart-tree";
import { Network, List } from "lucide-react";

interface Member {
  id: string;
  role: string;
  user: {
    id: string;
    name: string;
    email: string;
    managerId: string | null;
    jobTitle: string | null;
    department: string | null;
  };
}

export function TeamHierarchy({ members }: { members: Member[] }) {
  const [showHierarchy, setShowHierarchy] = useState(members.length >= 3);

  if (!showHierarchy || members.length < 3) return null;

  const tree = buildOrgTree(
    members.map((m) => ({
      id: m.user.id,
      name: m.user.name,
      jobTitle: m.user.jobTitle,
      department: m.user.department,
      managerId: m.user.managerId,
      role: m.role,
    }))
  );

  return (
    <div className="mb-4 pb-4 border-b border-border">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Team Hierarchy</span>
        <button
          onClick={() => setShowHierarchy(false)}
          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
        >
          <List className="h-3.5 w-3.5" /> List view
        </button>
      </div>
      <OrgChartTree nodes={tree} hideTopHeaderForSingleRoot={true} />
    </div>
  );
}

export function TeamHierarchyToggle({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
    >
      <Network className="h-3.5 w-3.5" /> Hierarchy
    </button>
  );
}
