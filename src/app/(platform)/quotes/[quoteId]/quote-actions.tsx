"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  MoreHorizontal,
  Copy,
  FileBox,
  Trash2,
  Download,
  FolderPlus,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  duplicateQuote,
  deleteQuote,
  saveQuoteAsTemplate,
  convertQuoteToProject,
} from "@/actions/quotes";

interface Props {
  quoteId: string;
  canEdit: boolean;
  canDelete: boolean;
  /** Already linked to a project? Hides the convert option. */
  hasProject: boolean;
}

export function QuoteActions({
  quoteId,
  canEdit,
  canDelete,
  hasProject,
}: Props) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleDuplicate() {
    setMenuOpen(false);
    setError(null);
    startTransition(async () => {
      const res = await duplicateQuote(quoteId);
      if ("error" in res) {
        setError(res.error ?? "Unknown error");
        return;
      }
      router.push(`/quotes/${res.id}/edit`);
    });
  }

  function handleConvert() {
    setMenuOpen(false);
    setError(null);
    startTransition(async () => {
      const res = await convertQuoteToProject(quoteId);
      if ("error" in res) {
        setError(res.error ?? "Unknown error");
        return;
      }
      router.push(`/projects/${res.projectId}`);
    });
  }

  function handleDelete() {
    if (!confirm("Delete this quote? This can't be undone.")) return;
    setMenuOpen(false);
    setError(null);
    startTransition(async () => {
      const res = await deleteQuote(quoteId);
      if ("error" in res) {
        setError(res.error ?? "Unknown error");
        return;
      }
      router.push("/quotes");
    });
  }

  return (
    <>
      <div className="flex items-center gap-2">
        <a
          href={`/api/quotes/${quoteId}/pdf`}
          target="_blank"
          rel="noopener"
          className="inline-flex items-center justify-center rounded font-medium transition-colors text-foreground border border-border bg-background hover:bg-muted h-10 px-4 py-2 text-sm"
        >
          <Download className="h-4 w-4 mr-2" />
          PDF
        </a>

        <div className="relative">
          <Button
            variant="outline"
            size="icon"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="More actions"
            disabled={pending}
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
          {menuOpen && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setMenuOpen(false)}
              />
              <div className="absolute right-0 mt-2 w-56 rounded border border-border bg-card shadow-lg z-50 py-1">
                <a
                  href={`/api/quotes/${quoteId}/docx`}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-muted text-left"
                  onClick={() => setMenuOpen(false)}
                >
                  <Download className="h-4 w-4" />
                  Download Word (.docx)
                </a>
                <button
                  onClick={handleDuplicate}
                  disabled={pending}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-muted text-left"
                >
                  <Copy className="h-4 w-4" />
                  Duplicate
                </button>
                {canEdit && (
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      setTemplateOpen(true);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-muted text-left"
                  >
                    <FileBox className="h-4 w-4" />
                    Save as template
                  </button>
                )}
                {canEdit && !hasProject && (
                  <button
                    onClick={handleConvert}
                    disabled={pending}
                    className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-muted text-left"
                  >
                    <FolderPlus className="h-4 w-4" />
                    Convert to project
                  </button>
                )}
                {canDelete && (
                  <button
                    onClick={handleDelete}
                    disabled={pending}
                    className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-muted text-left text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {error && (
        <p className="text-xs text-destructive mt-2">{error}</p>
      )}

      <SaveAsTemplateDialog
        open={templateOpen}
        quoteId={quoteId}
        onClose={() => setTemplateOpen(false)}
      />
    </>
  );
}

function SaveAsTemplateDialog({
  open,
  quoteId,
  onClose,
}: {
  open: boolean;
  quoteId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [templateName, setTemplateName] = useState("");
  const [templateDesc, setTemplateDesc] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSave() {
    setError(null);
    startTransition(async () => {
      const res = await saveQuoteAsTemplate({
        id: quoteId,
        name: templateName,
        description: templateDesc || null,
      });
      if ("error" in res) {
        setError(res.error ?? "Unknown error");
        return;
      }
      onClose();
      setTemplateName("");
      setTemplateDesc("");
      router.push("/quotes/templates");
    });
  }

  return (
    <Dialog open={open} onClose={onClose} title="Save as template">
      <div className="space-y-4">
        <Input
          label="Template name"
          value={templateName}
          onChange={(e) => setTemplateName(e.target.value)}
          placeholder="e.g. Standard Implementation Quote"
        />
        <Textarea
          label="Description (optional)"
          value={templateDesc}
          onChange={(e) => setTemplateDesc(e.target.value)}
          rows={3}
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={pending || !templateName.trim()}
          >
            {pending ? "Saving…" : "Save template"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
