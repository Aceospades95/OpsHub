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

  // Top-level: uses --primary, nested: uses --accent
  const levelColor = level === 0 ? "var(--primary)" : "var(--accent)";

  return (
    <div>
      {/* The row — clicking it toggles collapse, but the link inside still works */}
      <div
        onClick={(e) => {
          // Only toggle if the click isn't on the link or a button
          const target = e.target as HTMLElement;
          if (target.closest("a") || target.closest("button")) return;
          if (hasChildren) setExpanded(!expanded);
        }}
        className={`flex items-center gap-2 rounded-lg px-3 py-2.5 transition-colors ${
          hasChildren ? "cursor-pointer" : ""
        }`}
        style={{
          backgroundColor: level === 0
            ? "color-mix(in srgb, var(--primary) 8%, var(--card))"
            : "color-mix(in srgb, var(--accent) 5%, var(--card))",
          border: `1px solid color-mix(in srgb, ${levelColor} 20%, transparent)`,
          marginBottom: level === 0 ? "6px" : "3px",
          marginLeft: level > 0 ? "2px" : undefined,
        }}
      >
        {/* Expand/collapse icon */}
        {hasChildren ? (
          <button
            onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
            className="rounded p-0.5 shrink-0"
            style={{ color: levelColor }}
          >
            {expanded ? (
              <ChevronDown className="h-5 w-5" />
            ) : (
              <ChevronRight className="h-5 w-5" />
            )}
          </button>
        ) : (
          <span className="w-6 shrink-0 flex justify-center">
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: `color-mix(in srgb, ${levelColor} 40%, transparent)` }}
            />
          </span>
        )}

        {/* Label — remains a link */}
        <Link
          href={node.href}
          onClick={(e) => e.stopPropagation()}
          className="flex-1 text-sm font-medium hover:underline truncate min-w-0"
          style={{ color: level === 0 ? undefined : undefined }}
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

        {/* Child count indicator */}
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

      {/* Children — with colored connector line */}
      {expanded && hasChildren && (
        <div
          className="ml-5 pl-4 pb-1"
          style={{
            borderLeft: `2px solid color-mix(in srgb, var(--accent) 30%, transparent)`,
          }}
        >
          {node.children!.map((child) => (
            <TreeItem
              key={child.id}
              node={child}
              level={level + 1}
            />
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
