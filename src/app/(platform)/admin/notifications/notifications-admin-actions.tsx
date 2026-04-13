"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Send, CheckCircle2, AlertCircle } from "lucide-react";
import { sendTestNotification } from "@/actions/notifications";

export function NotificationsAdminActions() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [withEmail, setWithEmail] = useState(false);
  const [result, setResult] = useState<{ success: boolean; error?: string } | null>(null);

  const handleSendTest = () => {
    setResult(null);
    startTransition(async () => {
      try {
        await sendTestNotification({ withEmail });
        setResult({ success: true });
        router.refresh();
      } catch (err) {
        setResult({
          success: false,
          error: err instanceof Error ? err.message : "Failed",
        });
      }
      setTimeout(() => setResult(null), 4000);
    });
  };

  return (
    <div className="flex items-center gap-3">
      {result && (
        <div
          className={`flex items-center gap-1.5 text-xs ${
            result.success ? "text-emerald-600" : "text-destructive"
          }`}
        >
          {result.success ? (
            <>
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span>Sent</span>
            </>
          ) : (
            <>
              <AlertCircle className="h-3.5 w-3.5" />
              <span>{result.error || "Failed"}</span>
            </>
          )}
        </div>
      )}

      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={withEmail}
          onChange={(e) => setWithEmail(e.target.checked)}
          className="rounded"
        />
        Also send email
      </label>

      <Button size="sm" onClick={handleSendTest} disabled={isPending}>
        <Send className="h-4 w-4 mr-1.5" />
        {isPending ? "Sending..." : "Send test"}
      </Button>
    </div>
  );
}
