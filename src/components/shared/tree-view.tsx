"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { StatusBadge } from "./status-badge";
import Link from "next/link";

export interface TreeNode {
  id: string;
  label: string;
  href: string;
  status?: string;
  meta?: string;
  children?: TreeNode[];
}

interface TreeViewProps {
  nodes: TreeNode[];
}

function TreeItem({ node, level = 0 }: { node: TreeNode; level: number }) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = node.children && node.children.length > 0;

  const levelColor = level === 0 ? "var(--primary)" : "var(--accent)";

  function handleRowClick(e: React.MouseEvent) {
    // Don't collapse if clicking the link
    if ((e.target as HTMLElement).closest("a")) return;
    if (hasChildren) setExpanded(!expanded);
  }

  return (
    <div>
      <div
        role={hasChildren ? "button" : undefined}
        onClick={handleRowClick}
        className={`flex items-center gap-2 rounded-lg px-3 py-2.5 bg-card transition-colors ${
          hasChildren ? "cursor-pointer hover:bg-muted/50" : ""
        }`}
        style={{
          border: `1.5px solid color-mix(in srgb, ${levelColor} 35%, transparent)`,
          marginBottom: level === 0 ? "6px" : "3px",
          marginLeft: level > 0 ? "2px" : undefined,
        }}
      >
        {/* Expand/collapse icon */}
        {hasChildren ? (
          <span className="shrink-0" style={{ color: levelColor }}>
            {expanded ? (
              <ChevronDown className="h-5 w-5" />
            ) : (
              <ChevronRight className="h-5 w-5" />
            )}
          </span>
        ) : (
          <span className="w-6 shrink-0 flex justify-center">
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: `color-mix(in srgb, ${levelColor} 40%, transparent)` }}
            />
          </span>
        )}

        {/* Label — this is the only clickable link */}
        <Link
          href={node.href}
          className="flex-1 text-sm font-medium hover:underline hover:text-primary truncate min-w-0"
        >
          {node.label}
        </Link>

        {/* Status badge */}
        {node.status && (
          <span className="w-24 flex justify-center shrink-0">
            <StatusBadge status={node.status} />
          </span>
        )}

        {/* Meta info */}
        {node.meta && (
          <span className="w-32 text-right text-xs text-muted-foreground shrink-0 truncate">
            {node.meta}
          </span>
        )}

        {/* Child count */}
        {hasChildren && (
          <span
            className="text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0"
            style={{
              backgroundColor: `color-mix(in srgb, ${levelColor} 12%, transparent)`,
              color: levelColor,
            }}
          >
            {node.children!.length}
          </span>
        )}
      </div>

      {/* Children with colored connector line */}
      {expanded && hasChildren && (
        <div
          className="ml-5 pl-4 pb-1"
          style={{
            borderLeft: `2px solid color-mix(in srgb, ${levelColor} 35%, transparent)`,
          }}
        >
          {node.children!.map((child) => (
            <TreeItem key={child.id} node={child} level={level + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export function TreeView({ nodes }: TreeViewProps) {
  if (nodes.length === 0) {
    return <p className="text-sm text-muted-foreground">No items</p>;
  }

  return (
    <div>
      {nodes.map((node) => (
        <TreeItem key={node.id} node={node} level={0} />
      ))}
    </div>
  );
}
