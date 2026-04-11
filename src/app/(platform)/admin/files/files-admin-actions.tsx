"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useFormState } from "react-dom";
import { Button } from "@/components/ui/button";
import { Upload, CheckCircle2, AlertCircle } from "lucide-react";
import { uploadFileFromForm } from "@/actions/files";

export function FilesAdminActions() {
  const router = useRouter();
  const [state, action] = useFormState(uploadFileFromForm, null);
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const [localResult, setLocalResult] = useState<{ success: boolean; error?: string } | null>(null);

  // After a successful submit, refresh the list and clear the form
  if (state && state !== localResult) {
    setLocalResult(state);
    if (state.success) {
      formRef.current?.reset();
      startTransition(() => router.refresh());
    }
    setTimeout(() => setLocalResult(null), 4000);
  }

  return (
    <form ref={formRef} action={action} className="flex items-center gap-3">
      {localResult && (
        <div
          className={`flex items-center gap-1.5 text-xs ${
            localResult.success ? "text-emerald-600" : "text-destructive"
          }`}
        >
          {localResult.success ? (
            <>
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span>Uploaded</span>
            </>
          ) : (
            <>
              <AlertCircle className="h-3.5 w-3.5" />
              <span>{localResult.error || "Failed"}</span>
            </>
          )}
        </div>
      )}

      <label className="flex items-center gap-1 text-xs text-muted-foreground">
        <input type="radio" name="visibility" value="private" defaultChecked />
        Private
      </label>
      <label className="flex items-center gap-1 text-xs text-muted-foreground">
        <input type="radio" name="visibility" value="public" />
        Public
      </label>

      <input
        type="file"
        name="file"
        required
        className="text-xs file:mr-2 file:rounded file:border file:border-border file:bg-muted file:px-2 file:py-1 file:text-xs"
      />

      <Button size="sm" type="submit" disabled={isPending}>
        <Upload className="h-4 w-4 mr-1.5" />
        Upload test file
      </Button>
    </form>
  );
}
