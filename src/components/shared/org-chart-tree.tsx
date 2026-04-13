"use client";

import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";

export interface OrgChartNode {
  id: string;
  name: string;
  jobTitle?: string;
  department?: string;
  location?: string;
  avatar?: string | null;
  role?: string;
  href?: string;
  children: OrgChartNode[];
}

interface OrgChartTreeProps {
  nodes: OrgChartNode[];
  compact?: boolean;
  showRoleBadge?: boolean;
}

const lineColor = "color-mix(in srgb, var(--primary) 30%, transparent)";

function NodeCard({
  node,
  compact,
  showRoleBadge,
}: {
  node: OrgChartNode;
  compact?: boolean;
  showRoleBadge?: boolean;
}) {
  const content = (
    <div
      className={`
        rounded-lg text-left transition-all hover:shadow-lg
        border border-border/60 shadow-md
        bg-white dark:bg-slate-800
        ${compact ? "px-3 py-2 min-w-[120px]" : "px-4 py-3 min-w-[180px] max-w-[240px]"}
      `}
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
    </div>
  );

  if (node.href) {
    return <Link href={node.href} className="block">{content}</Link>;
  }
  return content;
}

function OrgBranch({
  node,
  compact,
  showRoleBadge,
}: {
  node: OrgChartNode;
  compact?: boolean;
  showRoleBadge?: boolean;
}) {
  const hasChildren = node.children.length > 0;
  const vLineH = compact ? 20 : 28;
  const halfGap = compact ? 6 : 12;

  return (
    <div className="flex flex-col items-center">
      <NodeCard node={node} compact={compact} showRoleBadge={showRoleBadge} />

      {hasChildren && (
        <>
          {/* Vertical line from parent down to connector */}
          <div style={{ width: 1, height: vLineH, backgroundColor: lineColor }} />

          {node.children.length === 1 ? (
            <OrgBranch node={node.children[0]} compact={compact} showRoleBadge={showRoleBadge} />
          ) : (
            /* Multiple children: horizontal bar + vertical stubs */
            <div className={`flex items-start ${compact ? "gap-3" : "gap-6"}`}>
              {node.children.map((child, idx) => {
                const isFirst = idx === 0;
                const isLast = idx === node.children.length - 1;
                return (
                  <div key={child.id} className="flex flex-col items-center">
                    {/* Horizontal + vertical connector */}
                    <div className="self-stretch relative" style={{ height: vLineH }}>
                      <div
                        className="absolute top-0"
                        style={{
                          height: 1,
                          backgroundColor: lineColor,
                          left: isFirst ? "50%" : -halfGap,
                          right: isLast ? "50%" : -halfGap,
                        }}
                      />
                      <div
                        className="absolute top-0 left-1/2"
                        style={{
                          width: 1,
                          height: "100%",
                          backgroundColor: lineColor,
                          transform: "translateX(-0.5px)",
                        }}
                      />
                    </div>
                    <OrgBranch node={child} compact={compact} showRoleBadge={showRoleBadge} />
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function OrgChartTree({ nodes, compact, showRoleBadge }: OrgChartTreeProps) {
  if (nodes.length === 0) {
    return <p className="text-sm text-muted-foreground">No team members to display</p>;
  }

  return (
    <div className="overflow-x-auto py-4 text-center">
      <div className="inline-block text-left">
        {nodes.length === 1 ? (
          <OrgBranch node={nodes[0]} compact={compact} showRoleBadge={showRoleBadge} />
        ) : (
          <div className={`flex items-start ${compact ? "gap-4" : "gap-8"}`}>
            {nodes.map((node) => (
              <OrgBranch key={node.id} node={node} compact={compact} showRoleBadge={showRoleBadge} />
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
    href?: string;
  }[]
): OrgChartNode[] {
  const map = new Map<string, OrgChartNode>();
  const userById = new Map(users.map((u) => [u.id, u]));

  for (const u of users) {
    map.set(u.id, {
      id: u.id,
      name: u.name,
      jobTitle: u.jobTitle || undefined,
      department: u.department || undefined,
      location: u.location || undefined,
      avatar: u.avatar,
      role: u.role,
      href: u.href,
      children: [],
    });
  }

  const roots: OrgChartNode[] = [];

  for (const u of users) {
    const node = map.get(u.id)!;
    if (u.managerId && map.has(u.managerId) && u.managerId !== u.id) {
      let current: string | null = u.managerId;
      let isCycle = false;
      const visited = new Set<string>();
      while (current && map.has(current)) {
        if (current === u.id || visited.has(current)) {
          isCycle = true;
          break;
        }
        visited.add(current);
        const mgrUser = userById.get(current);
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
