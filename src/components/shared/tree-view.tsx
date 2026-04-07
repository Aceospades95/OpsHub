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

  function toggle() {
    if (hasChildren) setExpanded(!expanded);
  }

  return (
    <div>
      <div
        className={`flex items-center gap-2 rounded-lg px-3 py-2.5 transition-colors ${
          hasChildren ? "cursor-pointer hover:bg-muted/50" : ""
        }`}
        style={{
          backgroundColor: `color-mix(in srgb, var(--card) ${Math.max(70, 97 - level * 3)}%, var(--foreground) ${3 + level * 3}%)`,
          border: `1.5px solid color-mix(in srgb, ${levelColor} 35%, transparent)`,
          marginBottom: level === 0 ? "6px" : "3px",
          marginLeft: level > 0 ? "2px" : undefined,
        }}
      >
        {/* Collapse toggle area — everything except the link is a toggle */}
        <div
          className={`flex items-center gap-2 flex-1 min-w-0 ${hasChildren ? "cursor-pointer" : ""}`}
          onClick={toggle}
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

          {/* Label — link that navigates */}
          <Link
            href={node.href}
            onClick={(e) => e.stopPropagation()}
            className="text-sm font-medium hover:underline hover:text-primary truncate"
          >
            {node.label}
          </Link>

          {/* Child count badge — next to the name */}
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

        {/* Right side — fixed-width columns, always rendered */}
        <div className="flex items-center gap-2 shrink-0" onClick={toggle}>
          <span className="w-24 flex justify-center">
            {node.status ? <StatusBadge status={node.status} /> : null}
          </span>

          <span className="w-32 text-right text-xs text-muted-foreground truncate">
            {node.meta || ""}
          </span>
        </div>
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
