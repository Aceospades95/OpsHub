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
  level?: number;
}

function TreeItem({ node, level = 0 }: { node: TreeNode; level: number }) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = node.children && node.children.length > 0;

  return (
    <div>
      <div
        className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-muted transition-colors"
        style={{ paddingLeft: `${level * 20 + 8}px` }}
      >
        {hasChildren ? (
          <button
            onClick={() => setExpanded(!expanded)}
            className="rounded p-0.5 hover:bg-border"
          >
            {expanded ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
          </button>
        ) : (
          <span className="w-5" />
        )}
        <Link
          href={node.href}
          className="flex-1 text-sm font-medium hover:text-primary"
        >
          {node.label}
        </Link>
        {node.status && <StatusBadge status={node.status} />}
        {node.meta && (
          <span className="text-xs text-muted-foreground">{node.meta}</span>
        )}
      </div>
      {expanded && hasChildren && (
        <div>
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
    <div className="space-y-0.5">
      {nodes.map((node) => (
        <TreeItem key={node.id} node={node} level={0} />
      ))}
    </div>
  );
}
