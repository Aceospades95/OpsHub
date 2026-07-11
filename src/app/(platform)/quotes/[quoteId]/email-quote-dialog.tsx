"use client";

import { useEffect, useState, useTransition } from "react";
import { Mail } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { sendQuoteEmail } from "@/actions/quotes";

/**
 * "Email quote" dialog — shared by the editor toolbar and the quote
 * detail actions. Sends the recipient a branded email with a tokenized
 * public PDF link (no sign-in needed on their side) and moves a
 * DRAFT/REVISED quote to SENT, which locks editing (revise to change).
 */
export function EmailQuoteDialog({
  quoteId,
  open,
  defaultTo,
  quoteStatus,
  onClose,
  onSent,
}: {
  quoteId: string;
  open: boolean;
  /** Prefill — usually the client's primary contact email. */
  defaultTo: string | null;
  /** Current status; drives the "this will lock editing" note. */
  quoteStatus: string;
  onClose: () => void;
  onSent?: () => void;
}) {
  const [to, setTo] = useState(defaultTo ?? "");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Re-seed the recipient when the dialog opens (the prefill can load
  // after first render).
  useEffect(() => {
    if (open) {
      setTo((current) => current || (defaultTo ?? ""));
      setError(null);
    }
  }, [open, defaultTo]);

  function handleSend() {
    setError(null);
    startTransition(async () => {
      const res = await sendQuoteEmail({ id: quoteId, to, message: message || null });
      if (res && "error" in res && res.error) {
        setError(res.error);
        return;
      }
      onClose();
      setMessage("");
      onSent?.();
    });
  }

  const willLock = quoteStatus === "DRAFT" || quoteStatus === "REVISED";

  return (
    <Dialog open={open} onClose={onClose} title="Email quote">
      <div className="space-y-4">
        <Input
          label="To"
          type="email"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="client@example.com"
        />
        <Textarea
          label="Message (optional)"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="A short personal note shown at the top of the email."
          rows={4}
        />
        <p className="text-xs text-muted-foreground">
          The email includes a secure download link to the PDF — the
          recipient doesn&apos;t need an OpsHub account.
          {willLock && (
            <>
              {" "}
              Sending marks the quote as <strong>Sent</strong> and locks
              editing; create a revision if it needs changes later.
            </>
          )}
        </p>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={handleSend} disabled={pending || !to.trim()}>
            <Mail className="h-4 w-4 mr-2" />
            {pending ? "Sending…" : "Send quote"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
