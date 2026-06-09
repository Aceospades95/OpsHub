"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Send, CheckCircle2, AlertCircle } from "lucide-react";
import { sendTestEmail } from "@/actions/emails";

export function EmailLogActions() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<{ success: boolean; error?: string } | null>(null);

  const handleSendTest = () => {
    setResult(null);
    startTransition(async () => {
      const r = await sendTestEmail();
      // Normalize the gate error shape into the same {success, error}
      // shape the email driver returns, so the UI doesn't have to fork.
      if ("error" in r && !("success" in r)) {
        setResult({ success: false, error: r.error });
      } else {
        setResult(r as { success: boolean; error?: string });
      }
      router.refresh();
      // Clear the toast after a few seconds
      setTimeout(() => setResult(null), 4000);
    });
  };

  return (
    <div className="flex items-center gap-3">
      {result && (
        <div
          className={`flex items-center gap-1.5 text-xs ${
            result.success ? "text-success" : "text-destructive"
          }`}
        >
          {result.success ? (
            <>
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span>Test sent</span>
            </>
          ) : (
            <>
              <AlertCircle className="h-3.5 w-3.5" />
              <span>{result.error || "Failed"}</span>
            </>
          )}
        </div>
      )}
      <Button size="sm" onClick={handleSendTest} disabled={isPending}>
        <Send className="h-4 w-4 mr-1.5" />
        {isPending ? "Sending..." : "Send test email"}
      </Button>
    </div>
  );
}
