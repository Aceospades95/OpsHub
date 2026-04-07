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

const LEVEL_COLORS = [
  "border-primary/40",
  "border-accent/40",
  "border-warning/40",
  "border-purple-400/40",
  "border-blue-400/40",
];

const LEVEL_BG = [
  "",
  "bg-primary/[0.03]",
  "bg-accent/[0.03]",
  "bg-warning/[0.03]",
  "bg-purple-400/[0.03]",
];

function TreeItem({ node, level = 0, isLast = false }: { node: TreeNode; level: number; isLast: boolean }) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = node.children && node.children.length > 0;
  const borderColor = LEVEL_COLORS[level % LEVEL_COLORS.length];
  const bgColor = LEVEL_BG[level % LEVEL_BG.length];

  return (
    <div className={level > 0 ? `ml-4 border-l-2 ${borderColor}` : ""}>
      <div
        className={`flex items-center gap-2 rounded-md px-3 py-2 hover:bg-muted/60 transition-colors ${bgColor} ${
          level === 0 ? "border border-border/60 rounded-lg mb-1 shadow-sm" : "ml-2"
        }`}
      >
        {hasChildren ? (
          <button
            onClick={() => setExpanded(!expanded)}
            className="rounded p-0.5 hover:bg-border shrink-0"
          >
            {expanded ? (
              <ChevronDown className="h-5 w-5 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-5 w-5 text-muted-foreground" />
            )}
          </button>
        ) : (
          <span className="w-6 shrink-0 flex justify-center">
            <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/30" />
          </span>
        )}
        <Link
          href={node.href}
          className="flex-1 text-sm font-medium hover:text-primary truncate min-w-0"
        >
          {node.label}
        </Link>
        {node.status && (
          <span className="w-24 flex justify-center shrink-0">
            <StatusBadge status={node.status} />
          </span>
        )}
        {node.meta && (
          <span className="w-32 text-right text-xs text-muted-foreground shrink-0 truncate">
            {node.meta}
          </span>
        )}
      </div>
      {expanded && hasChildren && (
        <div className={`${level === 0 ? "mb-2" : ""}`}>
          {node.children!.map((child, i) => (
            <TreeItem
              key={child.id}
              node={child}
              level={level + 1}
              isLast={i === node.children!.length - 1}
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
    <div className="space-y-1">
      {nodes.map((node, i) => (
        <TreeItem key={node.id} node={node} level={0} isLast={i === nodes.length - 1} />
      ))}
    </div>
  );
}
