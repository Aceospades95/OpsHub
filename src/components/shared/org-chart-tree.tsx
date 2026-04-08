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
  location?: string;
  avatar?: string | null;
  role?: string;
  children: OrgChartNode[];
}

interface OrgChartTreeProps {
  nodes: OrgChartNode[];
  onNodeClick?: (id: string) => void;
  compact?: boolean;
  showRoleBadge?: boolean;
}

function NodeCard({
  node,
  compact,
  onClick,
  showRoleBadge,
}: {
  node: OrgChartNode;
  compact?: boolean;
  onClick?: () => void;
  showRoleBadge?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`
        rounded-lg bg-card shadow-sm text-left transition-all hover:shadow-md
        ${compact ? "px-3 py-2 min-w-[120px]" : "px-4 py-3 min-w-[160px] max-w-[240px]"}
      `}
      style={{
        border: "1.5px solid color-mix(in srgb, var(--primary) 30%, transparent)",
      }}
    >
      <div className={`flex items-center ${compact ? "gap-2" : "gap-3"}`}>
        <Avatar name={node.name} size={compact ? "xs" : "sm"} />
        <div className="min-w-0">
          <p className={`font-semibold truncate ${compact ? "text-xs" : "text-sm"}`}>{node.name}</p>
          {node.jobTitle && (
            <p className={`text-primary/80 font-medium truncate ${compact ? "text-[10px]" : "text-xs"}`}>{node.jobTitle}</p>
          )}
          {!compact && node.department && (
            <p className="text-[10px] text-muted-foreground truncate">{node.department}</p>
          )}
          {!compact && node.location && (
            <p className="text-[10px] text-muted-foreground truncate">{node.location}</p>
          )}
        </div>
      </div>
      {showRoleBadge && node.role && !compact && (
        <div className="mt-1.5">
          <Badge variant="outline" className="text-[10px]">{node.role}</Badge>
        </div>
      )}
    </button>
  );
}

function VerticalLine({ compact }: { compact?: boolean }) {
  return <div className={`w-px mx-auto ${compact ? "h-5" : "h-7"}`} style={{ backgroundColor: "color-mix(in srgb, var(--primary) 25%, transparent)" }} />;
}

function OrgBranch({
  node,
  compact,
  onNodeClick,
  showRoleBadge,
}: {
  node: OrgChartNode;
  compact?: boolean;
  onNodeClick?: (id: string) => void;
  showRoleBadge?: boolean;
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
          showRoleBadge={showRoleBadge}
          onClick={() => {
            if (hasChildren) setExpanded(!expanded);
            onNodeClick?.(node.id);
          }}
        />
        {hasChildren && (
          <span
            className="absolute -bottom-1 left-1/2 -translate-x-1/2 translate-y-full z-10 bg-card rounded-full p-0.5 cursor-pointer"
            style={{ border: "1px solid color-mix(in srgb, var(--primary) 25%, transparent)" }}
            onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
          >
            {expanded
              ? <ChevronDown className={compact ? "h-3 w-3" : "h-3.5 w-3.5"} />
              : <ChevronRight className={compact ? "h-3 w-3" : "h-3.5 w-3.5"} />
            }
          </span>
        )}
      </div>

      {/* Children */}
      {hasChildren && expanded && (
        <>
          {/* Vertical line from parent down */}
          <VerticalLine compact={compact} />

          {node.children.length === 1 ? (
            /* Single child — just a straight line down */
            <OrgBranch
              node={node.children[0]}
              compact={compact}
              onNodeClick={onNodeClick}
              showRoleBadge={showRoleBadge}
            />
          ) : (
            /* Multiple children — horizontal bar connecting all */
            <div>
              {/* Row of vertical stubs + horizontal connector */}
              <div className={`flex ${compact ? "gap-3" : "gap-6"}`}>
                {node.children.map((child, idx) => (
                  <div key={child.id} className="flex flex-col items-center flex-1">
                    {/* Top half: horizontal line piece + vertical stub */}
                    <div className="self-stretch relative" style={{ height: compact ? "16px" : "24px" }}>
                      {/* Horizontal line — extends left/right to connect siblings */}
                      <div
                        className="absolute top-0"
                        style={{
                          left: idx === 0 ? "50%" : 0,
                          right: idx === node.children.length - 1 ? "50%" : 0,
                          height: "1px",
                          backgroundColor: "color-mix(in srgb, var(--primary) 25%, transparent)",
                        }}
                      />
                      {/* Vertical stub down to child */}
                      <div
                        className="absolute left-1/2 -translate-x-1/2 top-0 w-px"
                        style={{
                          height: "100%",
                          backgroundColor: "color-mix(in srgb, var(--primary) 25%, transparent)",
                        }}
                      />
                    </div>
                    {/* The child branch */}
                    <OrgBranch
                      node={child}
                      compact={compact}
                      onNodeClick={onNodeClick}
                      showRoleBadge={showRoleBadge}
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

export function OrgChartTree({ nodes, onNodeClick, compact, showRoleBadge }: OrgChartTreeProps) {
  if (nodes.length === 0) {
    return <p className="text-sm text-muted-foreground">No team members to display</p>;
  }

  return (
    <div className="overflow-x-auto py-4">
      <div className="inline-flex flex-col items-center min-w-full">
        {nodes.length === 1 ? (
          <OrgBranch
            node={nodes[0]}
            compact={compact}
            onNodeClick={onNodeClick}
            showRoleBadge={showRoleBadge}
          />
        ) : (
          <div className={`flex ${compact ? "gap-4" : "gap-8"}`}>
            {nodes.map((node) => (
              <OrgBranch
                key={node.id}
                node={node}
                compact={compact}
                onNodeClick={onNodeClick}
                showRoleBadge={showRoleBadge}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Build tree from flat user list with managerId — handles cycles safely */
export function buildOrgTree(
  users: {
    id: string;
    name: string;
    jobTitle?: string | null;
    department?: string | null;
    location?: string | null;
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
      location: u.location || undefined,
      avatar: u.avatar,
      role: u.role,
      children: [],
    });
  }

  const roots: OrgChartNode[] = [];

  for (const u of users) {
    const node = map.get(u.id)!;
    if (u.managerId && map.has(u.managerId) && u.managerId !== u.id) {
      // Check for cycle: walk up the chain from the proposed manager
      let current: string | null = u.managerId;
      let isCycle = false;
      const visited = new Set<string>();
      while (current && map.has(current)) {
        if (current === u.id || visited.has(current)) {
          isCycle = true;
          break;
        }
        visited.add(current);
        const mgrUser = users.find((x) => x.id === current);
        current = mgrUser?.managerId ?? null;
      }

      if (!isCycle) {
        map.get(u.managerId)!.children.push(node);
      } else {
        roots.push(node);
      }
    } else {
      roots.push(node);
    }
  }

  return roots;
}
