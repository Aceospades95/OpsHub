"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal, Copy, FileBox, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  duplicateQuote,
  deleteQuote,
  saveQuoteAsTemplate,
} from "@/actions/quotes";

type QuoteStatus =
  | "DRAFT"
  | "SENT"
  | "VIEWED"
  | "ACCEPTED"
  | "REJECTED"
  | "EXPIRED"
  | "REVISED";

interface Props {
  quoteId: string;
  status: QuoteStatus;
  canEdit: boolean;
  canDelete: boolean;
}

export function QuoteActions({ quoteId, status, canEdit, canDelete }: Props) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [templateDesc, setTemplateDesc] = useState("");
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

  function handleDelete() {
    if (!confirm("Delete this draft quote? This can't be undone.")) return;
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

  function handleSaveAsTemplate() {
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
      setTemplateOpen(false);
      setTemplateName("");
      setTemplateDesc("");
      router.push("/quotes/templates");
    });
  }

  const canDeleteThis = canDelete && status === "DRAFT";

  return (
    <>
      <div className="relative">
        <Button
          variant="outline"
          size="icon"
          onClick={() => setMenuOpen((v) => !v)}
          aria-label="More actions"
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
              {canDeleteThis && (
                <button
                  onClick={handleDelete}
                  disabled={pending}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-muted text-left text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                  Delete draft
                </button>
              )}
            </div>
          </>
        )}
      </div>
      {error && (
        <span className="text-xs text-destructive ml-2 self-center">{error}</span>
      )}

      <Dialog
        open={templateOpen}
        onClose={() => setTemplateOpen(false)}
        title="Save as template"
      >
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
            <Button
              variant="outline"
              onClick={() => setTemplateOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSaveAsTemplate}
              disabled={pending || !templateName.trim()}
            >
              {pending ? "Saving…" : "Save template"}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
