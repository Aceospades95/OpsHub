"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ContactInput } from "@/actions/contacts";

export interface ContactFormValues extends ContactInput {
  isFormer?: boolean;
}

/**
 * Shared create/edit dialog for a Contact. Controlled fields (the
 * actions take plain objects, not FormData); the caller owns the
 * submit — create navigates to the new record, edit refreshes.
 */
export function ContactFormDialog({
  title,
  submitLabel,
  initial,
  showIsFormer = false,
  onClose,
  onSubmit,
}: {
  title: string;
  submitLabel: string;
  initial?: Partial<ContactFormValues>;
  /** Former flag only makes sense once the contact exists (edit). */
  showIsFormer?: boolean;
  onClose: () => void;
  onSubmit: (values: ContactFormValues) => Promise<{
    error?: string;
    fieldErrors?: Record<string, string[]>;
  } | void>;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [jobTitle, setJobTitle] = useState(initial?.title ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [organization, setOrganization] = useState(initial?.organization ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [isFormer, setIsFormer] = useState(initial?.isFormer ?? false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [isPending, startTransition] = useTransition();

  function handleSubmit() {
    startTransition(async () => {
      const result = await onSubmit({
        name,
        title: jobTitle,
        email,
        phone,
        organization,
        notes,
        isFormer,
      });
      if (result?.error) {
        setFieldErrors(result.fieldErrors ?? {});
        if (!result.fieldErrors) toast.error(result.error);
      }
      // On success the caller closes / navigates.
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isPending || !name.trim()}>
            {isPending ? "Saving…" : submitLabel}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Input
          label="Name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={fieldErrors.name?.[0]}
          autoFocus
        />
        <Input
          label="Job Title"
          value={jobTitle}
          onChange={(e) => setJobTitle(e.target.value)}
          error={fieldErrors.title?.[0]}
        />
        <Input
          label="Organization"
          placeholder="Free-form — for people whose org OpsHub doesn't track"
          value={organization}
          onChange={(e) => setOrganization(e.target.value)}
          error={fieldErrors.organization?.[0]}
        />
        <Input
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={fieldErrors.email?.[0]}
        />
        <Input
          label="Phone"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          error={fieldErrors.phone?.[0]}
        />
        <Textarea
          label="Notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          error={fieldErrors.notes?.[0]}
        />
        {showIsFormer && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isFormer}
              onChange={(e) => setIsFormer(e.target.checked)}
              className="rounded"
            />
            Departed — keeps history; drops them from pickers and copy lists
          </label>
        )}
      </div>
    </Dialog>
  );
}
