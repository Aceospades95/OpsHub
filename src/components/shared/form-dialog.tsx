"use client";

import { useFormState } from "react-dom";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface FormDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  action: (prev: unknown, formData: FormData) => Promise<{ success?: boolean; error?: string; fieldErrors?: Record<string, string[]> }>;
  children: (state: { fieldErrors?: Record<string, string[]> }) => React.ReactNode;
  submitLabel?: string;
  navigateTo?: string;
}

export function FormDialog({
  open,
  onClose,
  title,
  action,
  children,
  submitLabel = "Save",
  navigateTo,
}: FormDialogProps) {
  const [state, formAction] = useFormState(action, null);
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.success) {
      onClose();
      if (navigateTo) {
        router.push(navigateTo);
      } else {
        router.refresh();
      }
    }
  }, [state, onClose, router, navigateTo]);

  return (
    <Dialog open={open} onClose={onClose} title={title}>
      {state?.error && (
        <div className="mb-4 rounded bg-destructive/10 p-3 text-sm text-destructive">
          {state.error}
        </div>
      )}
      <form ref={formRef} action={formAction} className="space-y-4">
        {children({ fieldErrors: state?.fieldErrors })}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit">
            {submitLabel}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
