"use client";

import { useFormState } from "react-dom";
import { useState, useTransition } from "react";
import { addAllowedDomain, removeAllowedDomain } from "@/actions/sso";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Trash2, Plus, Globe } from "lucide-react";

interface Domain {
  id: string;
  domain: string;
  createdAt: Date;
}

export function DomainManager({ domains: initial }: { domains: Domain[] }) {
  const [state, formAction] = useFormState(addAllowedDomain, null);
  const [pending, setPending] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  return (
    <div className="space-y-4">
      {/* Add domain form */}
      <form
        action={formAction}
        onSubmit={() => setPending(true)}
        className="flex items-end gap-2"
      >
        <div className="flex-1">
          <Input
            name="domain"
            label="Domain"
            placeholder="company.com"
            required
            error={state && "error" in state ? state.error : undefined}
          />
        </div>
        <Button type="submit" size="sm" disabled={pending} className="shrink-0">
          <Plus className="h-4 w-4 mr-1" />
          Add Domain
        </Button>
      </form>

      {state && "success" in state && state.success && (
        <div className="rounded bg-success/10 p-3 text-sm text-success">
          Domain added successfully.
        </div>
      )}

      {/* Domain list */}
      {initial.length === 0 ? (
        <div className="rounded border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          <Globe className="h-8 w-8 mx-auto mb-2 opacity-40" />
          <p>No domain restrictions configured.</p>
          <p className="mt-1">All Google accounts can currently sign in.</p>
        </div>
      ) : (
        <div className="divide-y divide-border rounded border border-border">
          {initial.map((d) => (
            <div
              key={d.id}
              className="flex items-center justify-between px-4 py-3"
            >
              <div className="flex items-center gap-2">
                <Globe className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">{d.domain}</span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                disabled={removing === d.id}
                onClick={() => {
                  setRemoving(d.id);
                  startTransition(async () => {
                    await removeAllowedDomain(d.id);
                    setRemoving(null);
                  });
                }}
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
