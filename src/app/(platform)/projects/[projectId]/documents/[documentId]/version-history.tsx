"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { restoreDocumentVersion } from "@/actions/documents";
import { History, RotateCcw } from "lucide-react";
import { format } from "date-fns";

interface Version {
  id: string;
  version: number;
  content: string;
  changelog: string | null;
  createdAt: Date;
}

interface Props {
  versions: Version[];
  documentId: string;
  canEdit: boolean;
}

export function VersionHistory({ versions, documentId, canEdit }: Props) {
  const [viewVersion, setViewVersion] = useState<Version | null>(null);
  const router = useRouter();

  async function handleRestore(versionId: string) {
    const fd = new FormData();
    fd.set("documentId", documentId);
    fd.set("versionId", versionId);
    await restoreDocumentVersion(null, fd);
    setViewVersion(null);
    router.refresh();
  }

  if (versions.length === 0) {
    return <p className="text-sm text-muted-foreground">No previous versions</p>;
  }

  return (
    <div className="space-y-2">
      {versions.map((v) => (
        <button
          key={v.id}
          onClick={() => setViewVersion(v)}
          className="w-full text-left rounded border border-border p-3 hover:bg-muted transition-colors"
        >
          <div className="flex items-center gap-2 mb-1">
            <History className="h-3 w-3 text-muted-foreground" />
            <span className="text-sm font-medium">Version {v.version}</span>
          </div>
          {v.changelog && (
            <p className="text-xs text-muted-foreground">{v.changelog}</p>
          )}
          <p className="text-xs text-muted-foreground mt-1">
            {format(v.createdAt, "MMM d, yyyy 'at' h:mm a")}
          </p>
        </button>
      ))}

      {viewVersion && (
        <Dialog
          open={!!viewVersion}
          onClose={() => setViewVersion(null)}
          title={`Version ${viewVersion.version}`}
          className="max-w-2xl"
        >
          {viewVersion.changelog && (
            <p className="text-sm text-muted-foreground mb-3">
              {viewVersion.changelog}
            </p>
          )}
          <div className="rounded border border-border bg-muted p-4 max-h-96 overflow-y-auto">
            <pre className="text-sm whitespace-pre-wrap">{viewVersion.content}</pre>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setViewVersion(null)}>
              Close
            </Button>
            {canEdit && (
              <Button onClick={() => handleRestore(viewVersion.id)}>
                <RotateCcw className="h-4 w-4 mr-1" /> Restore This Version
              </Button>
            )}
          </div>
        </Dialog>
      )}
    </div>
  );
}
