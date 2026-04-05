"use client";

import { useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronRight } from "lucide-react";

export interface OrgChartNode {
  id: string;
  name: string;
  jobTitle?: string;
  department?: string;
  avatar?: string | null;
  role?: string;
  children: OrgChartNode[];
}

interface OrgChartTreeProps {
  nodes: OrgChartNode[];
  onNodeClick?: (id: string) => void;
  highlightId?: string;
  compact?: boolean;
}

function NodeCard({
  node,
  compact,
  highlighted,
  onClick,
}: {
  node: OrgChartNode;
  compact?: boolean;
  highlighted?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`
        rounded-lg border bg-card shadow-sm text-left transition-all hover:shadow-md
        ${highlighted ? "border-primary ring-2 ring-primary/20" : "border-border"}
        ${compact ? "px-3 py-2 min-w-[120px]" : "px-4 py-3 min-w-[160px]"}
      `}
    >
      <div className={`flex items-center ${compact ? "gap-2" : "gap-3"}`}>
        <Avatar name={node.name} size={compact ? "xs" : "sm"} />
        <div className="min-w-0">
          <p className={`font-semibold truncate ${compact ? "text-xs" : "text-sm"}`}>{node.name}</p>
          {node.jobTitle && (
            <p className={`text-muted-foreground truncate ${compact ? "text-[10px]" : "text-xs"}`}>{node.jobTitle}</p>
          )}
          {!compact && node.department && (
            <p className="text-[10px] text-muted-foreground truncate">{node.department}</p>
          )}
        </div>
      </div>
      {node.role && !compact && (
        <div className="mt-1.5">
          <Badge variant="outline" className="text-[10px]">{node.role}</Badge>
        </div>
      )}
    </button>
  );
}

function OrgBranch({
  node,
  compact,
  highlightId,
  onNodeClick,
  isRoot,
}: {
  node: OrgChartNode;
  compact?: boolean;
  highlightId?: string;
  onNodeClick?: (id: string) => void;
  isRoot?: boolean;
}) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = node.children.length > 0;

  return (
    <div className="flex flex-col items-center">
      {/* Node card */}
      <div className="relative">
        <NodeCard
          node={node}
          compact={compact}
          highlighted={highlightId === node.id}
          onClick={() => {
            if (hasChildren) setExpanded(!expanded);
            onNodeClick?.(node.id);
          }}
        />
        {hasChildren && (
          <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 translate-y-full z-10 bg-card border border-border rounded-full p-0.5 cursor-pointer"
            onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}>
            {expanded
              ? <ChevronDown className={compact ? "h-3 w-3" : "h-3.5 w-3.5"} />
              : <ChevronRight className={compact ? "h-3 w-3" : "h-3.5 w-3.5"} />
            }
          </span>
        )}
      </div>

      {/* Connector + children */}
      {hasChildren && expanded && (
        <>
          {/* Vertical line down from parent */}
          <div className={`w-px bg-border ${compact ? "h-6" : "h-8"}`} />

          {/* Horizontal connector + children */}
          {node.children.length === 1 ? (
            <OrgBranch
              node={node.children[0]}
              compact={compact}
              highlightId={highlightId}
              onNodeClick={onNodeClick}
            />
          ) : (
            <div className="relative flex items-start">
              {/* Horizontal bar across all children */}
              <div
                className="absolute bg-border h-px"
                style={{
                  top: 0,
                  left: "calc(50% / var(--child-count))",
                  right: "calc(50% / var(--child-count))",
                  // @ts-expect-error CSS custom property
                  "--child-count": node.children.length,
                }}
              />
              {/* Use a simpler approach: first child center to last child center */}
              <div className="absolute top-0 left-0 right-0 flex">
                <div className="flex-1" />
                <div className="flex-1" />
              </div>

              <div className="flex gap-4 relative">
                {/* Actual horizontal connector */}
                <div className="absolute top-0 h-px bg-border"
                  style={{
                    left: `calc(${100 / (2 * node.children.length)}%)`,
                    right: `calc(${100 / (2 * node.children.length)}%)`,
                  }}
                />
                {node.children.map((child) => (
                  <div key={child.id} className="flex flex-col items-center">
                    {/* Vertical stub from horizontal bar to child */}
                    <div className={`w-px bg-border ${compact ? "h-4" : "h-6"}`} />
                    <OrgBranch
                      node={child}
                      compact={compact}
                      highlightId={highlightId}
                      onNodeClick={onNodeClick}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function OrgChartTree({ nodes, onNodeClick, highlightId, compact }: OrgChartTreeProps) {
  if (nodes.length === 0) {
    return <p className="text-sm text-muted-foreground">No team members</p>;
  }

  return (
    <div className="overflow-x-auto py-4">
      <div className="inline-flex flex-col items-center min-w-full">
        {nodes.length === 1 ? (
          <OrgBranch
            node={nodes[0]}
            compact={compact}
            highlightId={highlightId}
            onNodeClick={onNodeClick}
            isRoot
          />
        ) : (
          <div className="flex gap-8">
            {nodes.map((node) => (
              <OrgBranch
                key={node.id}
                node={node}
                compact={compact}
                highlightId={highlightId}
                onNodeClick={onNodeClick}
                isRoot
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Build tree from flat user list with managerId */
export function buildOrgTree(
  users: {
    id: string;
    name: string;
    jobTitle?: string | null;
    department?: string | null;
    avatar?: string | null;
    role?: string;
    managerId?: string | null;
  }[]
): OrgChartNode[] {
  const map = new Map<string, OrgChartNode>();
  for (const u of users) {
    map.set(u.id, {
      id: u.id,
      name: u.name,
      jobTitle: u.jobTitle || undefined,
      department: u.department || undefined,
      avatar: u.avatar,
      role: u.role,
      children: [],
    });
  }

  const roots: OrgChartNode[] = [];
  for (const u of users) {
    const node = map.get(u.id)!;
    if (u.managerId && map.has(u.managerId)) {
      map.get(u.managerId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}
