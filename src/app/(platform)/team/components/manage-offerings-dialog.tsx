"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useFormState } from "react-dom";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { createServiceOffering } from "@/actions/assignments";
import type { ServiceOfferingData } from "./team-types";

interface Props {
  open: boolean;
  onClose: () => void;
  serviceOfferings: ServiceOfferingData[];
}

export function ManageOfferingsDialog({ open, onClose, serviceOfferings }: Props) {
  const [state, action] = useFormState(createServiceOffering, null);
  const router = useRouter();

  useEffect(() => {
    if (state && "success" in state && state.success) {
      router.refresh();
    }
  }, [state, router]);

  if (!open) return null;

  return (
    <Dialog open={open} onClose={onClose} title="Manage Service Offerings">
      <div className="space-y-4">
        {/* Existing Offerings */}
        <div>
          <p className="text-sm font-medium mb-2">Current Offerings ({serviceOfferings.length})</p>
          {serviceOfferings.length === 0 ? (
            <p className="text-sm text-muted-foreground">No service offerings defined yet.</p>
          ) : (
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {serviceOfferings.map((so) => (
                <div key={so.id} className="flex items-center justify-between px-3 py-2 rounded border border-border text-sm">
                  <span className="font-medium">{so.name}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Add New */}
        <div className="border-t border-border pt-4">
          <p className="text-sm font-medium mb-2">Add New Offering</p>
          {state && "error" in state && state.error && (
            <div className="mb-3 rounded bg-destructive/10 p-2 text-sm text-destructive">{state.error}</div>
          )}
          {state && "success" in state && state.success && (
            <div className="mb-3 rounded bg-green-50 border border-green-200 p-2 text-sm text-green-800">Service offering created.</div>
          )}
          <form action={action} className="flex gap-2">
            <input name="name" required placeholder="e.g. End User Device Field Services"
              className="flex-1 h-10 rounded border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
            <Button type="submit" size="sm">Add</Button>
          </form>
          <input type="hidden" name="description" value="" />
        </div>

        <div className="flex justify-end pt-2">
          <Button variant="outline" onClick={onClose}>Close</Button>
        </div>
      </div>
    </Dialog>
  );
}
