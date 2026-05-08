"use client";

import { useRouter } from "next/navigation";
import { ExternalLink, Trash2, Link2, Code2 } from "lucide-react";
import { deleteExternalLink, deleteEmbed } from "@/actions/attachments";

interface LinkItem {
  id: string;
  title: string;
  url: string;
  description?: string | null;
  source: string;
}

interface EmbedItem {
  id: string;
  title: string;
  embedUrl: string;
  embedType: string;
  description?: string | null;
  width?: string | null;
  height?: string | null;
}

interface FileListProps {
  links?: LinkItem[];
  embeds?: EmbedItem[];
  canDelete: boolean;
  /**
   * Round-8 QA: the same component is reused for "Attachments",
   * "Links", and "Embeds" cards but the empty-state always read
   * "No attachments". Callers now pass the specific label so the
   * Tool detail "Embeds" card reads "No embeds yet" instead.
   */
  emptyLabel?: string;
}

export function FileList({ links = [], embeds = [], canDelete, emptyLabel = "No attachments" }: FileListProps) {
  const router = useRouter();

  async function handleDeleteLink(id: string) {
    const fd = new FormData();
    fd.set("id", id);
    await deleteExternalLink(null, fd);
    router.refresh();
  }

  async function handleDeleteEmbed(id: string) {
    const fd = new FormData();
    fd.set("id", id);
    await deleteEmbed(null, fd);
    router.refresh();
  }

  const hasContent = links.length > 0 || embeds.length > 0;

  if (!hasContent) {
    return <p className="text-sm text-muted-foreground">{emptyLabel}</p>;
  }

  return (
    <div className="space-y-3">
      {links.map((link) => (
        <div key={link.id} className="flex items-center gap-3 rounded border border-border bg-muted p-3">
          <Link2 className="h-4 w-4 text-muted-foreground" />
          <div className="flex-1 min-w-0">
            <a href={link.url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium hover:text-primary flex items-center gap-1">
              {link.title}
              <ExternalLink className="h-3 w-3" />
            </a>
            {link.description && (
              <p className="text-xs text-muted-foreground">{link.description}</p>
            )}
          </div>
          {canDelete && (
            <button
              onClick={() => handleDeleteLink(link.id)}
              aria-label={`Delete link "${link.title}"`}
              title="Delete link"
              className="rounded p-1 text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          )}
        </div>
      ))}

      {embeds.map((embed) => (
        <div key={embed.id} className="space-y-2">
          <div className="flex items-center gap-3 rounded border border-border bg-muted p-3">
            <Code2 className="h-4 w-4 text-muted-foreground" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">{embed.title}</p>
              {embed.description && (
                <p className="text-xs text-muted-foreground">{embed.description}</p>
              )}
            </div>
            {canDelete && (
              <button
                onClick={() => handleDeleteEmbed(embed.id)}
                aria-label={`Delete embed "${embed.title}"`}
                title="Delete embed"
                className="rounded p-1 text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            )}
          </div>
          <iframe
            src={embed.embedUrl}
            title={embed.title}
            width={embed.width || "100%"}
            height={embed.height || "600px"}
            className="rounded border border-border"
            sandbox="allow-scripts allow-same-origin allow-forms"
          />
        </div>
      ))}
    </div>
  );
}
