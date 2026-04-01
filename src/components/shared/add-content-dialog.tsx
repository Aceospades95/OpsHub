"use client";

import { useState, useEffect } from "react";
import { useFormState } from "react-dom";
import { useRouter } from "next/navigation";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { addExternalLink, addEmbed } from "@/actions/attachments";

interface AddContentDialogProps {
  open: boolean;
  onClose: () => void;
  entityType: "project" | "contract" | "supplier" | "intranet" | "tool" | "document";
  entityId: string;
}

type Tab = "link" | "embed";

export function AddContentDialog({ open, onClose, entityType, entityId }: AddContentDialogProps) {
  const [tab, setTab] = useState<Tab>("link");
  const [linkState, linkAction] = useFormState(addExternalLink, null);
  const [embedState, embedAction] = useFormState(addEmbed, null);
  const router = useRouter();

  useEffect(() => {
    if (linkState?.success || embedState?.success) {
      onClose();
      router.refresh();
    }
  }, [linkState, embedState, onClose, router]);

  return (
    <Dialog open={open} onClose={onClose} title="Add Link or Embed">
      <div className="flex gap-2 mb-4">
        <button
          className={`px-3 py-1.5 text-sm rounded font-medium transition-colors ${
            tab === "link" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
          }`}
          onClick={() => setTab("link")}
        >
          External Link
        </button>
        <button
          className={`px-3 py-1.5 text-sm rounded font-medium transition-colors ${
            tab === "embed" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
          }`}
          onClick={() => setTab("embed")}
        >
          Embed
        </button>
      </div>

      {tab === "link" && (
        <form action={linkAction} className="space-y-4">
          <input type="hidden" name="entityType" value={entityType} />
          <input type="hidden" name="entityId" value={entityId} />
          {linkState?.error && (
            <p className="text-sm text-destructive">{linkState.error}</p>
          )}
          <Input name="title" label="Title" required />
          <Input name="url" label="URL" type="url" required />
          <Textarea name="description" label="Description" />
          <Select
            name="source"
            label="Source"
            options={[
              { label: "Manual", value: "manual" },
              { label: "Google Drive", value: "google_drive" },
            ]}
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit">Add Link</Button>
          </div>
        </form>
      )}

      {tab === "embed" && (
        <form action={embedAction} className="space-y-4">
          <input type="hidden" name="entityType" value={entityType} />
          <input type="hidden" name="entityId" value={entityId} />
          {embedState?.error && (
            <p className="text-sm text-destructive">{embedState.error}</p>
          )}
          <Input name="title" label="Title" required />
          <Input name="embedUrl" label="Embed URL" required />
          <Select
            name="embedType"
            label="Embed Type"
            options={[
              { label: "iFrame", value: "iframe" },
              { label: "Google Form", value: "google_form" },
              { label: "JotForm", value: "jotform" },
              { label: "Other", value: "other" },
            ]}
          />
          <Textarea name="description" label="Description" />
          <Input name="width" label="Width" defaultValue="100%" />
          <Input name="height" label="Height" defaultValue="600px" />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit">Add Embed</Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
